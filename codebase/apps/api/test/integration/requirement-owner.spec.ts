// 요구사항 번호와 문서 간 소유 (api.md REQ-API-145 개정 · REQ-API-309 · 2026-10-15 사람 결정)
//
// 결함 둘을 재현한다. ① 다음 번호(EP-REQ-04)가 승인된 행만 세서, 동시에 쓰는 초안 둘이 같은 번호를 받았다.
// ② 승인이 요구사항 행을 `ON CONFLICT (project_id, ref) DO UPDATE` 로 쓰면서 `spec_id` 를 보지 않아, 다른 문서가
// 같은 번호를 정의해 승인하면 그 문서의 요구사항 문장을 조용히 덮었다. 이제 승인은 거절하고 사전 검토는 block 이다.
// 가진 문서의 최신 승인본에서 그 줄이 빠졌으면 소유가 풀린 것이라 옮겨 온다.

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
let checks: SpecCheckService;
let approvals: ApprovalService;
let projectId: string;
let planner: string;
let reviewer: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_req_owner');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  checks = new SpecCheckService(drizzleDb);
  specs = new SpecService(
    events,
    checks,
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
  await pool.query('DELETE FROM approval');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM requirement_version');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
});

/** 요구사항 줄로 된 본문 — `[ref, 문장]` */
function body(lines: [string, string][], extra = ''): string {
  return [
    '# 문서',
    '',
    '## 요구사항',
    '',
    ...lines.map(([ref, what]) => `- ${ref} WHEN 조건이 맞으면 THE SYSTEM SHALL ${what}`),
    '',
    extra,
  ].join('\n');
}

async function hashOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

/** 새 문서의 첫 초안 */
async function draft(key: string, text: string): Promise<string> {
  const saved = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: text,
    userId: planner,
  });
  return saved['spec_version_id'] as string;
}

/** 승인본 위의 새 초안 */
async function next(key: string, approvedId: string, text: string): Promise<string> {
  const saved = await specs.draftUpsert({
    projectId,
    specId: key,
    bodyMd: text,
    baseHash: await hashOf(approvedId),
    userId: planner,
    allowShrink: true,
  });
  return saved['spec_version_id'] as string;
}

/** 검토 요청 — 결재 대기면 결재 id 를 준다 */
async function submit(versionId: string): Promise<string | null> {
  const result = await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });
  return result.approval_id;
}

/** 다른 사람이 결재한다 */
async function decide(approvalId: string): Promise<unknown> {
  return approvals.decide({
    actor: { userId: reviewer, isAgent: false },
    projectId,
    approvalId,
    userId: reviewer,
    decision: 'approve',
  });
}

/** 제출부터 승인까지 — 자동 통과든 결재든 */
async function approve(versionId: string): Promise<void> {
  const approvalId = await submit(versionId);
  if (approvalId !== null) await decide(approvalId);
  const { rows } = await pool.query(`SELECT status::text AS s FROM spec_version WHERE id = $1`, [
    versionId,
  ]);
  expect(rows[0].s).toBe('approved');
}

async function requirement(ref: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT s.key AS owner, r.statement_md, r.removed_in_version_id, r.introduced_in_version_id
       FROM requirement r JOIN spec s ON s.id = r.spec_id
      WHERE r.project_id = $1 AND r.ref = $2`,
    [projectId, ref],
  );
  return rows[0] as Record<string, unknown>;
}

async function rejection(
  call: Promise<unknown>,
): Promise<{ code: string; details: Record<string, unknown> }> {
  try {
    await call;
  } catch (error) {
    const e = error as { code: string; details: Record<string, unknown> };
    return { code: e.code, details: e.details };
  }
  throw new Error('거절되지 않았다');
}

describe('REQ-API-145 개정 — 다음 번호는 열린 초안의 줄도 센다', () => {
  it('초안 둘이 차례로 번호를 받으면 겹치지 않는다 — 첫 초안이 쓴 번호를 둘째가 받지 않는다', async () => {
    const a = await draft('OWN-NEXT-A', body([['REQ-NXT-001', '하나를 한다']]));
    await approve(a);
    expect((await specs.nextRequirementRef({ projectId, prefix: 'NXT' })).ref).toBe('REQ-NXT-002');

    // 첫째 초안이 받은 번호를 본문에 쓴다(아직 승인 전이라 행은 없다)
    await draft('OWN-NEXT-B', body([['REQ-NXT-002', '둘을 한다']]));
    // 예전에는 여기서도 002 였다 — 두 초안이 같은 번호를 들고 승인을 다퉜다
    expect((await specs.nextRequirementRef({ projectId, prefix: 'NXT' })).ref).toBe('REQ-NXT-003');
  });

  it('검토 중인 초안의 줄도 세고, 인용만 한 번호와 다른 접두는 세지 않는다', async () => {
    const reviewing = await draft(
      'OWN-NEXT-C',
      body(
        [['REQ-NXT-007', '일곱을 한다']],
        '다른 문서의 REQ-NXT-050 을 인용한다. REQ-NXTX-090 도 있다.',
      ),
    );
    await pool.query(
      `UPDATE spec_version SET status = 'in_review', submitted_at = now(),
              edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
        WHERE id = $1`,
      [reviewing],
    );
    expect((await specs.nextRequirementRef({ projectId, prefix: 'NXT' })).ref).toBe('REQ-NXT-008');
  });
});

describe('REQ-API-309 승인은 다른 문서가 가진 번호를 덮지 않는다', () => {
  it('먼저 승인된 문서가 가진 번호로 승인하면 거절하고, 그 문서의 문장은 그대로다', async () => {
    // 둘 다 사전 검토를 지난 뒤(아직 행이 없을 때) 검토 중이 된다 — 경쟁 상황이다
    const a = await draft('OWN-RACE-A', body([['REQ-RACE-001', 'A 의 약속을 지킨다']]));
    const b = await draft(
      'OWN-RACE-B',
      body([['REQ-RACE-001', 'B 가 같은 번호로 다른 약속을 한다']]),
    );
    const aApproval = await submit(a);
    const bApproval = await submit(b);
    expect(aApproval).not.toBeNull();
    expect(bApproval).not.toBeNull();

    await decide(aApproval!);
    const refused = await rejection(decide(bApproval!));
    expect(refused.code).toBe(NERV_ERROR.PRECONDITION);
    expect(refused.details).toMatchObject({
      kind: 'requirement_owned',
      owned: [{ ref: 'REQ-RACE-001', owner_key: 'OWN-RACE-A' }],
    });

    expect(await requirement('REQ-RACE-001')).toMatchObject({
      owner: 'OWN-RACE-A',
      statement_md: 'WHEN 조건이 맞으면 THE SYSTEM SHALL A 의 약속을 지킨다',
    });
    // 승인은 통째로 되돌아갔다 — 문서는 검토 중 그대로이고 결재도 결정되지 않았다
    const { rows } = await pool.query(
      `SELECT sv.status::text AS s, (SELECT count(*)::int FROM approval a
                                      WHERE a.subject_id = sv.id AND a.decision IS NOT NULL) AS decided
         FROM spec_version sv WHERE sv.id = $1`,
      [b],
    );
    expect(rows[0]).toEqual({ s: 'in_review', decided: 0 });
  });

  it('사전 검토는 다른 문서가 가진 번호의 정의를 block 으로 잡는다 — 인용은 그대로 warning 이다', async () => {
    const a = await draft('OWN-CHECK-A', body([['REQ-CHK-001', '하나를 한다']]));
    await approve(a);

    const defines = await draft('OWN-CHECK-B', body([['REQ-CHK-001', '다른 약속']]));
    const blocked = await checks.check({ projectId, specVersionId: defines });
    expect(blocked.verdict).toBe('block');
    const finding = blocked.findings.find(
      (f) => f.checker === 'cross-spec' && f.severity === 'block',
    );
    expect(finding).toMatchObject({ anchor: 'REQ-CHK-001' });
    expect(finding!.message).toContain('OWN-CHECK-A');
    const refused = await rejection(submit(defines));
    expect(refused.details).toMatchObject({ kind: 'precheck_blocked' });

    const cites = await draft(
      'OWN-CHECK-C',
      body([['REQ-CHC-001', '자기 약속']], '이 문서는 REQ-CHK-001 을 전제로 한다.'),
    );
    const cited = await checks.check({ projectId, specVersionId: cites });
    expect(
      cited.findings.filter((f) => f.checker === 'cross-spec' && f.anchor === 'REQ-CHK-001'),
    ).toEqual([expect.objectContaining({ severity: 'warning' })]);
  });

  it('가진 문서의 최신 승인본에서 그 줄이 빠졌으면 옮겨 온다 — 주인이 바뀐 기록이 승인 이벤트에 남는다', async () => {
    const a1 = await draft(
      'OWN-MOVE-A',
      body([
        ['REQ-MOV-001', '옮길 약속'],
        ['REQ-MOV-002', '남을 약속'],
      ]),
    );
    await approve(a1);
    const a2 = await next('OWN-MOVE-A', a1, body([['REQ-MOV-002', '남을 약속']]));
    await approve(a2);
    expect((await requirement('REQ-MOV-001'))['removed_in_version_id']).toBe(a2);

    const b = await draft('OWN-MOVE-B', body([['REQ-MOV-001', '옮긴 약속']]));
    const check = await checks.check({ projectId, specVersionId: b });
    expect(check.findings.filter((f) => f.anchor === 'REQ-MOV-001')).toEqual([]);
    await approve(b);

    expect(await requirement('REQ-MOV-001')).toMatchObject({
      owner: 'OWN-MOVE-B',
      statement_md: 'WHEN 조건이 맞으면 THE SYSTEM SHALL 옮긴 약속',
      removed_in_version_id: null,
      introduced_in_version_id: b,
    });
    const { rows } = await pool.query(
      `SELECT payload FROM event WHERE type = $1 AND subject_id = $2`,
      [NERV_EVENT.SPEC_APPROVED, b],
    );
    expect(rows[0].payload).toMatchObject({
      requirements_moved: [{ ref: 'REQ-MOV-001', from_key: 'OWN-MOVE-A' }],
    });

    // 옮긴 뒤에는 옛 문서가 같은 번호를 다시 정의하면 막힌다 — 이제 B 의 것이다
    const a3 = await next(
      'OWN-MOVE-A',
      a2,
      body([
        ['REQ-MOV-002', '남을 약속'],
        ['REQ-MOV-001', '되찾기'],
      ]),
    );
    expect((await checks.check({ projectId, specVersionId: a3 })).verdict).toBe('block');
  });

  it('같은 문서의 다음 승인은 그대로 문장을 고친다', async () => {
    const a1 = await draft('OWN-SELF', body([['REQ-SLF-001', '처음 약속']]));
    await approve(a1);
    const a2 = await next('OWN-SELF', a1, body([['REQ-SLF-001', '고친 약속']]));
    await approve(a2);
    expect(await requirement('REQ-SLF-001')).toMatchObject({
      owner: 'OWN-SELF',
      statement_md: 'WHEN 조건이 맞으면 THE SYSTEM SHALL 고친 약속',
      introduced_in_version_id: a1,
    });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [planner, 'jimin@example.com', '지민'],
    [reviewer, 'sora@example.com', '소라'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const user of [planner, reviewer]) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), orgId, projectId, user],
    );
  }
}
