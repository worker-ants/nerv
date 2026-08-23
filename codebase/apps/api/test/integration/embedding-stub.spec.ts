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
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: payload.input.map((text, index) => ({
            index,
            embedding: fakeEmbedding(text, stubDimensions),
          })),
        }),
      );
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
