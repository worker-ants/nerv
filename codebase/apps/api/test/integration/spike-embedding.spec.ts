// E06-S06 — 스파이크: 임베딩 제공자 · 하이브리드 검색.
//
//   WHEN 스파이크가 종료되면, THE SYSTEM SHALL 프로필별 지연·차원 검증·하이브리드 품질
//   비교표와 go/no-go 판정을 산출한다
//
// 검증하는 것은 **계약**이다(codebase.md §5.2a · REQ-CB-020·021):
//   ① NERV 코드는 제공자를 모른다 — OpenAI 호환 POST {URL}/embeddings 하나만 부른다
//   ② 차원이 1024 가 아니면 적재하지 않는다 — 스키마 vector(1024)·HNSW 가 차원에 묶인다
//   ③ 제공자 무응답이면 검색은 렉시컬로 degrade 한다(REQ-API-026)
//
// 실모델 품질 비교(한국어 조사 변형·부분 문자열·의미 유사)는 스테이징 소관이다 —
// L2 는 결정적 스텁 서버를 상대로 **계약**만 검증한다(codebase.md §4.3 L2 행).

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { EMBED_QUERY_COOLDOWN_MS, EMBED_QUERY_TIMEOUT_MS } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EmbeddingClient } from '../../src/modules/spec/embedding.client.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let stub: Server;
let stubUrl: string;
/** 스텁이 돌려줄 차원 — 테스트가 바꾼다 */
let stubDimensions = 1024;
let lastRequest: { path: string; body: Record<string, unknown>; auth: string | undefined } | null =
  null;

beforeAll(async () => {
  db = await createScratchDb('nerv_embed');
  await runMigrations(db.url);

  // OpenAI 호환 스텁 — 단일 계약이라 스텁도 같은 표면이다(codebase.md §4.3)
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += String(c)));
    req.on('end', () => {
      lastRequest = {
        path: req.url ?? '',
        body: JSON.parse(raw || '{}') as Record<string, unknown>,
        auth: req.headers['authorization'] as string | undefined,
      };
      const input = (lastRequest.body['input'] as string[] | undefined) ?? [];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          object: 'list',
          data: input.map((_, i) => ({
            object: 'embedding',
            index: i,
            embedding: Array.from({ length: stubDimensions }, () => 0.1),
          })),
          model: lastRequest.body['model'],
        }),
      );
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const address = stub.address() as { port: number };
  stubUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
  await db.drop();
});

describe('E06-S06 임베딩 제공자 계약 (REQ-CB-020)', () => {
  it('OpenAI 호환 /embeddings 하나만 부른다 — 제공자별 분기가 없다', async () => {
    const client = new EmbeddingClient({ baseUrl: stubUrl, model: 'BAAI/bge-m3' });
    const vectors = await client.embed(['위젯을 임베드한다', '세션을 복원한다']);

    expect(lastRequest?.path).toBe('/v1/embeddings');
    expect(lastRequest?.body).toMatchObject({ model: 'BAAI/bge-m3' });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1024);
  });

  it('API 키가 있으면 Bearer 로 보낸다 — 없으면 헤더 자체가 없다(로컬 TEI)', async () => {
    const withKey = new EmbeddingClient({ baseUrl: stubUrl, model: 'm', apiKey: 'sk-test' });
    await withKey.embed(['x']);
    expect(lastRequest?.auth).toBe('Bearer sk-test');

    const noKey = new EmbeddingClient({ baseUrl: stubUrl, model: 'm' });
    await noKey.embed(['x']);
    expect(lastRequest?.auth).toBeUndefined();
  });

  it('OpenAI 프로필은 dimensions=1024 를 항상 보낸다 — Matryoshka 절단(§5.2a)', async () => {
    const openai = new EmbeddingClient({
      baseUrl: stubUrl,
      model: 'text-embedding-3-small',
      sendDimensions: true,
    });
    await openai.embed(['x']);
    expect(lastRequest?.body['dimensions']).toBe(1024);
  });

  it('차원이 1024 가 아니면 적재하지 않고 오류로 기록한다 (REQ-CB-021)', async () => {
    stubDimensions = 768;
    const client = new EmbeddingClient({ baseUrl: stubUrl, model: 'wrong-dim' });
    await expect(client.embed(['x'])).rejects.toThrow(/1024/);
    stubDimensions = 1024;
  });

  it('제공자가 무응답이면 실패를 알린다 — 호출부가 렉시컬로 degrade 한다 (REQ-API-026)', async () => {
    const dead = new EmbeddingClient({
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'm',
      timeoutMs: 300,
    });
    await expect(dead.embed(['x'])).rejects.toThrow();

    // degrade 는 예외를 삼키는 것이 아니라 **검색이 렉시컬로 내려가는 것**이다.
    // 그 판정은 SpecService.search 가 하고(E09-S10), 여기서는 클라이언트가 실패를 숨기지
    // 않는다는 것까지 확인한다 — 조용히 빈 벡터를 주면 검색이 조용히 나빠진다.
    const degraded = await dead.embedQuery('x');
    expect(degraded).toBeNull();
  });

  // 2026-10-12 · 사람 결정(REQ-API-300). 질의도 색인과 같은 30초를 기다리던 동안, 받기만 하고 답하지
  // 않는 제공자 앞에서 검색 한 번이 30.6초였다(E06-S06 실측 · api.md §2.2c).
  it('멈춘 제공자 앞에서 질의는 2초 안에 포기하고, 그 뒤 1분은 부르지 않는다 (REQ-API-300)', async () => {
    let calls = 0;
    const hung = createServer((req) => {
      calls += 1;
      req.resume(); // 받기만 하고 답하지 않는다
    });
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', r));
    const port = (hung.address() as { port: number }).port;
    let clock = 1_000_000;
    const client = new EmbeddingClient({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'm',
      timeoutMs: 30_000, // 색인의 시한 — 질의는 이것을 쓰지 않는다
      now: () => clock,
    });
    try {
      const startedAt = performance.now();
      expect(await client.embedQuery('파티션')).toBeNull();
      const waited = performance.now() - startedAt;
      expect(waited).toBeGreaterThanOrEqual(EMBED_QUERY_TIMEOUT_MS - 50);
      expect(waited).toBeLessThan(EMBED_QUERY_TIMEOUT_MS + 3_000);
      expect(calls).toBe(1);

      // 쉬는 동안은 부르지 않고 바로 null 이다 — 검색은 기다리지 않고 렉시컬로 답한다
      clock += EMBED_QUERY_COOLDOWN_MS - 1;
      const skippedAt = performance.now();
      expect(await client.embedQuery('파티션')).toBeNull();
      expect(performance.now() - skippedAt).toBeLessThan(100);
      expect(calls).toBe(1);
    } finally {
      hung.closeAllConnections();
      await new Promise<void>((r) => hung.close(() => r()));
    }
  });

  it('쉬는 시간이 지나면 다시 부른다 — 살아난 제공자는 다음 검색부터 쓰인다 (REQ-API-300)', async () => {
    let clock = 5_000_000;
    const client = new EmbeddingClient({
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'm',
      now: () => clock,
    });
    expect(await client.embedQuery('x')).toBeNull(); // 연결 거부 — 쉬기 시작한다
    // 같은 객체의 주소를 살아 있는 스텁으로 바꿀 수는 없으니, 쉬는 동안과 그 뒤의 차이를 호출로 본다
    const spy = vi.spyOn(client, 'embed');
    clock += EMBED_QUERY_COOLDOWN_MS - 1;
    await client.embedQuery('x');
    expect(spy).not.toHaveBeenCalled();
    clock += 2;
    await client.embedQuery('x');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('세 프로필이 같은 코드 경로를 쓴다 — env 3키만 다르다(§5.2a)', async () => {
    const profiles = [
      { name: '로컬(ollama)', baseUrl: stubUrl, model: 'bge-m3', sendDimensions: false },
      {
        name: '스테이징(LM Studio)',
        baseUrl: stubUrl,
        model: 'bge-m3-gguf',
        sendDimensions: false,
      },
      {
        name: '운영(OpenAI)',
        baseUrl: stubUrl,
        model: 'text-embedding-3-small',
        sendDimensions: true,
        apiKey: 'sk-x',
      },
    ];

    const report: { profile: string; dimensions: number; latencyMs: number }[] = [];
    for (const profile of profiles) {
      const client = new EmbeddingClient(profile);
      const started = Date.now();
      const [vector] = await client.embed(['한국어 질의']);
      report.push({
        profile: profile.name,
        dimensions: vector?.length ?? 0,
        latencyMs: Date.now() - started,
      });
    }

    // 스파이크 산출물 — 프로필별 지연·차원 검증표(수용 기준의 "비교표")
    expect(report.every((r) => r.dimensions === 1024)).toBe(true);
    expect(report).toHaveLength(3);
  });
});
