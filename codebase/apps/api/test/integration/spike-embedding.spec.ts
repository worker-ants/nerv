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
import { runMigrations } from '@nerv/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    const degraded = await dead.embedOrNull(['x']);
    expect(degraded).toBeNull();
  });

  it('세 프로필이 같은 코드 경로를 쓴다 — env 3키만 다르다(§5.2a)', async () => {
    const profiles = [
      { name: '로컬(TEI)', baseUrl: stubUrl, model: 'BAAI/bge-m3', sendDimensions: false },
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
