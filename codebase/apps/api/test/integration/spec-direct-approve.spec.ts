// 바로 승인 — 초안을 검토 요청과 내 승인 한 번으로 확정한다 (2026-10-11 사람 결정 · REQ-API-287~291)
//
//   WHEN admin · planner 가 본 지문과 함께 초안의 바로 승인을 요청하면
//   THE SYSTEM SHALL 한 트랜잭션에서 검토 요청(사전 검토 · 등급 · 결재 자리)과 그 사람의 승인을 하고,
//   T3 이면 다른 사람 한 명을 기다린다
//
// 새 판정을 만들지 않는다는 것이 이 기능의 요점이다 — 그래서 이 스위트가 보는 것은 **기존 판정이 그대로
// 서는가**(등급 · 정족수 · stale · 사전 검토 · 역할 · 사람 전용)와 **둘 사이에 반쯤 된 상태가 남지 않는가**다.

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let approvals: ApprovalService;
let projectId: string;
let planner: string;
let reviewer: string;
let admin: string;
let developer: string;
let sessionId: string;

const person = (userId: string) => ({ userId, isAgent: false });
const agent = (userId: string) => ({ userId, isAgent: true });

beforeAll(async () => {
  db = await createScratchDb('nerv_direct');
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
    new AttachmentService(null as never, drizzleDb),
    drizzleDb,
  );
  approvals = new ApprovalService(events, specs, new AuthService(drizzleDb), drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('TRUNCATE event');
  await pool.query(`UPDATE agent_session SET state = 'active'`);
  await tiers('T2');
});

/**
 * 등급을 고정한다 — 경계를 옮기고 동적 강화를 끈다. 등급 산정 자체는 gate-tier.spec 이 보고, 여기서는
 * 등급마다 바로 승인이 무엇을 하는지만 본다.
 */
async function tiers(tier: 'T0' | 'T2' | 'T3'): Promise<void> {
  const boundaries = tier === 'T0' ? [100, 100, 100] : tier === 'T2' ? [0, 0, 100] : [0, 0, 0];
  await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ spec_gate: { tier_boundaries: boundaries, dynamic_escalation: false } }),
    projectId,
  ]);
}

async function newDraft(
  key: string,
  author = planner,
  body = `# ${key}\n\n본문`,
): Promise<{ specId: string; versionId: string; hash: string }> {
  const result = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId: author,
  });
  const versionId = result['spec_version_id'] as string;
  return { specId: result['spec_id'] as string, versionId, hash: await hashOf(versionId) };
}

async function hashOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

async function statusOf(
  versionId: string,
): Promise<{ status: string; approved_by: string | null }> {
  const { rows } = await pool.query<{ status: string; approved_by: string | null }>(
    `SELECT status::text AS status, approved_by_user_id AS approved_by
       FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!;
}

async function eventsOf(type: string): Promise<
  {
    subject_id: string;
    actor_user_id: string | null;
    actor_session_id: string | null;
    is_agent: boolean;
    payload: Record<string, unknown>;
  }[]
> {
  const { rows } = await pool.query(
    `SELECT subject_id, actor_user_id, actor_session_id, is_agent, payload FROM event
      WHERE type = $1 ORDER BY occurred_at`,
    [type],
  );
  return rows as never;
}

const direct = (
  versionId: string,
  hash: string,
  userId = planner,
  extra: Partial<Parameters<ApprovalService['approveDirect']>[0]> = {},
): ReturnType<ApprovalService['approveDirect']> =>
  approvals.approveDirect({
    actor: person(userId),
    surface: 'rest',
    projectId,
    specVersionId: versionId,
    userId,
    seenContentHash: hash,
    ...extra,
  });

describe('바로 승인 — 등급은 그대로다 (REQ-API-287)', () => {
  it('T2 초안은 내 승인으로 확정된다 — 제출과 결정이 한 번에 남는다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-T2');
    const result = await direct(versionId, hash);

    expect(result).toMatchObject({
      status: 'approved',
      gate_tier: 'T2',
      auto_passed: false,
      approval_id: null,
      // planner 가 쓰고 planner 가 승인했다 — 자기 승인의 예외이고 그 사실을 준다(REQ-API-288)
      self_approved: true,
    });
    expect(result.web_url).toContain('/specs/SPC-DIRECT-T2');
    expect(await statusOf(versionId)).toEqual({ status: 'approved', approved_by: planner });

    // 결재 행은 하나이고 누른 사람이 결정했다 — 받은 요청에 남는 카드가 없다
    const { rows } = await pool.query<{ decision: string; decided_by: string }>(
      `SELECT decision::text AS decision, decided_by_user_id AS decided_by FROM approval
        WHERE subject_id = $1`,
      [versionId],
    );
    expect(rows).toEqual([{ decision: 'approve', decided_by: planner }]);
    // 감사가 바로 승인을 센다 — 제출과 결정 둘 다에 남는다
    expect((await eventsOf(NERV_EVENT.SPEC_SUBMITTED))[0]?.payload).toMatchObject({
      direct: true,
      gate_tier: 'T2',
    });
    expect((await eventsOf(NERV_EVENT.APPROVAL_DECIDED))[0]?.payload).toMatchObject({
      direct: true,
      self_approved: true,
    });
  });

  it('T0 · T1 은 결재 없이 승인되지만 승인자는 누른 사람이다', async () => {
    await tiers('T0');
    const { versionId, hash } = await newDraft('SPC-DIRECT-T0');
    await expect(direct(versionId, hash)).resolves.toMatchObject({
      status: 'approved',
      gate_tier: 'T0',
      auto_passed: true,
      approval_id: null,
    });
    // 자동 통과의 승인자는 원래 NULL 이다 — 사람이 승인을 눌렀으므로 그 사람을 적는다
    expect(await statusOf(versionId)).toEqual({ status: 'approved', approved_by: planner });
    const { rows } = await pool.query(`SELECT 1 FROM approval WHERE subject_id = $1`, [versionId]);
    expect(rows).toHaveLength(0);
  });

  it('T3 은 내 승인이 한 자리를 채우고 다른 사람을 기다린다 — 정족수는 서로 다른 2인이다', async () => {
    await tiers('T3');
    const { versionId, hash } = await newDraft('SPC-DIRECT-T3');
    const result = await direct(versionId, hash);

    expect(result).toMatchObject({
      status: 'in_review',
      gate_tier: 'T3',
      quorum: { given: 1, required: 2, satisfied: false },
    });
    // 남은 자리의 카드로 보낸다 — 거기서 다른 사람이 결정한다
    expect(result.approval_id).not.toBeNull();
    expect(result.web_url).toContain(`/inbox?focus=${result.approval_id!}`);
    expect((await statusOf(versionId)).status).toBe('in_review');

    // 같은 사람이 다시 눌러도 둘째 자리를 채우지 못한다
    await expect(direct(versionId, hash)).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'already_approved' },
    });

    // 다른 사람이 남은 자리를 결정하면 확정된다 — 바로 승인으로 해도 같다(검토 중 버전의 자리를 결정한다)
    await expect(direct(versionId, hash, reviewer)).resolves.toMatchObject({
      status: 'approved',
      approval_id: null,
      quorum: { given: 2, required: 2, satisfied: true },
    });
    expect((await statusOf(versionId)).status).toBe('approved');
  });

  it('이미 검토 중인 버전이면 제출을 건너뛰고 내 자리를 결정한다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-INREVIEW', reviewer);
    await specs.submitReview({ projectId, specVersionId: versionId, userId: reviewer });
    expect((await statusOf(versionId)).status).toBe('in_review');

    await expect(direct(versionId, hash)).resolves.toMatchObject({ status: 'approved' });
    // 제출은 한 번뿐이다 — 바로 승인이 다시 제출하지 않았다
    expect(await eventsOf(NERV_EVENT.SPEC_SUBMITTED)).toHaveLength(1);
  });
});

describe('바로 승인 — 반쯤 된 상태를 남기지 않는다', () => {
  it('본 지문이 다르면 아무것도 바꾸지 않는다 — 다시 읽을 곳을 준다', async () => {
    const { specId, versionId, hash } = await newDraft('SPC-DIRECT-STALE');
    // 그 사이 에이전트가 초안을 고쳐 썼다
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      baseHash: hash,
      bodyMd: '# 고쳐 쓴 본문\n\n다른 내용',
      userId: planner,
    });

    await expect(direct(versionId, hash)).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: {
        kind: 'stale_approval',
        reread: { tool: 'nerv_spec_get', args: { spec_id: 'SPC-DIRECT-STALE', version: 1 } },
      },
    });
    expect((await statusOf(versionId)).status).toBe('draft');
    expect(await eventsOf(NERV_EVENT.SPEC_SUBMITTED)).toHaveLength(0);
  });

  it('사전 검토가 막으면 초안으로 남는다 — 결재 카드도 생기지 않는다', async () => {
    // 요구사항 번호가 겹치면 requirement-shape 가 block 이다
    const body = [
      '# 겹친 번호',
      '',
      '- REQ-DUP-001 WHEN 조건이면 THE SYSTEM SHALL 하나를 한다',
      '- REQ-DUP-001 WHEN 조건이면 THE SYSTEM SHALL 둘을 한다',
    ].join('\n');
    const { versionId, hash } = await newDraft('SPC-DIRECT-BLOCK', planner, body);
    const check = await specs.check({ projectId, specVersionId: versionId });
    expect(check.verdict).toBe('block');

    await expect(direct(versionId, hash)).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'precheck_blocked' },
    });
    expect((await statusOf(versionId)).status).toBe('draft');
    const { rows } = await pool.query(`SELECT 1 FROM approval WHERE subject_id = $1`, [versionId]);
    expect(rows).toHaveLength(0);
  });

  it('승인된 버전은 다시 승인하지 않는다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-TWICE');
    await direct(versionId, hash);
    await expect(direct(versionId, hash)).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'not_draft', status: 'approved' },
    });
  });
});

describe('바로 승인 — 누가 하는가 (REQ-API-287 · 288 · 291)', () => {
  it('admin · planner 만 한다 — developer 는 역할 단계에서 막힌다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-DEV');
    await expect(direct(versionId, hash, developer)).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'missing_role', required: ['spec:approve', 'approval:decide'] },
    });
    expect((await statusOf(versionId)).status).toBe('draft');
    await expect(direct(versionId, hash, admin)).resolves.toMatchObject({ status: 'approved' });
  });

  it('REST 에는 토큰이 오지 못한다 — 승인 창(A3)을 건너뛰는 길이 된다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-PAT');
    await expect(direct(versionId, hash, planner, { actor: agent(planner) })).rejects.toMatchObject(
      {
        code: NERV_ERROR.HUMAN_ONLY,
        details: { kind: 'human_only', action: 'approve' },
      },
    );
    expect((await statusOf(versionId)).status).toBe('draft');
  });

  it('도구로 온 승인은 세션 없이 받지 않는다 — 감사가 화면에서 누른 것으로 읽는다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-NOSESSION');
    await expect(
      direct(versionId, hash, planner, { actor: agent(planner), surface: 'mcp' }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'session_required' },
    });
  });

  it('세션에서 사람이 대답한 승인은 그 세션을 거쳤다고 남는다 — 결정한 사람은 그 사람이다', async () => {
    const { versionId, hash } = await newDraft('SPC-DIRECT-MCP');
    await expect(
      direct(versionId, hash, planner, { actor: agent(planner), surface: 'mcp', sessionId }),
    ).resolves.toMatchObject({ status: 'approved' });

    const [decided] = await eventsOf(NERV_EVENT.APPROVAL_DECIDED);
    expect(decided).toMatchObject({
      actor_user_id: planner,
      actor_session_id: sessionId,
      is_agent: true,
    });
    expect(decided?.payload).toMatchObject({ via: 'agent_session', direct: true });
    const [approved] = await eventsOf(NERV_EVENT.SPEC_APPROVED);
    expect(approved).toMatchObject({ actor_session_id: sessionId, is_agent: true });
    const { rows } = await pool.query<{ decided_by: string }>(
      `SELECT decided_by_user_id AS decided_by FROM approval WHERE subject_id = $1`,
      [versionId],
    );
    expect(rows[0]?.decided_by).toBe(planner);
    // 결정이 났으니 세션은 기다리지 않는다
    const { rows: state } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(state[0]?.state).toBe('active');
  });

  it('T3 을 세션에서 승인하면 세션은 다른 사람의 결정을 기다린다', async () => {
    await tiers('T3');
    const { versionId, hash } = await newDraft('SPC-DIRECT-MCP-T3');
    await expect(
      direct(versionId, hash, planner, { actor: agent(planner), surface: 'mcp', sessionId }),
    ).resolves.toMatchObject({ status: 'in_review' });
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0]?.state).toBe('awaiting_input');
  });
});

describe('일괄 바로 승인 (REQ-API-289)', () => {
  it('건마다 따로 판정한다 — 바뀐 것만 남고 나머지는 지나간다', async () => {
    const a = await newDraft('SPC-BULK-A');
    const b = await newDraft('SPC-BULK-B');
    const outcome = await approvals.approveDirectBulk({
      actor: person(planner),
      projectId,
      userId: planner,
      items: [
        { versionId: a.versionId, seenContentHash: a.hash },
        { versionId: b.versionId, seenContentHash: 'f'.repeat(64) },
        { versionId: 'not-a-uuid', seenContentHash: a.hash },
      ],
    });
    expect(outcome).toMatchObject({ approved: 1, waiting: 0, failed: 2 });
    expect(outcome.results.map((r) => [r.ok, r.kind ?? null])).toEqual([
      [true, null],
      [false, 'stale_approval'],
      [false, 'not_found'],
    ]);
    expect((await statusOf(b.versionId)).status).toBe('draft');
    // 일괄의 한 건이라는 사실이 감사에 남는다
    expect((await eventsOf(NERV_EVENT.APPROVAL_DECIDED))[0]?.payload).toMatchObject({
      bulk: true,
      batch_id: outcome.batch_id,
      direct: true,
    });
  });

  it('정족수 2 이상(T3)은 일괄에서 빠진다 — 초안으로 남는다. admin 은 면제다', async () => {
    await tiers('T3');
    const a = await newDraft('SPC-BULK-T3');
    const planned = await approvals.approveDirectBulk({
      actor: person(planner),
      projectId,
      userId: planner,
      items: [{ versionId: a.versionId, seenContentHash: a.hash }],
    });
    expect(planned.results[0]).toMatchObject({ ok: false, kind: 'bulk_quorum' });
    expect((await statusOf(a.versionId)).status).toBe('draft');

    const byAdmin = await approvals.approveDirectBulk({
      actor: person(admin),
      projectId,
      userId: admin,
      items: [{ versionId: a.versionId, seenContentHash: a.hash }],
    });
    // admin 도 혼자서는 둘째 자리를 채우지 못한다 — 검토 중으로 남아 다른 사람을 기다린다
    expect(byAdmin).toMatchObject({ approved: 0, waiting: 1, failed: 0 });
  });

  it('역할이 없으면 배치 전체를 거절한다', async () => {
    const a = await newDraft('SPC-BULK-DEV');
    await expect(
      approvals.approveDirectBulk({
        actor: person(developer),
        projectId,
        userId: developer,
        items: [{ versionId: a.versionId, seenContentHash: a.hash }],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'missing_role' } });
  });
});

describe('바로 승인할 수 있는 초안 (REQ-API-290)', () => {
  it('초안마다 본 지문을 준다 — 일괄이 그 값을 그대로 돌려보낸다', async () => {
    const a = await newDraft('SPC-LIST-A');
    const b = await newDraft('SPC-LIST-B', reviewer);
    const approved = await newDraft('SPC-LIST-DONE');
    await direct(approved.versionId, approved.hash);

    const { items } = await approvals.approvableDrafts({
      actor: person(planner),
      userId: planner,
      projectId,
    });
    expect(items.map((i) => i['spec_key'])).toEqual(['SPC-LIST-A', 'SPC-LIST-B']);
    expect(items[0]).toMatchObject({
      version_id: a.versionId,
      content_hash: a.hash,
      can_approve: true,
      can_bulk_approve: true,
      approved_version_no: null,
      body_change: null,
    });
    expect(items[1]).toMatchObject({ version_id: b.versionId, author_name: '서연' });
  });

  it('보관한 문서의 초안은 빠진다', async () => {
    const a = await newDraft('SPC-LIST-ARCH');
    await pool.query(`UPDATE spec SET archived_at = now() WHERE id = $1`, [a.specId]);
    const { items } = await approvals.approvableDrafts({
      actor: person(planner),
      userId: planner,
      projectId,
    });
    expect(items).toHaveLength(0);
  });

  it('바로 승인할 수 없는 역할이면 빈 목록이다 · 에이전트는 사람 전용에서 막힌다', async () => {
    await newDraft('SPC-LIST-ROLE');
    await expect(
      approvals.approvableDrafts({ actor: person(developer), userId: developer, projectId }),
    ).resolves.toEqual({ items: [] });
    await expect(
      approvals.approvableDrafts({ actor: agent(planner), userId: planner, projectId }),
    ).rejects.toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  admin = newId();
  developer = newId();
  sessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [id, email, name, role] of [
    [planner, 'jimin@example.com', '지민', 'planner'],
    [reviewer, 'seoyeon@example.com', '서연', 'planner'],
    [admin, 'admin@example.com', '관리자', 'admin'],
    [developer, 'minu@example.com', '민우', 'developer'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,$2,$3,$4,$5::member_role)`,
      [newId(), orgId, projectId, id, role],
    );
  }
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-07','active')`,
    [sessionId, projectId, planner],
  );
}
