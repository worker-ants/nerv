// E09-S10·S11 — 결정적 OpenAI 호환 스텁 서버로 벡터 경로를 검증한다 (codebase.md §4.3 L2 규정)
//
// 실모델 품질은 여기서 볼 일이 아니다(E06-S06·스테이징 소관). 여기서 봐야 하는 것은
// **계약**이다: 단일 계약(REQ-CB-020)이라 스텁도 진짜 제공자와 같은 표면을 노출하고,
// 그래서 스텁으로 통과한 코드가 TEI·LM Studio·OpenAI 어디에 붙어도 같게 동작한다.
//
// 차원 검증(REQ-CB-021)도 여기서만 제대로 볼 수 있다 — 1023차원을 내는 제공자를
// 실물로 구하는 것보다 스텁이 정확하다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmbeddingClient } from '../../src/modules/spec/embedding.client.js';
import { EmbeddingService } from '../../src/modules/spec/embedding.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { SearchService } from '../../src/modules/spec/search.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const DIMENSIONS = 1024;

/** 결정적 임베딩 — 텍스트의 문자 분포를 1024차원에 접어 넣는다. 같은 입력 = 같은 벡터. */
function fakeEmbedding(text: string, dimensions = DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const slot = text.charCodeAt(i) % dimensions;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

let stub: Server;
let stubPort: number;
let stubDimensions = DIMENSIONS;
let lastRequest: Record<string, unknown> | null = null;
/** 요청마다 (입력 수, 총 문자 수) — 예산이 지켜지는지 보는 눈이다 */
let requestSizes: { items: number; chars: number }[] = [];
/** 이 번호부터의 요청을 늦춘다 — 타임아웃 재현용(0 이면 지연 없음) */
let stallFromRequest = 0;

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let embeddings: EmbeddingService;
let search: SearchService;
let projectId: string;
let planner: string;

beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      if (req.url !== '/v1/embeddings') {
        res.writeHead(404).end();
        return;
      }
      const payload = JSON.parse(body) as { input: string[] };
      lastRequest = JSON.parse(body) as Record<string, unknown>;
      requestSizes.push({
        items: payload.input.length,
        chars: payload.input.reduce((sum, text) => sum + text.length, 0),
      });
      const answer = (): void => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: payload.input.map((text, index) => ({
              index,
              embedding: fakeEmbedding(text, stubDimensions),
            })),
          }),
        );
      };
      // 늦게 답하는 제공자 — 클라이언트가 먼저 끊는다(AbortError 경로)
      if (stallFromRequest > 0 && requestSizes.length >= stallFromRequest) {
        setTimeout(answer, 5_000).unref();
        return;
      }
      answer();
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubPort = (stub.address() as { port: number }).port;
  process.env['NERV_EMBED_URL'] = `http://127.0.0.1:${stubPort}/v1`;
  process.env['NERV_EMBED_MODEL'] = 'stub-1024';

  db = await createScratchDb('nerv_embed');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  specs = new SpecService(
    events,
    new SpecCheckService(drizzleDb),
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    drizzleDb,
  );
  embeddings = new EmbeddingService(drizzleDb);
  search = new SearchService(drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

/**
 * 지금 본문의 지문 — 편집 저장의 `base_hash` 다(api.md §1.4g).
 *
 * 테스트의 주제는 비교-교환이 아니라 그 위의 동작이므로, "읽고 그 지문으로 쓴다"를
 * 여기 한 줄로 감춘다. 동시성 자체는 spec-concurrency.spec.ts 가 본다.
 */
async function hashOf(specId: string): Promise<string> {
  // 키로도 UUID 로도 부른다 — 도구가 둘 다 받으므로 테스트도 그렇다(§1.4b)
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(v.content_hash, 'hex') AS h
       FROM spec_version v JOIN spec s ON s.id = v.spec_id
      WHERE (s.id::text = $1 OR s.key = $1)
      ORDER BY v.version_no DESC LIMIT 1`,
    [specId],
  );
  return rows[0]?.h ?? '';
}

describe('E09-S11 임베딩 적재', () => {
  it('청크를 적재하고, 두 번째 실행은 변경분이 없어 아무것도 다시 임베딩하지 않는다', async () => {
    const s = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-EMB-001',
      title: '세션 복원 API',
      type: 'feature',
      bodyMd: '# 세션 복원 API\n\n방문자의 대화를 복원한다\n\n## 보안\n토큰으로 검증한다',
      userId: planner,
    });

    const first = await embeddings.runOnce({ projectId });
    expect(first.error).toBeNull();
    expect(first.chunks_embedded).toBe(2);

    const second = await embeddings.runOnce({ projectId });
    expect(second.chunks_embedded).toBe(0);
    expect(second.chunks_unchanged).toBe(2);
    expect(s['spec_id']).toBeDefined();
  });

  it('본문에서 사라진 절의 임베딩 행은 지운다 — 없는 절이 검색에 계속 뜨면 안 된다', async () => {
    const s = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-EMB-002',
      title: '삭제 대상',
      type: 'feature',
      bodyMd: '# 머리\n본문\n\n## 사라질 절\n내용',
      userId: planner,
    });
    await embeddings.runOnce({ projectId });

    await specs.draftUpsert({
      baseHash: await hashOf(s['spec_id'] as string),
      roles: ['planner'],
      projectId,
      specId: s['spec_id'] as string,
      bodyMd: '# 머리\n본문',
      userId: planner,
    });
    const report = await embeddings.runOnce({ projectId });
    expect(report.chunks_deleted).toBe(1);

    const { rows } = await pool.query<{ anchor: string }>(
      `SELECT anchor FROM spec_chunk_embedding e
         JOIN spec_version sv ON sv.id = e.spec_version_id
        WHERE sv.spec_id = $1`,
      [s['spec_id']],
    );
    expect(rows.map((r) => r.anchor)).not.toContain('사라질-절');
  });

  it('1024차원이 아니면 적재하지 않고 오류로 기록한다 (REQ-CB-021)', async () => {
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-EMB-003',
      title: '차원 검증',
      type: 'feature',
      bodyMd: '# 차원 검증\n본문',
      userId: planner,
    });

    stubDimensions = 768;
    try {
      const report = await embeddings.runOnce({ projectId });
      expect(report.error).toContain('1024');
      expect(report.chunks_embedded).toBe(0);
    } finally {
      stubDimensions = DIMENSIONS;
    }
  });

  it('제공자 계약은 model·input 뿐이다 — 제공자별 분기가 없다는 것의 관측 (REQ-CB-020)', async () => {
    lastRequest = null;
    await new EmbeddingClient({
      baseUrl: `http://127.0.0.1:${stubPort}/v1`,
      model: 'stub-1024',
    }).embed(['테스트']);
    expect(Object.keys(lastRequest ?? {}).sort()).toEqual(['input', 'model']);
  });

  it('OpenAI 프로필만 dimensions 를 함께 보낸다 (Matryoshka 절단)', async () => {
    lastRequest = null;
    await new EmbeddingClient({
      baseUrl: `http://127.0.0.1:${stubPort}/v1`,
      model: 'stub-1024',
      sendDimensions: true,
    }).embed(['테스트']);
    expect(lastRequest?.['dimensions']).toBe(1024);
  });
});

describe('E09-S10 벡터 경로', () => {
  it('의미 질의가 렉시컬 일치 없이도 문서를 찾는다', async () => {
    const s = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-VEC-001',
      title: '대화 이어보기',
      type: 'feature',
      bodyMd: '# 대화 이어보기\n\n방문자가 브라우저를 닫았다 열어도 이전 대화가 남아 있다',
      userId: planner,
    });
    await pool.query(
      `UPDATE spec_version SET status='approved', approved_at=now(), approved_by_user_id=$2,
              edit_lease_user_id=NULL, edit_lease_session_id=NULL, edit_lease_expires_at=NULL
        WHERE id = $1`,
      [s['spec_version_id'], planner],
    );
    await pool.query(`UPDATE spec SET current_version_id=$1 WHERE id=$2`, [
      s['spec_version_id'],
      s['spec_id'],
    ]);
    await embeddings.runOnce({ projectId });

    const result = await search.search({
      projectId,
      query: '브라우저를 닫았다 열어도 대화가 남아',
    });
    expect(result.degraded).toBeNull();
    expect(result.items.map((i) => i.key)).toContain('SPC-VEC-001');
    expect(result.items.some((i) => i.matched_by.includes('vector'))).toBe(true);
  });

  it('벡터 결과는 앵커를 들고 온다 — 청크가 곧 헤딩이기 때문이다', async () => {
    const result = await search.search({
      projectId,
      query: '브라우저를 닫았다 열어도 대화가 남아',
    });
    const hit = result.items.find((i) => i.matched_by.includes('vector'));
    expect(hit?.anchor).not.toBeNull();
  });

  it('제공자가 죽으면 같은 질의가 degraded 로 떨어지되 결과는 계속 나온다', async () => {
    const dead = new SearchService(drizzle(pool));
    const saved = process.env['NERV_EMBED_URL'];
    process.env['NERV_EMBED_URL'] = 'http://127.0.0.1:9/v1';
    try {
      const fresh = new SearchService(drizzle(pool));
      const result = await fresh.search({ projectId, query: '대화 이어보기' });
      expect(result.degraded).toBe('lexical-only');
      expect(result.items.length).toBeGreaterThan(0);
      expect(dead).toBeDefined();
    } finally {
      if (saved !== undefined) process.env['NERV_EMBED_URL'] = saved;
    }
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'jimin@example.com','지민','active')`,
    [planner],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, planner],
  );
  expect(NERV_ERROR.PRECONDITION).toBeDefined();
}

// 2026-08-28 실측 — 색인이 approved 114편 중 1편에서 멈춰 있었다. 원인은 제공자가 아니라
// **한 문서의 청크를 통째로 한 요청에 실은 것**이었고, 그래서 매 틱 같은 자리에서 타임아웃했다.
describe('요청 예산과 부분 진행 (2026-08-28 회귀 방지)', () => {
  const longBody = (sections: number): string =>
    Array.from({ length: sections }, (_, i) => `## 절 ${i}\n\n${'가'.repeat(3000)}`).join('\n\n');

  it('한 문서의 청크를 통째로 보내지 않는다 — 요청마다 문자 예산을 지킨다', async () => {
    const spec = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-BATCH-1',
      title: '긴 문서',
      type: 'feature',
      bodyMd: longBody(6),
      userId: planner,
    });
    expect(spec).toBeDefined();

    requestSizes = [];
    const report = await embeddings.runOnce({ projectId });

    expect(report.error).toBeNull();
    expect(requestSizes.length).toBeGreaterThan(1);
    // 예산(6,000자)을 넘는 요청은 **한 개짜리**뿐이다 — 청크는 더 쪼갤 수 없다
    for (const size of requestSizes) {
      if (size.chars > 6000) expect(size.items).toBe(1);
      expect(size.items).toBeLessThanOrEqual(8);
    }
  });

  it('타임아웃이 나도 앞선 배치는 남는다 — 다음 틱이 그 다음부터 이어간다', async () => {
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-BATCH-2',
      title: '중간에 끊기는 문서',
      type: 'feature',
      bodyMd: longBody(8),
      userId: planner,
    });

    requestSizes = [];
    stallFromRequest = 3; // 세 번째 요청부터 늦게 답한다
    process.env['NERV_EMBED_TIMEOUT_MS'] = '300';
    let report;
    try {
      report = await embeddings.runOnce({ projectId });
    } finally {
      stallFromRequest = 0;
      delete process.env['NERV_EMBED_TIMEOUT_MS'];
    }

    // 실패는 실패라고 말한다 — 어느 문서에서, 무엇을 하다, 어느 손잡이를 돌리면 되는지까지
    expect(report.error).toContain('SPC-BATCH-2');
    expect(report.error).toContain('NERV_EMBED_TIMEOUT_MS');
    // 그리고 **앞의 두 배치는 남는다**
    expect(report.chunks_embedded).toBeGreaterThan(0);

    // 다음 판은 남은 청크만 이어서 한다
    requestSizes = [];
    const next = await embeddings.runOnce({ projectId });
    expect(next.error).toBeNull();
    expect(next.chunks_embedded).toBeGreaterThan(0);
    expect(next.chunks_unchanged).toBeGreaterThan(0);
  });
});
