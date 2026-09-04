// 병렬 편집 — 같은 문서를 여러 세션이 동시에 고칠 때 무엇이 막히나 (api.md §1.4g·§1.4h)
//
// **Task 축에는 동시성 테스트가 12건, 문서 축에는 0건이었다.** 그 비대칭이 그대로 결함이
// 됐다(점검 2026-08-30): 세 세션이 같은 초안을 동시에 저장하면 셋 다 성공하고 본문에는
// 하나만 남았다 — 둘은 오류도 경고도 없이 자기 글을 잃었다.
//
// 원인은 `base_version` 이 초안 단계에서 **원리적으로** 못 막는다는 것이었다: draft 는 같은
// 행을 덮어쓰므로 version id 가 변하지 않아 "무엇을 보고 썼는가"를 식별하지 못한다.
// 이 파일이 지키는 것은 그 자리다. **두 층이다**: 리스가 남의 자리를 먼저 알리고(§1.4h),
// 지문이 마지막에 잠근다(§1.4g). 리스는 신호이고 지문이 자물쇠다 — 그래서 리스를 뺏어도
// 낡은 지문으로는 여전히 못 쓴다.

process.env['NERV_EMBED_URL'] = 'http://127.0.0.1:1/v1';

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventService } from '../../src/modules/event/event.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let projectId: string;
let alice: string;
let bob: string;
let sessionA: string;
let sessionB: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_conc');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url, max: 20 });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  const attachments = new AttachmentService(null as never, drizzleDb);
  specs = new SpecService(
    events,
    new SpecCheckService(drizzleDb),
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    attachments,
    drizzleDb,
  );
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('UPDATE spec SET current_version_id = NULL');
  for (const table of ['spec_relation', 'spec_chunk_embedding', 'spec_version', 'spec', 'event']) {
    await pool.query(`DELETE FROM ${table}`);
  }
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  alice = newId();
  bob = newId();
  sessionA = newId();
  sessionB = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [alice, 'alice@example.com', '앨리스'],
    [bob, 'bob@example.com', '밥'],
  ]) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  await pool.query(`INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'p','P','p')`, [
    projectId,
    orgId,
  ]);
  for (const user of [alice, bob]) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), orgId, projectId, user],
    );
  }
  // 세션 둘 — **같은 사람의 두 세션**이 이 점검의 주된 모양이다(PAT 하나로 도는 배치)
  for (const [id, user] of [
    [sessionA, alice],
    [sessionB, alice],
  ]) {
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','host','active')`,
      [id, projectId, user],
    );
  }
}

async function makeSpec(
  key: string,
  body: string,
  userId = alice,
  sessionId: string | null = null,
): Promise<{ specId: string; versionId: string; hash: string }> {
  const r = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId,
    sessionId,
  });
  return {
    specId: r['spec_id'] as string,
    versionId: r['spec_version_id'] as string,
    hash: r['content_hash'] as string,
  };
}

/** 던지는 것이 정상인 검사라 예외를 값으로 다룬다 */
async function settle<T>(
  work: Promise<T>[],
): Promise<{ ok: T[]; failed: { code?: string | undefined; kind?: string | undefined }[] }> {
  const results = await Promise.allSettled(work);
  return {
    ok: results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<T>).value),
    failed: results
      .filter((r) => r.status === 'rejected')
      .map(
        (r) =>
          (r as PromiseRejectedResult).reason as { code?: string; details?: { kind?: string } },
      )
      .map((e) => ({ code: e?.code, kind: e?.details?.kind })),
  };
}

async function bodyOf(specId: string): Promise<string> {
  const { rows } = await pool.query<{ body_md: string }>(
    `SELECT body_md FROM spec_version WHERE spec_id = $1 ORDER BY version_no DESC LIMIT 1`,
    [specId],
  );
  return rows[0]?.body_md ?? '';
}

describe('같은 문서 · 같은 사용자 · 세션 N개', () => {
  it('한 세션이 같은 지문으로 셋을 동시에 던지면 하나만 성공한다', async () => {
    // 리스가 아니라 **지문** 층을 보는 시험이라 보유자와 같은 세션으로 던진다.
    // 다른 세션이면 리스가 먼저 막아 이 자리까지 오지 않는다(아래 describe 가 그것을 본다).
    const { specId, hash } = await makeSpec('SPC-RACE', '# 시작\n\n공통 문장', alice, sessionA);

    const { ok, failed } = await settle(
      ['가', '나', '다'].map((mark) =>
        specs.draftUpsert({
          roles: ['planner'],
          projectId,
          specId,
          baseHash: hash,
          bodyMd: `# 시작\n\n공통 문장\n\n${mark} 가 쓴 문단`,
          sessionId: sessionA,
          userId: alice,
        }),
      ),
    );

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    // **잃은 쪽이 그 사실을 안다** — 이것이 이 기능의 전부다
    expect(failed.every((f) => f.kind === 'stale_body')).toBe(true);
    // 남은 본문은 성공한 하나의 것이고, 나머지 둘의 문단은 없다
    const body = await bodyOf(specId);
    expect(['가', '나', '다'].filter((m) => body.includes(`${m} 가 쓴 문단`))).toHaveLength(1);
  });

  it('앞선 저장 뒤 낡은 지문으로 저장하면 막고, 현재 지문을 알려준다', async () => {
    const { specId, hash } = await makeSpec('SPC-STALE', '# 시작');
    const first = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      baseHash: hash,
      bodyMd: '# 앞선 세션이 고쳤다',
      userId: alice,
    });

    const late = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash, // 저장 전에 읽은 낡은 지문
        bodyMd: '# 뒤늦은 세션이 덮어쓴다',
        userId: alice,
      }),
    ]);
    expect(late.failed[0]).toMatchObject({ code: NERV_ERROR.PRECONDITION, kind: 'stale_body' });
    expect(await bodyOf(specId)).toBe('# 앞선 세션이 고쳤다');

    // 새 지문으로는 이어 쓸 수 있다 — 막는 것이지 잠그는 것이 아니다
    const retry = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: first['content_hash'] as string,
        bodyMd: '# 다시 읽고 그 위에 얹었다',
        userId: alice,
      }),
    ]);
    expect(retry.failed).toHaveLength(0);
  });

  it('지문 없이 기존 문서를 고치려 하면 막는다 — 선택 사항이면 아무도 안 넣는다', async () => {
    const { specId } = await makeSpec('SPC-NOBASE', '# 원본');
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        bodyMd: '# 아무 근거 없이 덮어쓴다',
        userId: alice,
      }),
    ]);
    expect(r.failed[0]).toMatchObject({ kind: 'base_hash_required' });
    expect(await bodyOf(specId)).toBe('# 원본');
  });

  it('새 문서에는 지문을 요구하지 않는다 — 기준이 없는 저장이다', async () => {
    const r = await settle([makeSpec('SPC-BRANDNEW', '# 새 문서')]);
    expect(r.failed).toHaveLength(0);
  });
});

describe('본문은 그대로 두고 관계만 바꾸는 저장', () => {
  it('허용한다 — 지문이 같으므로 비교-교환을 통과한다 (2026-08-30 사람 결정)', async () => {
    const target = await makeSpec('SPC-TARGET', '# 대상');
    const { specId, hash } = await makeSpec('SPC-RELONLY', '# 본문 그대로');

    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# 본문 그대로',
        relations: [{ to: 'SPC-TARGET', kind: 'refines', baseHash: target.hash }],
        userId: alice,
      }),
    ]);
    expect(r.failed).toHaveLength(0);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM spec_relation WHERE from_spec_id = $1 AND kind <> 'references'`,
      [specId],
    );
    expect(rows[0]?.n).toBe('1');
  });
});

describe('선언 관계 — 상대 문서의 지문도 필수다 (2026-08-30 사람 결정)', () => {
  it('상대 지문이 없으면 막는다 — 읽지 않고 선언한 관계는 그래프에 거짓을 심는다', async () => {
    await makeSpec('SPC-RT', '# 대상');
    const { specId, hash } = await makeSpec('SPC-RS', '# 나');
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# 나',
        relations: [{ to: 'SPC-RT', kind: 'depends_on' }],
        userId: alice,
      }),
    ]);
    expect(r.failed[0]).toMatchObject({ kind: 'relation_base_hash_required' });
  });

  it('상대가 그 사이 바뀌었으면 막고, 어느 문서인지 짚어 준다', async () => {
    const target = await makeSpec('SPC-RT2', '# 대상');
    const { specId, hash } = await makeSpec('SPC-RS2', '# 나');
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: target.specId,
      baseHash: target.hash,
      bodyMd: '# 대상이 바뀌었다',
      userId: alice,
    });

    const results = await Promise.allSettled([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# 나',
        relations: [{ to: 'SPC-RT2', kind: 'depends_on', baseHash: target.hash }],
        userId: alice,
      }),
    ]);
    const reason = (results[0] as PromiseRejectedResult).reason as {
      details: { kind: string; targets: { to: string; current_hash: string }[] };
    };
    expect(reason.details.kind).toBe('stale_relation_target');
    // **어느 문서를 다시 읽어야 하는지**를 오류가 말한다 — 안 그러면 다섯 개 중 하나를 찾아야 한다
    expect(reason.details.targets[0]?.to).toBe('SPC-RT2');
    expect(reason.details.targets[0]?.current_hash).not.toBe(target.hash);
  });
});

describe('같은 사용자 · 다른 세션 — 리스는 세션이 쥔다 (§1.4h)', () => {
  it('같은 사람이라도 다른 세션이면 막는다 — 예전에는 그냥 통과했다', async () => {
    const { specId, hash } = await makeSpec('SPC-SESS', '# A 세션이 쓴다', alice, sessionA);
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# B 세션이 끼어든다',
        sessionId: sessionB,
        userId: alice,
      }),
    ]);
    expect(r.failed[0]).toMatchObject({ code: NERV_ERROR.DRAFT_LEASED, kind: 'draft_leased' });
    expect(await bodyOf(specId)).toBe('# A 세션이 쓴다');
  });

  it('takeover 로 뺏을 수 있다 — 죽은 세션이 쥔 리스에서 빠져나오는 유일한 길이다', async () => {
    const { specId, hash } = await makeSpec('SPC-SEIZE', '# A 세션', alice, sessionA);
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# B 세션이 이어받는다',
        sessionId: sessionB,
        takeover: true,
        userId: alice,
      }),
    ]);
    expect(r.failed).toHaveLength(0);
    expect(await bodyOf(specId)).toBe('# B 세션이 이어받는다');
    // 뺏은 사실이 이벤트에 남는다 — 자리를 잃은 쪽이 나중에 물을 곳이다
    const { rows } = await pool.query<{ payload: { takeover?: boolean } }>(
      `SELECT payload FROM event WHERE type = 'spec.draft_updated' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(rows[0]?.payload?.takeover).toBe(true);
  });

  it('뺏어도 낡은 지문으로는 못 쓴다 — 리스는 신호이고 지문이 자물쇠다', async () => {
    const { specId, hash } = await makeSpec('SPC-SEIZE2', '# 처음', alice, sessionA);
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      baseHash: hash,
      bodyMd: '# A 세션이 더 썼다',
      sessionId: sessionA,
      userId: alice,
    });
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash, // 뺏기 전에 읽은 지문
        bodyMd: '# B 세션이 덮어쓴다',
        sessionId: sessionB,
        takeover: true,
        userId: alice,
      }),
    ]);
    expect(r.failed[0]).toMatchObject({ kind: 'stale_body' });
    expect(await bodyOf(specId)).toBe('# A 세션이 더 썼다');
  });

  it('웹 탭(세션 없음)과 에이전트 세션은 서로를 막는다 — 실측된 덮어쓰기의 자리다', async () => {
    const { specId, hash } = await makeSpec('SPC-WEBVSAGENT', '# 사람이 웹에서 쓴다');
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# 에이전트가 덮어쓴다',
        sessionId: sessionA,
        userId: alice,
      }),
    ]);
    expect(r.failed[0]).toMatchObject({ code: NERV_ERROR.DRAFT_LEASED });
  });
});

describe('안정 키는 프로젝트 안에서 유일하다 (2026-08-30 사람 결정)', () => {
  it('이미 쓰이는 키로 만들면 막고, 그 문서를 짚어 준다', async () => {
    const first = await makeSpec('SPC-UNIQ', '# 먼저 쓴 문서');
    const r = await settle([makeSpec('SPC-UNIQ', '# 같은 키로 또 만든다')]);
    expect(r.failed[0]).toMatchObject({ kind: 'key_taken' });
    // 조용히 이어 쓰지 않는다 — 앞 문서의 본문은 그대로다
    expect(await bodyOf(first.specId)).toBe('# 먼저 쓴 문서');
  });

  it('동시에 같은 키로 만들면 하나만 남는다 — 검사는 흔한 길, 인덱스가 자물쇠다', async () => {
    const r = await settle([
      makeSpec('SPC-RACEKEY', '# 가'),
      makeSpec('SPC-RACEKEY', '# 나'),
      makeSpec('SPC-RACEKEY', '# 다'),
    ]);
    expect(r.ok).toHaveLength(1);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM spec WHERE key = 'SPC-RACEKEY'`,
    );
    expect(rows[0]?.n).toBe('1');
  });
});

describe('리스를 쥔 세션이 죽었으면 (2026-08-30 사람 결정)', () => {
  it('하트비트가 3주기 넘게 끊기면 비어 있는 것과 같다 — 30분을 기다리지 않는다', async () => {
    const { specId, hash } = await makeSpec('SPC-DEAD', '# A 세션', alice, sessionA);
    await pool.query(
      `UPDATE agent_session SET last_heartbeat_at = now() - interval '10 minutes' WHERE id = $1`,
      [sessionA],
    );
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# B 세션이 이어 쓴다',
        sessionId: sessionB,
        userId: alice,
      }),
    ]);
    // takeover 없이도 통과한다 — 죽은 세션의 자리는 빈 자리다
    expect(r.failed).toHaveLength(0);
    await pool.query(`UPDATE agent_session SET last_heartbeat_at = now() WHERE id = $1`, [
      sessionA,
    ]);
  });

  it('세션이 stale 로 닫혔으면 하트비트가 최근이어도 비어 있다', async () => {
    const { specId, hash } = await makeSpec('SPC-DEAD2', '# A 세션', alice, sessionA);
    await pool.query(`UPDATE agent_session SET state = 'stale' WHERE id = $1`, [sessionA]);
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# B 세션',
        sessionId: sessionB,
        userId: alice,
      }),
    ]);
    expect(r.failed).toHaveLength(0);
    await pool.query(`UPDATE agent_session SET state = 'active' WHERE id = $1`, [sessionA]);
  });
});

describe('같은 문서 · 다른 사용자', () => {
  it('남이 리스를 쥔 초안은 저장하지 못한다', async () => {
    const { specId, hash } = await makeSpec('SPC-LEASE', '# 앨리스가 쓴다', alice);
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# 밥이 끼어든다',
        sessionId: sessionB,
        userId: bob,
      }),
    ]);
    expect(r.failed[0]).toMatchObject({ code: NERV_ERROR.DRAFT_LEASED });
  });

  it('리스가 만료되면 남도 이어 쓴다', async () => {
    const { specId, hash } = await makeSpec('SPC-EXPIRE', '# 앨리스', alice);
    await pool.query(
      `UPDATE spec_version SET edit_lease_expires_at = now() - interval '1 minute' WHERE spec_id = $1`,
      [specId],
    );
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: hash,
        bodyMd: '# 밥',
        userId: bob,
      }),
    ]);
    expect(r.failed).toHaveLength(0);
  });
});

describe('연관 문서 — 서로 참조하는 둘을 동시에', () => {
  it('A·B 를 서로 반대 방향으로 동시에 고쳐도 관계가 어긋나지 않는다', async () => {
    const a = await makeSpec('SPC-A', '# A');
    const b = await makeSpec('SPC-B', '# B');
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: a.specId,
        baseHash: a.hash,
        bodyMd: '# A\n\n[B](SPC-B) 를 참조한다',
        userId: alice,
      }),
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: b.specId,
        baseHash: b.hash,
        bodyMd: '# B\n\n[A](SPC-A) 를 참조한다',
        userId: alice,
      }),
    ]);
    expect(r.failed).toHaveLength(0);
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM spec_relation`);
    expect(rows[0]?.n).toBe('2');
  });

  it('같은 대상을 두 문서가 동시에 참조해도 역참조가 중복되지 않는다', async () => {
    const core = await makeSpec('SPC-CORE', '# 코어');
    const u1 = await makeSpec('SPC-U1', '# u1');
    const u2 = await makeSpec('SPC-U2', '# u2');
    const r = await settle([
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: u1.specId,
        baseHash: u1.hash,
        bodyMd: '# u1\n\n[코어](SPC-CORE)',
        userId: alice,
      }),
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: u2.specId,
        baseHash: u2.hash,
        bodyMd: '# u2\n\n[코어](SPC-CORE)',
        userId: alice,
      }),
    ]);
    expect(r.failed).toHaveLength(0);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM spec_relation WHERE to_spec_id = $1`,
      [core.specId],
    );
    expect(rows[0]?.n).toBe('2');
  });
});
