// E13-S01·S02 — 받은 요청 · 질문 에스컬레이션.
//
// **Phase 1 종료 게이트의 직접 대상이다**: 파일럿 2주간 플랫폼 밖에서 처리된 승인 0건.
// 그러려면 승인이 여기서 되는 것만으로 부족하고 **여기서만** 되어야 한다 —
// 그 성질을 검증하는 것이 이 스위트의 절반이다.

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

/** 한 줄 세기 — 이벤트·행 수를 보는 자리가 여럿이다 */
async function count(query: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(query);
  return rows[0]?.n ?? 0;
}

/** 사람 주체 — 받은 요청·면제·답변은 사람 전용이다(REQ-API-123) */
const person = (userId: string) => ({ userId, isAgent: false });
/** 에이전트 주체 — 같은 자리에서 막히는지 보는 쪽 */
const agent = (userId: string) => ({ userId, isAgent: true });

/**
 * EP-APR-05 프로젝트 받은 요청의 **카드만** — 봉투는 전역과 같다(REQ-API-166).
 *
 * 이 표면은 2026-09-24 부터 전역 질의를 프로젝트로 좁혀 부른다. 자기 질의를 들고 있던
 * 동안 **같은 질문에 다른 답**을 냈다(질문을 안 실었고, 보관한 프로젝트를 안 걸렀다).
 */
const projectInbox = async (
  userId: string,
  actor: { userId: string; isAgent: boolean } = person(userId),
): Promise<Record<string, unknown>[]> =>
  (await approvals.inbox({ projectId, userId, actor })).items;

let db: ScratchDb;
let pool: pg.Pool;
let approvals: ApprovalService;
let specs: SpecService;
let questions: QuestionService;
let projectId: string;
let planner: string;
let reviewer: string;
let designer: string;
let developer: string;
let qa: string;
let viewer: string;
let sessionId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_approval');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  // 결정이 문서를 움직이므로 결재 서비스가 스펙 서비스를 쥔다(REQ-API-063)
  specs = new SpecService(
    events,
    new SpecCheckService(drizzleDb),
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    new AttachmentService(null as never, drizzleDb),
    drizzleDb,
  );
  approvals = new ApprovalService(events, specs, new AuthService(drizzleDb), drizzleDb);
  questions = new QuestionService(events, drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM question');
  // notification.event_id 는 **논리 FK** 라(4.3 §2.10) event 를 지워도 따라 지워지지 않는다.
  // 남겨두면 다음 테스트가 앞 테스트의 알림을 자기 것으로 본다.
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  await pool.query(`UPDATE agent_session SET state = 'active'`);
});

// 2026-08-30 사람 결정 — admin 은 자기가 만든 요청을 스스로 결재할 수 있다.
// 지시자≠승인자 규칙이 막으려는 것은 **에이전트가 자기 산출물을 통과시키는 것**이고(D-01),
// 사람 admin 이 자기 판단에 서명하는 것은 다른 일이다.
// 2026-08-31 사람 보고 — "받은 요청에 등록됐는데 보이지 않는 항목이 있다".
// sudoku 실측: 거절 2건이 결재에는 남았는데 스펙은 둘 다 `in_review` 에 갇혀 있었다.
// 결재 행만 고치고 **대상을 움직이지 않았기** 때문이다 — 카드는 사라지고(decision 이
// 채워졌다) 문서는 고칠 수도 다시 제출할 수도 없는 상태로 남는다(D-02).
async function hashOfVersion(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

describe('결정은 대상을 움직인다 (REQ-API-063)', () => {
  async function inReviewVersion(key: string): Promise<{ specId: string; versionId: string }> {
    const created = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key,
      title: key,
      type: 'feature',
      bodyMd: `# ${key}\n\n본문`,
      userId: planner,
    });
    const versionId = created['spec_version_id'] as string;
    // 리스는 draft 에만 붙는다(CHECK) — 제출이 그것을 놓는 것과 같은 순서로 흉내 낸다
    await pool.query(
      `UPDATE spec_version SET status = 'in_review', submitted_at = now(),
              edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
        WHERE id = $1`,
      [versionId],
    );
    return { specId: created['spec_id'] as string, versionId };
  }

  async function statusOf(versionId: string): Promise<string> {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    return rows[0]!.status;
  }

  it('거절하면 문서가 draft 로 돌아온다 — 갇히지 않는다', async () => {
    const { specId, versionId } = await inReviewVersion('SPC-DECIDE-REJ');
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: planner,
    });

    await approvals.decide({
      actor: { userId: planner, isAgent: false },
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'reject',
      comment: '잘못된 서술 존재',
    });

    expect(await statusOf(versionId)).toBe('draft');
    // 되돌아왔으니 **다시 고칠 수 있다** — 그것이 갇히지 않는다는 말의 뜻이다
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: await hashOfVersion(versionId),
        bodyMd: '# 고쳐서 다시 쓴다',
        userId: planner,
      }),
    ).resolves.toBeDefined();
  });

  it('승인하면 문서가 approved 가 된다 — 결재만 남고 마는 일이 없다', async () => {
    const { versionId } = await inReviewVersion('SPC-DECIDE-APR');
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: planner,
    });

    await approvals.decide({
      actor: { userId: planner, isAgent: false },
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'approve',
    });
    expect(await statusOf(versionId)).toBe('approved');
  });

  it('코멘트는 문서를 draft 로 되돌린다 — 갇히지 않는다 (3.5 §2.5)', async () => {
    const { specId, versionId } = await inReviewVersion('SPC-DECIDE-CMT');
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: planner,
    });

    await approvals.decide({
      actor: { userId: planner, isAgent: false },
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'comment',
      comment: '한 가지만 확인해 주세요',
    });

    // 예전에는 여기서 `in_review` 로 남았다 — 카드는 사라지고(결정됨) 문서는 편집도
    // 재제출도 불가(D-02)라 되살릴 길이 없었다. 실측으로 그 상태의 스펙 2건이 있었다.
    expect(await statusOf(versionId)).toBe('draft');

    // 되돌아왔으니 고치고 다시 낼 수 있다 — 그것이 "말을 남긴다" 의 값이다
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        baseHash: await hashOfVersion(versionId),
        bodyMd: '# 확인했습니다',
        userId: planner,
      }),
    ).resolves.toBeDefined();
  });

  it('스펙이 아닌 대상은 조용히 넘어간다 — 여기서 던지면 결정이 통째로 롤백된다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: reviewer,
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ decision: 'approve' });
  });
});

describe('자기 승인 — 두 가지 완화 (REQ-API-062)', () => {
  it('viewer 는 결재를 내리지 못한다 — 역할 큐가 문이다 (EP-APR-03)', async () => {
    const viewer = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'viewer-apr@example.com','뷰어','active')`,
      [viewer],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'viewer' FROM project WHERE id = $3`,
      [newId(), viewer, projectId],
    );

    const { approval_id: approvalId } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });

    // 전역 경로(`/api/v1/approvals/{id}/decision`)라 프로젝트 가드가 소속을 채우지 않고
    // 지나간다 — 판정은 서비스가 한다(D-05).
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId,
        userId: viewer,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'missing_scope', required: ['approval:decide'] },
    });

    // 결정은 남지 않았다 — 카드는 여전히 대기다
    const { rows } = await pool.query<{ decision: string | null }>(
      `SELECT decision::text AS decision FROM approval WHERE id = $1`,
      [approvalId],
    );
    expect(rows[0]?.decision).toBeNull();

    // planner 는 같은 카드를 결재한다
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId,
        userId: reviewer,
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ decision: 'approve' });
  });

  it('planner 는 자기 요청을 승인하지 못한다 — 규칙은 그대로다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: planner,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      // 대신 누를 수 있는 사람을 말한다 — 목록의 정본은 `ROLE_SCOPES` 다(2026-09-07 ·
      // 그전에는 admin 만 적어, planner 가 있는데도 없다고 말했다)
      details: { kind: 'self_approval', allowed_roles: ['admin', 'planner'] },
    });
  });

  it('요청자도 거절·코멘트는 할 수 있다 — 막는 것은 승인뿐이다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: planner,
        decision: 'reject',
      }),
    ).resolves.toMatchObject({ decision: 'reject' });
  });

  it('카드가 승인 가능 여부를 실어 준다 — 화면이 규칙을 다시 구현하지 않는다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    const mine = (await projectInbox(planner, person(planner))).find((c) => c.id === approval_id);
    expect(mine).toMatchObject({ self_requested: true, can_approve: false });

    const others = (await projectInbox(reviewer, person(reviewer))).find(
      (c) => c.id === approval_id,
    );
    expect(others).toMatchObject({ self_requested: false, can_approve: true });
    // **어느 조직의 일인지 싣는다**(2026-09-24 · REQ-API-170) — 받은 요청은 조직을 가로지른다
    expect(others).toMatchObject({ org_slug: 'nerv', org_name: 'NERV' });
    expect(typeof others?.['project_name']).toBe('string');
  });

  it('admin 은 자기 요청을 승인한다 — 없으면 어떤 결재도 끝나지 않는 상황이 생긴다', async () => {
    const admin = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
      [admin],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,(SELECT org_id FROM project WHERE id = $2),$2,$3,'admin')`,
      [newId(), projectId, admin],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: admin,
    });

    // 화면도 같은 답을 받는다 — 단추를 끌지 말지는 서버가 정한다
    const card = (await projectInbox(admin, person(admin))).find((c) => c.id === approval_id);
    expect(card).toMatchObject({ self_requested: true, can_approve: true });

    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: admin,
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ decision: 'approve' });

    // **감사에 남는다.** 예외를 허용하는 것과 그것을 감추는 것은 다른 일이다
    const { rows } = await pool.query<{ payload: { self_approved?: boolean } }>(
      `SELECT payload FROM event WHERE subject_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [approval_id],
    );
    expect(rows[0]?.payload?.self_approved).toBe(true);
  });

  it('조직 단위 admin 도 같다 — 프로젝트 행이 없다고 권한이 없는 것은 아니다', async () => {
    const orgAdmin = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'org@example.com','조직관리자','active')`,
      [orgAdmin],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,(SELECT org_id FROM project WHERE id = $2),NULL,$3,'admin')`,
      [newId(), projectId, orgAdmin],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: orgAdmin,
    });
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: orgAdmin,
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ decision: 'approve' });
  });
});

/**
 * **결재는 결재다**(2026-09-07 · REQ-API-128). 결정이 남긴 이벤트가 `question.answered`
 * 였다 — 질문에 답한 적이 없는데 답한 것으로 세였고, 결재를 세려는 쪽은 셀 것이 없었다.
 */
describe('결재가 남기는 사실 (REQ-API-128)', () => {
  it('결정하면 approval.decided 가 남는다 — 질문에 답한 것으로 세지 않는다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'reject',
      comment: '근거가 얇다',
    });

    const { rows } = await pool.query<{
      type: string;
      actor: string | null;
      to_state: string | null;
      payload: { decision?: string; subject_type?: string };
    }>(
      `SELECT type, actor_user_id AS actor, to_state, payload FROM event
        WHERE subject_id = $1 AND subject_type = 'approval' AND type <> 'approval.requested'`,
      [approval_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: NERV_EVENT.APPROVAL_DECIDED,
      actor: reviewer,
      to_state: 'reject',
    });
    expect(rows[0]?.payload).toMatchObject({ decision: 'reject', subject_type: 'plan' });
    expect(await pool.query(`SELECT 1 FROM event WHERE type = 'question.answered'`)).toMatchObject({
      rowCount: 0,
    });
  });
});

/**
 * **지시자≠승인자는 세 축이다**(2026-09-07 · REQ-API-136 · spec-workflow §2.3).
 *
 * 요청자만 비교하던 동안 구멍이 있었다: 작성자가 남에게 제출을 부탁하면 요청자는 그 남이
 * 되고, 작성자는 자기 초안을 자기 손으로 승인할 수 있었다.
 */
describe('지시자≠승인자 세 축 (REQ-API-136)', () => {
  /** 남이 제출한 초안 — 요청자와 작성자가 다른 상황을 만든다 */
  async function draftSubmittedByOther(
    key: string,
    authorUserId: string,
    authorSessionId: string | null = null,
  ): Promise<{ versionId: string; approvalId: string }> {
    const created = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key,
      title: key,
      type: 'feature',
      bodyMd: `# ${key}\n\n본문`,
      userId: authorUserId,
    });
    const versionId = created['spec_version_id'] as string;
    if (authorSessionId !== null) {
      await pool.query(`UPDATE spec_version SET author_session_id = $1 WHERE id = $2`, [
        authorSessionId,
        versionId,
      ]);
    }
    await pool.query(
      `UPDATE spec_version SET status='in_review', submitted_at = now(),
              edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
        WHERE id = $1`,
      [versionId],
    );
    // 제출한 사람은 reviewer 다 — 요청자 축은 그 사람이 된다
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: reviewer,
    });
    return { versionId, approvalId: approval_id };
  }

  it('남이 제출해 줘도 작성자는 자기 초안을 승인하지 못한다', async () => {
    const { approvalId } = await draftSubmittedByOther('SPC-AXIS-AUTHOR', planner);
    await expect(
      approvals.decide({
        actor: person(planner),
        projectId,
        approvalId,
        userId: planner,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'self_approval', self_kind: 'author' },
    });

    // 거절·코멘트는 여전히 할 수 있다 — 막는 것은 승인뿐이다
    await expect(
      approvals.decide({
        actor: person(planner),
        projectId,
        approvalId,
        userId: planner,
        decision: 'comment',
        comment: '내가 쓴 것이지만 이 부분은 다시 본다',
      }),
    ).resolves.toMatchObject({ decision: 'comment' });
  });

  it('내 세션이 쓴 초안도 내 것이다 — 자기가 시킨 것을 자기가 통과시키지 않는다', async () => {
    const { approvalId } = await draftSubmittedByOther(
      'SPC-AXIS-SESSION',
      reviewer,
      sessionId, // sessionId 의 소유자는 planner 다
    );
    await expect(
      approvals.decide({
        actor: person(planner),
        projectId,
        approvalId,
        userId: planner,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'self_approval', self_kind: 'session_owner' },
    });
  });

  it('카드가 이유를 함께 준다 — 잠긴 단추에는 이유가 있어야 한다', async () => {
    const { approvalId } = await draftSubmittedByOther('SPC-AXIS-REASON', planner);
    const mine = (await projectInbox(planner, person(planner))).find((c) => c.id === approvalId);
    expect(mine).toMatchObject({ can_approve: false, can_approve_reason: 'author' });

    const theirs = (await projectInbox(reviewer, person(reviewer))).find(
      (c) => c.id === approvalId,
    );
    // 요청자 축 — 제출한 사람은 reviewer 다
    expect(theirs).toMatchObject({ can_approve: false, can_approve_reason: 'self_requested' });
  });
});

/**
 * **T3 는 서로 다른 두 사람이다**(2026-09-07 · REQ-API-140 · spec-workflow §1.2).
 *
 * 문서는 그 약속을 오래 적어 두었는데 서버는 **첫 approve 로 전이**했다 — 실측 T3 승인
 * 3건 모두 1인 승인이었고, 카드에는 n/2 표시가 없어 승인자는 자기가 마지막 결재라고 믿었다.
 */
describe('T3 정족수 (REQ-API-140)', () => {
  /** convention + 참조 6 + 첫 버전 → 4축 6점 = T3 */
  async function t3Submitted(key: string): Promise<{ versionId: string }> {
    const created = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key,
      title: key,
      type: 'convention',
      bodyMd: `# ${key}\n\n- REQ-${key.slice(-4)}-001 WHEN 조건이면 THE SYSTEM SHALL 동작한다`,
      userId: planner,
    });
    const specId = created['spec_id'] as string;
    const versionId = created['spec_version_id'] as string;
    for (let i = 0; i < 6; i += 1) {
      const otherId = newId();
      await pool.query(
        `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
        [otherId, projectId, `SPC-REF-${key.slice(-4)}-${i}`],
      );
      await pool.query(
        `INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
         VALUES ($1,$2,$3,$4,'references')`,
        [newId(), projectId, otherId, specId],
      );
    }
    const result = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
      roles: ['planner'],
    });
    expect(result.gate.tier).toBe('T3');
    expect(result.status).toBe('in_review');
    return { versionId };
  }

  async function slots(versionId: string): Promise<{ id: string; role: string | null }[]> {
    const { rows } = await pool.query<{ id: string; role: string | null }>(
      `SELECT id, assignee_role::text AS role FROM approval
        WHERE subject_id = $1 AND decision IS NULL ORDER BY assignee_role NULLS FIRST`,
      [versionId],
    );
    return rows;
  }

  async function statusOfVersion(versionId: string): Promise<string | null> {
    const { rows } = await pool.query<{ s: string }>(
      `SELECT status::text AS s FROM spec_version WHERE id = $1`,
      [versionId],
    );
    return rows[0]?.s ?? null;
  }

  it('슬롯 둘이 서고 하나는 문서 타입의 직군 큐다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-1');
    expect((await slots(versionId)).map((r) => r.role)).toEqual([null, 'developer']);

    // 슬롯마다 이벤트가 하나씩이다 — 알림 수신자가 그 행의 지정·직군으로 갈리기 때문이다.
    // 같은 트랜잭션이라 `occurred_at` 이 같으니 순서가 아니라 **집합**으로 본다.
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT e.payload FROM event e JOIN approval a ON a.id = e.subject_id
        WHERE e.type = 'approval.requested' AND a.subject_id = $1`,
      [versionId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.payload['required_approvers'] === 2)).toBe(true);
    expect(new Set(rows.map((r) => r.payload['role_slot'] ?? null))).toEqual(
      new Set([null, 'developer']),
    );
  });

  it('둘째 슬롯의 직군에게도 알림이 간다 — 안 누르면 문서는 확정되지 않는다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const { versionId } = await t3Submitted('SPC-QUORUM-7');
    expect(await notifications.route()).toBeGreaterThan(0);

    const { rows } = await pool.query<{ user_id: string; role: string | null }>(
      `SELECT DISTINCT n.user_id, a.assignee_role::text AS role
         FROM notification n
         JOIN event e ON e.id = n.event_id
         JOIN approval a ON a.id = e.subject_id
        WHERE e.type = 'approval.requested' AND a.subject_id = $1`,
      [versionId],
    );
    // 직군 슬롯의 알림은 그 직군에게만 간다
    expect(rows.filter((r) => r.role === 'developer').map((r) => r.user_id)).toEqual([developer]);
    // 기본 슬롯은 결재 큐로 간다(요청자 자신은 빠진다)
    expect(rows.filter((r) => r.role === null).map((r) => r.user_id)).toContain(reviewer);
  });

  it('카드가 몇 명 중 몇 명인지 싣는다 — 화면이 그 값을 그린다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-6');
    const [first] = await slots(versionId);
    const before = (await projectInbox(reviewer, person(reviewer))).find((c) => c.id === first!.id);
    expect(before).toMatchObject({ approvals_required: 2, approvals_given: 0 });

    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: first!.id,
      userId: reviewer,
      decision: 'approve',
    });
    const after = (await projectInbox(developer, person(developer))).find(
      (c) => c['assignee_role'] === 'developer',
    );
    expect(after).toMatchObject({ approvals_required: 2, approvals_given: 1 });
  });

  it('첫 승인은 문서를 옮기지 않는다 — 승인자는 자기가 마지막이라고 믿는다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-2');
    const [first, second] = await slots(versionId);

    const one = await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: first!.id,
      userId: reviewer,
      decision: 'approve',
    });
    expect(one.quorum).toMatchObject({ given: 1, required: 2, satisfied: false });
    expect(await statusOfVersion(versionId)).toBe('in_review');

    const two = await approvals.decide({
      actor: person(developer),
      projectId,
      approvalId: second!.id,
      userId: developer,
      decision: 'approve',
    });
    expect(two.quorum).toMatchObject({ given: 2, required: 2, satisfied: true });
    expect(await statusOfVersion(versionId)).toBe('approved');
    expect(await count(`SELECT count(*)::int AS n FROM event WHERE type = 'spec.approved'`)).toBe(
      1,
    );
  });

  it('한 사람이 두 슬롯을 채우지 못한다 — "서로 다른 사용자" 가 그 뜻이다', async () => {
    // 슬롯 둘 다에 자격이 있는 사람이라야 이 규칙이 시험된다 — admin 이 그 자리다
    // (planner 는 developer 슬롯에서 역할 큐로 먼저 막힌다)
    const admin = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'boss@example.com','대표','active')`,
      [admin],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,(SELECT org_id FROM project WHERE id = $2),$2,$3,'admin')`,
      [newId(), projectId, admin],
    );
    const { versionId } = await t3Submitted('SPC-QUORUM-3');
    const [first, second] = await slots(versionId);
    await approvals.decide({
      actor: person(admin),
      projectId,
      approvalId: first!.id,
      userId: admin,
      decision: 'approve',
    });
    await expect(
      approvals.decide({
        actor: person(admin),
        projectId,
        approvalId: second!.id,
        userId: admin,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'already_approved' },
    });
    expect(await statusOfVersion(versionId)).toBe('in_review');
  });

  it('동시에 승인해도 전이는 한 번이다 — 각자 1을 세고 아무도 안 옮기는 일이 없다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-4');
    const [first, second] = await slots(versionId);

    const results = await Promise.allSettled([
      approvals.decide({
        actor: person(reviewer),
        projectId,
        approvalId: first!.id,
        userId: reviewer,
        decision: 'approve',
      }),
      approvals.decide({
        actor: person(developer),
        projectId,
        approvalId: second!.id,
        userId: developer,
        decision: 'approve',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await statusOfVersion(versionId)).toBe('approved');
    expect(await count(`SELECT count(*)::int AS n FROM event WHERE type = 'spec.approved'`)).toBe(
      1,
    );
  });

  it('거절이 라운드를 닫는다 — 남은 슬롯은 대기 목록에 없고 재제출은 0부터 센다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-5');
    const [first, second] = await slots(versionId);
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: first!.id,
      userId: reviewer,
      decision: 'approve',
    });
    await approvals.decide({
      actor: person(developer),
      projectId,
      approvalId: second!.id,
      userId: developer,
      decision: 'reject',
      comment: '규약을 더 좁혀야 한다',
    });
    expect(await statusOfVersion(versionId)).toBe('draft');

    // 남은 슬롯은 없다(둘 다 결정됐다) — 그리고 문서가 draft 라 대기 목록에도 없다
    const { items: cards } = await approvals.inboxGlobal({
      actor: person(reviewer),
      userId: reviewer,
    });
    expect(cards.filter((c) => c['subject_id'] === versionId)).toEqual([]);

    // 다시 제출하면 새 라운드다 — 옛 approve 는 세지 않는다
    await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
      roles: ['planner'],
    });
    const fresh = await slots(versionId);
    expect(fresh).toHaveLength(2);
    const again = await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: fresh[0]!.id,
      userId: reviewer,
      decision: 'approve',
    });
    expect(again.quorum).toMatchObject({ given: 1, required: 2, satisfied: false });
  });

  /**
   * **한 슬롯만 거절된 뒤 다시 내도 두 사람이다**(2026-09-26 — 결정 철회 검토에서 실측).
   *
   * 두 슬롯 중 하나만 거절되면 다른 슬롯은 결정 없이 남고, 다시 제출하면 그 슬롯을 재사용한다. 요청 시각이 옛
   * 라운드의 것이라 정족수가 그것을 빼고 **필요 수 1** 로 세어, 새 슬롯 하나의 승인으로 문서가 확정됐다.
   */
  it('한 슬롯만 거절된 뒤 다시 내도 두 사람이 필요하다 — 남은 슬롯은 새 라운드의 슬롯이다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-RS');
    const [first, second] = await slots(versionId);
    await approvals.decide({
      actor: person(developer),
      projectId,
      approvalId: second!.id,
      userId: developer,
      decision: 'reject',
      comment: '범위를 좁혀야 한다',
    });
    expect(await statusOfVersion(versionId)).toBe('draft');

    await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
      roles: ['planner'],
    });
    const fresh = await slots(versionId);
    expect(fresh).toHaveLength(2);
    // 남은 슬롯을 재사용했다 — 그리고 그 요청 시각은 이번 제출의 것이다
    expect(fresh.map((s) => s.id)).toContain(first!.id);
    const { rows: stamp } = await pool.query<{ ok: boolean }>(
      `SELECT a.requested_at >= sv.submitted_at AS ok
         FROM approval a JOIN spec_version sv ON sv.id = a.subject_id WHERE a.id = $1`,
      [first!.id],
    );
    expect(stamp[0]?.ok).toBe(true);

    const newSlot = fresh.find((s) => s.id !== first!.id)!;
    const one = await approvals.decide({
      actor: person(developer),
      projectId,
      approvalId: newSlot.id,
      userId: developer,
      decision: 'approve',
    });
    expect(one.quorum).toMatchObject({ given: 1, required: 2, satisfied: false });
    expect(await statusOfVersion(versionId)).toBe('in_review');

    const two = await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: first!.id,
      userId: reviewer,
      decision: 'approve',
    });
    expect(two.quorum).toMatchObject({ given: 2, required: 2, satisfied: true });
    expect(await statusOfVersion(versionId)).toBe('approved');
  });

  it('거절로 라운드가 닫히면 요청 세션이 깨어난다 — 결정 없이 남은 형제 슬롯이 붙잡지 않는다', async () => {
    const { versionId } = await t3Submitted('SPC-QUORUM-WK');
    const [, second] = await slots(versionId);
    await pool.query(`UPDATE approval SET requested_by_session_id = $1 WHERE subject_id = $2`, [
      sessionId,
      versionId,
    ]);
    await pool.query(`UPDATE agent_session SET state = 'awaiting_input' WHERE id = $1`, [
      sessionId,
    ]);
    await approvals.decide({
      actor: person(developer),
      projectId,
      approvalId: second!.id,
      userId: developer,
      decision: 'reject',
      comment: '다시',
    });
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0]?.state).toBe('active');
  });
});

describe('내 큐만 온다 (REQ-API-137)', () => {
  it('결재권이 없는 사람의 받은 요청에는 카드가 없다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    expect(await projectInbox(viewer, person(viewer))).toEqual([]);
    expect(await projectInbox(qa, person(qa))).toEqual([]);
    // 기본 큐(admin·planner)에는 온다
    expect((await projectInbox(reviewer, person(reviewer))).length).toBe(1);
  });

  it('직군 슬롯은 그 직군에게만 간다 — planner 도 대신 내리지 못한다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: reviewer,
      assigneeRole: 'designer',
    });

    const forDesigner = (await projectInbox(designer, person(designer))).find(
      (c) => c.id === approval_id,
    );
    expect(forDesigner).toMatchObject({ can_approve: true, assignee_role: 'designer' });

    expect(
      (await projectInbox(planner, person(planner))).find((c) => c.id === approval_id),
    ).toBeUndefined();

    await expect(
      approvals.decide({
        actor: person(planner),
        projectId,
        approvalId: approval_id,
        userId: planner,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'not_in_role_queue', role: 'designer' },
    });

    await expect(
      approvals.decide({
        actor: person(designer),
        projectId,
        approvalId: approval_id,
        userId: designer,
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ decision: 'approve' });
  });
});

describe('E13-S01 받은 요청 — 내 결정을 기다리는 것만 (§6.6 원칙 3)', () => {
  it('결정되지 않은 카드만 온다 — 처리한 것은 사라진다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    expect(await projectInbox(reviewer, person(reviewer))).toHaveLength(1);

    await approvals.decide({
      actor: { userId: planner, isAgent: false },
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'approve',
    });
    expect(await projectInbox(reviewer, person(reviewer))).toHaveLength(0);
  });

  it('지정 승인자가 있으면 그 사람에게만 보인다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
      assigneeUserId: reviewer,
    });
    expect(await projectInbox(reviewer, person(reviewer))).toHaveLength(1);
    expect(await projectInbox(planner, person(planner))).toHaveLength(0);
  });

  it('카드가 self_requested 를 표시한다 — 내가 올린 것을 내가 승인할 수 없음을 UI 가 안다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    const [card] = await projectInbox(planner, person(planner));
    expect(card?.self_requested).toBe(true);
  });

  it('같은 대상의 요청은 재사용된다 — 카드가 중복되면 받은 요청이 즉시 무너진다', async () => {
    const subjectId = newId();
    const first = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId,
      requestedByUserId: planner,
    });
    const second = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId,
      requestedByUserId: planner,
    });

    expect(second.approval_id).toBe(first.approval_id);
    expect(second.reused).toBe(true);
    expect(await projectInbox(reviewer, person(reviewer))).toHaveLength(1);
  });
});

/**
 * **EP-APR-05 는 전역을 프로젝트로 좁힌 것이다**(2026-09-24 · REQ-API-167).
 *
 * 자기 질의를 따로 들고 있던 동안 **같은 질문에 다른 답**을 냈다 — 실측(결재 3 + 질문 2):
 * 프로젝트 표면 3건(`plan` 만) · 전역 표면 5건(`plan`·`question`). 보관한 뒤로는 전역 0건 ·
 * 프로젝트 3건이었다. 판정이 두 벌이면 언젠가 한쪽만 고쳐진다(D-05) — 셋 다 그렇게 벌어졌다.
 */
describe('프로젝트 받은 요청은 전역과 같은 목록이다 (REQ-API-167)', () => {
  it('질문도 함께 싣는다 — 전표가 "결재 + 질문" 이라 적는다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: reviewer,
    });
    await questions.create({ projectId, sessionId, title: '스토리지 선택' });

    const kinds = (await projectInbox(planner)).map((c) => String(c['subject_type']));
    expect(kinds).toContain('plan');
    expect(kinds).toContain('question');
  });

  it('보관한 프로젝트의 결재는 여기에도 오지 않는다 — 전역에서 고친 규칙이 안 닿았다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: reviewer,
    });
    expect((await projectInbox(planner)).length).toBeGreaterThan(0);

    await pool.query(`UPDATE project SET archived_at = now() WHERE id = $1`, [projectId]);
    // **치운 프로젝트를 사람이 계속 결재하도록 두면 받은 요청을 못 믿게 된다**(2026-08-27).
    // 그 판정이 전역에만 있어서, 같은 목록을 프로젝트 주소로 읽으면 그대로 나왔다.
    expect(await projectInbox(planner)).toEqual([]);
    await pool.query(`UPDATE project SET archived_at = NULL WHERE id = $1`, [projectId]);
  });

  it('카드의 모양이 전역과 같다 — 열이 다르면 같은 컴포넌트가 못 그린다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: reviewer,
    });
    const [scoped] = await projectInbox(planner);
    const { items } = await approvals.inboxGlobal({ actor: person(planner), userId: planner });
    const global = items.find((c) => c['id'] === scoped?.['id']);
    expect(Object.keys(scoped ?? {}).sort()).toEqual(Object.keys(global ?? {}).sort());
    // 카드가 반드시 싣는 것 — **얼마나 기다렸나**(REQ-WEB-008)와 갈 곳(링크)
    expect(scoped).toHaveProperty('waiting_seconds');
    expect(scoped).toHaveProperty('project_slug');
  });

  it('처리됨도 같은 축으로 읽는다 — 주소만 다른 같은 목록이다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: reviewer,
    });
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId: approval_id,
      userId: planner,
      decision: 'approve',
    });
    const decided = await approvals.inbox({
      projectId,
      userId: planner,
      actor: person(planner),
      state: 'decided',
    });
    expect(decided.items.map((c) => c['id'])).toContain(approval_id);
    expect(decided.total).toBeGreaterThan(0);
  });

  it('커서도 같다 — 자라는 목록은 여기서도 쪽으로 나뉜다 (REQ-API-166)', async () => {
    for (let i = 0; i < 7; i += 1) {
      await approvals.request({
        projectId,
        subjectType: 'plan',
        subjectId: newId(),
        requestedByUserId: reviewer,
      });
    }
    const first = await approvals.inbox({
      projectId,
      userId: planner,
      actor: person(planner),
      limit: 3,
    });
    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(7);
    expect(first.next_cursor).not.toBeNull();
  });
});

describe('E13-S01 프로젝트 받은 요청도 사람 전용이다 (REQ-API-123)', () => {
  it('에이전트 주체는 프로젝트 받은 요청을 읽지 못한다 — 전역 경로와 같은 규칙', async () => {
    await expect(projectInbox(reviewer, agent(reviewer))).rejects.toMatchObject({
      code: NERV_ERROR.HUMAN_ONLY,
    });
  });
});

describe('E13-S01 결정 — stale 승인 차단', () => {
  it('카드를 연 뒤 내용이 바뀌면 결정을 거부한다 — 사람이 본 것과 승인되는 것이 달라지면 안 된다', async () => {
    // draft 대상이라 본문이 아직 가변이다(in_review 부터는 트리거가 동결한다)
    const versionId = await makeSpecVersion('# 원본 본문');
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: planner,
    });

    // **지문은 카드 상세에서 읽는다**(EP-APR-02) — 결정 화면이 실제로 읽는 그 자리다.
    // 목록에서 읽지 않는 이유: 이 픽스처의 대상은 일부러 `draft` 인데(본문이 가변이어야
    // 본문을 바꿔 볼 수 있다) 받은 요청 목록은 `in_review` 만 싣는다 — 거절로 draft 가 된
    // 문서의 남은 슬롯은 대기가 아니기 때문이다. 2026-09-24 에 EP-APR-05 가 전역 질의를
    // 부르게 되면서 이 표면에도 그 규칙이 닿았다(예전에는 draft 대상도 목록에 있었다).
    const card = await approvals.detail({
      approvalId: approval_id,
      userId: reviewer,
      actor: person(reviewer),
    });
    const seen = card['content_hash'] as string;

    // 사람이 카드를 보는 동안 초안이 바뀐다
    await pool.query(
      `UPDATE spec_version SET body_md = '# 바뀐 본문', content_hash = digest('# 바뀐 본문','sha256') WHERE id = $1`,
      [versionId],
    );

    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: reviewer,
        decision: 'approve',
        seenContentHash: seen,
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('내용이 그대로면 통과한다', async () => {
    const versionId = await makeSpecVersion('# 안 바뀐 본문', 'in_review');
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: planner,
    });
    const [card] = await projectInbox(reviewer, person(reviewer));

    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: reviewer,
        decision: 'approve',
        seenContentHash: card?.content_hash as string,
      }),
    ).resolves.toMatchObject({ decision: 'approve' });
  });

  it('이미 결정된 항목은 다시 결정할 수 없다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await approvals.decide({
      actor: { userId: planner, isAgent: false },
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'approve',
    });
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: reviewer,
        decision: 'reject',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('요청자는 자기 요청을 승인할 수 없다 — 거절·코멘트는 할 수 있다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: planner,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });

    await expect(
      approvals.decide({
        actor: { userId: planner, isAgent: false },
        projectId,
        approvalId: approval_id,
        userId: planner,
        decision: 'comment',
      }),
    ).resolves.toBeDefined();
  });
});

describe('E13-S01 게이트 면제 — 면제도 결재 레코드다 (FR-10)', () => {
  it('사유 없는 면제는 거부한다', async () => {
    await expect(
      approvals.bypass({
        projectId,
        subjectType: 'gate_bypass',
        subjectId: newId(),
        userId: planner,
        actor: person(planner),
        reason: '  ',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  /**
   * 2026-09-07(REQ-API-123) — 역할 문턱은 PAT 도 지난다. 게이트는 사유 검사보다 앞이라
   * 에이전트 호출은 DB 를 한 번도 건드리지 않는다: 레코드도 이벤트도 남지 않아야 한다.
   */
  it('에이전트는 면제를 만들 수 없다 — 레코드도 이벤트도 남지 않는다', async () => {
    await expect(
      approvals.bypass({
        projectId,
        subjectType: 'gate_bypass',
        subjectId: newId(),
        userId: planner,
        actor: agent(planner),
        reason: '릴리스 임박',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval WHERE is_bypass`,
    );
    expect(rows[0]?.n).toBe(0);
    const events = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type = 'gate.bypassed'`,
    );
    expect(events.rows[0]?.n).toBe(0);
  });

  it('면제는 레코드와 이벤트를 남긴다 — 기록되지 않는 면제는 구멍이다', async () => {
    await approvals.bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: newId(),
      userId: planner,
      actor: person(planner),
      reason: '릴리스 임박 — 팀장 구두 승인',
    });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval WHERE is_bypass AND bypass_reason IS NOT NULL`,
    );
    expect(rows[0]?.n).toBe(1);
    const events = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type = 'gate.bypassed'`,
    );
    expect(events.rows[0]?.n).toBe(1);
  });
});

/**
 * **결정은 요청한 세션에게 돌아간다**(2026-09-07 · REQ-API-133·134 · FR-11).
 *
 * A3 승인을 기다리는 에이전트는 승인이 나도 그것을 들을 길이 없었다 — 서버→세션 방향의
 * 보장 채널은 하트비트 하나인데(§2.4) 결재 결정이 거기 실리지 않았고, 기다리는 세션은
 * S5 에 `active` 로 보였다. 실데이터 결재 11건 중 4건이 세션 기원이다.
 */
describe('승인은 요청한 세션에게 돌아간다 (REQ-API-133·134)', () => {
  async function sessionApproval(): Promise<string> {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
      requestedBySessionId: sessionId,
    });
    await pool.query(`UPDATE agent_session SET state = 'awaiting_input' WHERE id = $1`, [
      sessionId,
    ]);
    return approval_id;
  }

  async function stateOfSession(): Promise<string | null> {
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    return rows[0]?.state ?? null;
  }

  it('결정이 세션을 깨우고 그 사실이 역채널에 실린다', async () => {
    const approvalId = await sessionApproval();
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId,
      userId: reviewer,
      decision: 'approve',
    });

    expect(await stateOfSession()).toBe('active');
    const pending = await approvals.pendingDecisionsFor(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'approval_decided',
      approval_id: approvalId,
      subject_type: 'plan',
      decision: 'approve',
    });
  });

  it('역채널의 결정자는 누른 사람이다 — admin 이 남에게 지정된 카드를 결정해도', async () => {
    const admin = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'chief@example.com','대표2','active')`,
      [admin],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,(SELECT org_id FROM project WHERE id = $2),$2,$3,'admin')`,
      [newId(), projectId, admin],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
      requestedBySessionId: sessionId,
      assigneeUserId: reviewer,
    });
    await approvals.decide({
      actor: person(admin),
      projectId,
      approvalId: approval_id,
      userId: admin,
      decision: 'approve',
    });
    const pending = await approvals.pendingDecisionsFor(sessionId);
    expect(pending.find((p) => p['approval_id'] === approval_id)).toMatchObject({
      decided_by: '대표2',
    });
  });

  it('다른 대기 사유가 남아 있으면 깨우지 않는다 — 열린 blocking 질문', async () => {
    const approvalId = await sessionApproval();
    await questions.create({
      projectId,
      sessionId,
      title: '이것도 정해 주세요',
      urgency: 'blocking',
    });
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId,
      userId: reviewer,
      decision: 'approve',
    });

    expect(await stateOfSession()).toBe('awaiting_input');
  });

  it('결정되지 않은 다른 결재가 남아 있어도 깨우지 않는다', async () => {
    const first = await sessionApproval();
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
      requestedBySessionId: sessionId,
    });
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: first,
      userId: reviewer,
      decision: 'approve',
    });

    expect(await stateOfSession()).toBe('awaiting_input');
  });

  it('세션이 올린 것이 아니면 아무 세션도 건드리지 않는다', async () => {
    await pool.query(`UPDATE agent_session SET state = 'awaiting_input' WHERE id = $1`, [
      sessionId,
    ]);
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'approve',
    });

    expect(await stateOfSession()).toBe('awaiting_input');
    expect(await approvals.pendingDecisionsFor(sessionId)).toEqual([]);
  });
});

describe('E13-S02 질문 — 멱등 재호출이 곧 폴링이다', () => {
  it('blocking 질문은 세션을 awaiting_input 으로 세운다 (P7)', async () => {
    await questions.create({
      projectId,
      sessionId,
      title: '스토리지 선택',
      options: ['localStorage', '서버 세션'],
      urgency: 'blocking',
    });
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0]?.state).toBe('awaiting_input');
  });

  it('같은 질문 재호출은 새 카드를 만들지 않고 현재 상태를 준다', async () => {
    const first = await questions.create({ projectId, sessionId, title: '같은 질문' });
    const poll = await questions.create({ projectId, sessionId, title: '같은 질문' });

    expect(poll.question_id).toBe(first.question_id);
    expect(poll.created).toBe(false);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM question`);
    expect(rows[0]?.n).toBe(1);
  });

  it('답변이 들어오면 세션이 깨어나고 폴링이 답을 본다', async () => {
    const created = await questions.create({ projectId, sessionId, title: '답변 받을 질문' });
    await questions.answer({
      projectId,
      questionId: created.question_id,
      userId: planner,
      actor: person(planner),
      answerKey: 'localStorage',
      answerMd: 'localStorage 로 간다',
    });

    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0]?.state).toBe('active');

    const poll = await questions.create({ projectId, sessionId, title: '답변 받을 질문' });
    expect(poll).toMatchObject({ status: 'answered', answer_key: 'localStorage' });
  });

  /**
   * **답이 필요 없어졌으면 거둔다**(2026-09-05 · REQ-API-109).
   *
   * `cancelled` 는 열거에 있었는데 만드는 경로가 없어 아무도 쓸 수 없는 값이었다.
   */
  it('만든 세션이 자기 질문을 거둔다 — 기다리던 세션이 깨어난다', async () => {
    const created = await questions.create({
      projectId,
      sessionId,
      title: '스스로 푼 질문',
      urgency: 'blocking',
    });
    const result = await questions.cancel({
      projectId,
      questionId: created.question_id,
      userId: planner,
      sessionId,
      isAgent: true,
    });
    expect(result.status).toBe('cancelled');

    const { rows } = await pool.query<{ status: string; state: string }>(
      `SELECT q.status::text AS status, s.state::text AS state
         FROM question q JOIN agent_session s ON s.id = q.agent_session_id
        WHERE q.id = $1`,
      [created.question_id],
    );
    expect(rows[0]?.status).toBe('cancelled');
    // 답이 오지 않을 것이 확정됐으므로 멈춰 있을 이유가 없다
    expect(rows[0]?.state).toBe('active');
  });

  it('사람은 남의 질문도 내린다 — 세션 소유 판정은 에이전트에게만 걸린다', async () => {
    const created = await questions.create({ projectId, sessionId, title: '사람이 내릴 질문' });
    const result = await questions.cancel({
      projectId,
      questionId: created.question_id,
      userId: planner,
      isAgent: false,
    });
    expect(result.status).toBe('cancelled');
  });

  it('남의 질문은 못 거둔다 — 내리는 것은 사람의 몫이다', async () => {
    const created = await questions.create({ projectId, sessionId, title: '남의 질문' });
    await expect(
      questions.cancel({
        projectId,
        questionId: created.question_id,
        userId: planner,
        sessionId: newId(),
        isAgent: true,
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_owner' } });
  });

  it('답이 달린 질문은 취소되지 않는다 — 그 답이 사실이다', async () => {
    const created = await questions.create({ projectId, sessionId, title: '이미 답한 질문' });
    await questions.answer({
      projectId,
      questionId: created.question_id,
      userId: planner,
      actor: person(planner),
    });
    await expect(
      questions.cancel({
        projectId,
        questionId: created.question_id,
        userId: planner,
        isAgent: false,
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_open' } });
  });

  /**
   * 2026-09-07(REQ-API-123) — `spec:read` 는 모든 PAT 가 가진 값이라 권한 축이 에이전트를
   * 거르지 못했다. 질문에 답하는 것은 사람 개입 게이트 그 자체다(P7): 자기 질문에 자기가
   * 답하면 그 게이트가 없는 것과 같고, 감사에는 사람이 답한 것으로 남는다.
   */
  it('에이전트는 답할 수 없다 — 질문은 열린 채, 세션은 그대로', async () => {
    const created = await questions.create({ projectId, sessionId, title: '에이전트 답변 시도' });
    await pool.query(`UPDATE agent_session SET state = 'awaiting_input' WHERE id = $1`, [
      sessionId,
    ]);
    await expect(
      questions.answer({
        projectId,
        questionId: created.question_id,
        userId: planner,
        actor: agent(planner),
        answerKey: 'yes',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.HUMAN_ONLY, details: { action: 'inbox_decide' } });
    const { rows } = await pool.query<{ status: string; state: string }>(
      `SELECT q.status::text AS status, s.state::text AS state
         FROM question q JOIN agent_session s ON s.id = q.agent_session_id
        WHERE q.id = $1`,
      [created.question_id],
    );
    expect(rows[0]).toMatchObject({ status: 'open', state: 'awaiting_input' });
    expect(await questions.pendingFor(sessionId)).toHaveLength(0);
  });

  it('답변은 하트비트 역채널에 실린다 — 서버→세션의 유일한 보장 채널이다', async () => {
    const created = await questions.create({ projectId, sessionId, title: '역채널 질문' });
    expect(await questions.pendingFor(sessionId)).toHaveLength(0);

    await questions.answer({
      projectId,
      questionId: created.question_id,
      userId: planner,
      actor: person(planner),
      answerKey: 'yes',
    });
    const pending = await questions.pendingFor(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'question_answered', answer_key: 'yes' });
  });

  it('이미 답변된 질문은 다시 답변할 수 없다', async () => {
    const created = await questions.create({ projectId, sessionId, title: '중복 답변' });
    await questions.answer({
      projectId,
      questionId: created.question_id,
      userId: planner,
      actor: person(planner),
      answerKey: 'a',
    });
    await expect(
      questions.answer({
        projectId,
        questionId: created.question_id,
        userId: planner,
        actor: person(planner),
        answerKey: 'b',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('normal 질문은 세션을 세우지 않는다 — blocking 만 멈춘다', async () => {
    await questions.create({ projectId, sessionId, title: '급하지 않은 질문', urgency: 'normal' });
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0]?.state).toBe('active');
  });

  // ── 출처와 사유 (2026-08-30 — 스킬이 요구하던 인자를 도구가 받는다) ────────────
  //
  // 스킬(`/nerv:question`)은 `context{spec_id,task_id,finding_id}`·`escalate`·`blocking`·
  // `wait_seconds` 를 지시하는데 도구가 그것을 **조용히 버리고 있었다** — 에이전트는
  // 출처를 달았다고 믿지만 받은 요청 카드에는 아무것도 없었다.

  it('출처를 키로 준다 — 사람은 요약이 아니라 원문을 보고 판단한다', async () => {
    const specKey = `SPC-CTX-${newId().slice(0, 4)}`;
    const specRow = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
      [specRow, projectId, specKey],
    );
    const taskRow = newId();
    const taskKey = `TSK-CTX-${newId().slice(0, 4)}`;
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'출처 작업','ready','목표','PR','nerv_spec_get','경계')`,
      [taskRow, projectId, taskKey],
    );

    const made = await questions.create({
      projectId,
      sessionId,
      title: '출처가 있는 질문',
      specId: specKey,
      taskId: taskKey,
      escalate: 'spec',
    });

    const { rows } = await pool.query<{ spec_id: string; task_id: string; escalate: string }>(
      `SELECT spec_id, task_id, escalate::text AS escalate FROM question WHERE id = $1`,
      [made.question_id],
    );
    expect(rows[0]).toMatchObject({ spec_id: specRow, task_id: taskRow, escalate: 'spec' });
  });

  it('발견을 출처로 주면 그 발견이 붙는다 — 예전에는 없는 컬럼을 조인해 500 이었다', async () => {
    const findingId = newId();
    const reviewSessionId = newId();
    await pool.query(
      `INSERT INTO review_session (id, project_id, branch, base_sha, head_sha, changeset_hash,
                                   kind, trigger)
       VALUES ($1,$2,'feat/x','base','head',decode($3,'hex'),'code','manual')`,
      [reviewSessionId, projectId, findingId.replaceAll('-', '').slice(0, 32)],
    );
    await pool.query(
      `INSERT INTO finding (id, project_id, fingerprint, category, severity, status, title,
                            first_session_id, last_session_id)
       VALUES ($1,$2,decode($3,'hex'),'correctness','critical','open','같은 지적',$4,$4)`,
      [findingId, projectId, findingId.replaceAll('-', '').slice(0, 32), reviewSessionId],
    );

    const made = await questions.create({
      projectId,
      sessionId,
      title: '발견을 근거로 묻는다',
      findingId,
    });

    const { rows } = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM question WHERE id = $1`,
      [made.question_id],
    );
    expect(rows[0]?.finding_id).toBe(findingId);
  });

  it('없는 출처는 조용히 버리지 않는다 — 어느 항목이 틀렸는지 말한다', async () => {
    await expect(
      questions.create({
        projectId,
        sessionId,
        title: '없는 출처',
        specId: 'SPC-없는키',
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'not_found', field: 'context.spec_id' },
    });
  });

  it('기다린 만큼 기다렸다가 그 사이 들어온 답을 본다 (wait_seconds)', async () => {
    const created = await questions.create({ projectId, sessionId, title: '기다리는 질문' });

    // 1.5초 뒤에 사람이 답한다 — 그동안 에이전트는 이 호출 안에서 기다린다
    setTimeout(() => {
      void questions.answer({
        projectId,
        questionId: created.question_id,
        userId: planner,
        actor: person(planner),
        answerKey: 'late-yes',
      });
    }, 1500);

    const waited = await questions.create({
      projectId,
      sessionId,
      title: '기다리는 질문',
      waitSeconds: 10,
    });
    expect(waited).toMatchObject({ status: 'answered', answer_key: 'late-yes', created: false });
  });

  it('답이 안 오면 예산만큼 기다리고 open 으로 돌아온다 — 무한 대기는 없다', async () => {
    const started = Date.now();
    const result = await questions.create({
      projectId,
      sessionId,
      title: '답이 안 오는 질문',
      waitSeconds: 2,
    });
    // 답이 없으면 예산만큼 기다리고 open 그대로 돌아온다
    expect(result.status).toBe('open');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1800);
  });
});

/**
 * 승인 대상 버전을 만든다.
 *
 * 기본이 draft 인 이유가 있다 — in_review 이상은 **본문이 동결돼 있어서**(트리거가 막는다)
 * 애초에 stale 이 생길 수 없다. 그것 자체가 좋은 성질이고, stale 검증은 아직 가변인
 * 대상(draft·plan)에서만 의미가 있다.
 */
/**
 * **접는 것도 무시다**(2026-09-07 · REQ-API-126). 표면이 `status === 'answered' ? … : 'open'`
 * 으로 접던 동안 `?status=cancelled` 는 **열린 질문 목록**을 200 으로 돌려줬다 — REQ-API-109 가
 * 만든 상태를 조회할 길이 없으면서, 물어본 쪽은 걸러진 목록이라고 믿는다.
 */
describe('E13-S02 질문 목록의 어휘 (REQ-API-126)', () => {
  it('cancelled 를 물으면 취소된 것만 준다 — 열린 목록으로 접지 않는다', async () => {
    const open = await questions.create({ projectId, sessionId, title: '열린 질문' });
    const toCancel = await questions.create({ projectId, sessionId, title: '취소할 질문' });
    await questions.cancel({
      projectId,
      questionId: toCancel.question_id,
      userId: planner,
      isAgent: false,
    });

    const cancelled = await approvals.questions({ projectId, status: 'cancelled' });
    expect(cancelled.map((q) => q['id'])).toEqual([toCancel.question_id]);

    const opened = await approvals.questions({ projectId, status: 'open' });
    expect(opened.map((q) => q['id'])).toContain(open.question_id);
    expect(opened.map((q) => q['id'])).not.toContain(toCancel.question_id);
  });

  it('어휘 밖의 값은 400 이고 허용 목록을 준다', async () => {
    await expect(approvals.questions({ projectId, status: 'closed' })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'invalid_input', field: 'status' },
    });
  });
});

describe('E13-S03 인앱 알림 — 결정이 필요한 것만 (§6.2·§6.6)', () => {
  it('critical·high 는 알림을 만들고 low 는 만들지 않는다', async () => {
    const notifications = new NotificationService(drizzle(pool));

    // low — 배경 활동. 배지가 이것으로 덮이면 받은 요청이 두 번째 받은편지함이 된다
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'task.claimed',$3,true,'task',$4)`,
      [newId(), projectId, reviewer, newId()],
    );
    expect(await notifications.route()).toBe(0);

    // critical — 누군가의 세션이 내 결정을 기다린다
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'question.created',$3,true,'question',$4)`,
      [newId(), projectId, reviewer, newId()],
    );
    expect(await notifications.route()).toBeGreaterThan(0);
  });

  /**
   * 2026-09-07(REQ-API-125) — 조직 단위 멤버십(`project_id IS NULL`)을 조직 구분 없이 세면
   * **다른 조직의** admin·planner 에게 이 프로젝트의 알림이 간다. `assertMembership`(08-24)·
   * 자기 승인 admin 판정(09-02)이 같은 자리에서 같은 실수를 했다 — 셋째 자리다.
   */
  it('다른 조직의 planner 에게는 알림이 가지 않는다 — 조직 경계', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const otherOrg = newId();
    const outsider = newId();
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'other','다른조직')`, [
      otherOrg,
    ]);
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'outsider@example.com','바깥','active')`,
      [outsider],
    );
    // 조직 단위 planner — 자기 조직 전체를 보는 사람이지 이 프로젝트의 사람이 아니다
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,NULL,$3,'planner')`,
      [newId(), otherOrg, outsider],
    );
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'question.created',$3,true,'question',$4)`,
      [newId(), projectId, reviewer, newId()],
    );
    expect(await notifications.route()).toBeGreaterThan(0);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification WHERE user_id = $1`,
      [outsider],
    );
    expect(rows[0]?.n).toBe(0);
    // 같은 조직의 사람은 받는다 — 경계를 세우면서 신호까지 끄면 안 된다
    const { rows: inside } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification WHERE user_id = $1`,
      [planner],
    );
    expect(inside[0]?.n).toBeGreaterThan(0);
  });

  it('카탈로그에 없는 이벤트는 알림을 만들지 않는다 — 기본값이 "안 만든다"다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'import.applied',$3,false,'project',$2)`,
      [newId(), projectId, planner],
    );
    expect(await notifications.route()).toBe(0);
  });

  it('행위자 자신에게는 보내지 않는다 — 자기가 한 일의 알림은 소음이다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'spec.approved',$3,false,'spec_version',$4)`,
      [newId(), projectId, planner, newId()],
    );
    await notifications.route();

    const { rows } = await pool.query<{ user_id: string }>(`SELECT user_id FROM notification`);
    expect(rows.map((r) => r.user_id)).not.toContain(planner);
    expect(rows.map((r) => r.user_id)).toContain(reviewer);
  });

  it('같은 이벤트를 두 번 라우팅해도 알림이 늘지 않는다 — 워커 재실행 안전', async () => {
    const notifications = new NotificationService(drizzle(pool));
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'approval.requested',$3,false,'approval',$4)`,
      [newId(), projectId, planner, newId()],
    );
    const first = await notifications.route();
    const second = await notifications.route();
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });

  it('읽지 않은 수를 센다 — 헤더 배지가 쓰는 값', async () => {
    const notifications = new NotificationService(drizzle(pool));
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'question.created',$3,true,'question',$4)`,
      [newId(), projectId, reviewer, newId()],
    );
    await notifications.route();
    expect((await notifications.unreadCount(planner)).count).toBeGreaterThan(0);
  });
});

/**
 * 보관한 프로젝트는 **받은 요청과 알림에서도 빠진다**(사람 보고 2026-08-27).
 *
 * 목록에는 보이는데 누르면 "프로젝트가 없다"로 아무 일도 일어나지 않았다. 치운
 * 프로젝트를 사람이 계속 결재하도록 두는 것은 받은 요청을 못 믿게 만드는 가장 빠른 길이다.
 */
describe('보관한 프로젝트는 결정 목록에서도 빠진다 (2026-08-27)', () => {
  const archive = async (on: boolean): Promise<void> => {
    await pool.query(
      on
        ? `UPDATE project SET archived_at = now() WHERE id = $1`
        : `UPDATE project SET archived_at = NULL WHERE id = $1`,
      [projectId],
    );
  };

  afterAll(() => archive(false));

  it('승인 카드·질문 카드·알림·안읽음 수가 함께 사라졌다 돌아온다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const versionId = await makeSpecVersion('보관 시험', 'in_review');
    await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: planner,
    });
    await questions.create({ projectId, sessionId, title: '보관 시험 질문' });
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),'approval.requested',$3,false,'approval',$4)`,
      [newId(), projectId, planner, newId()],
    );
    await notifications.route();

    const before = {
      cards: (
        await approvals.inboxGlobal({
          actor: { userId: planner, isAgent: false },
          userId: reviewer,
          state: 'pending',
        })
      ).total,
      feed: (await notifications.list({ userId: reviewer })).items.length,
      unread: (await notifications.unreadCount(reviewer)).count,
    };
    expect(before.cards).toBeGreaterThan(0);
    expect(before.feed).toBeGreaterThan(0);

    await archive(true);
    expect(
      (
        await approvals.inboxGlobal({
          actor: { userId: planner, isAgent: false },
          userId: reviewer,
          state: 'pending',
        })
      ).items,
    ).toHaveLength(0);
    expect((await notifications.list({ userId: reviewer })).items).toHaveLength(0);
    // **배지와 목록이 같은 조건으로 센다**(REQ-WEB-035) — 어긋나면 지울 수 없는 숫자가 남는다
    expect((await notifications.unreadCount(reviewer)).count).toBe(0);

    await archive(false);
    expect(
      (
        await approvals.inboxGlobal({
          actor: { userId: planner, isAgent: false },
          userId: reviewer,
          state: 'pending',
        })
      ).total,
    ).toBe(before.cards);
    expect((await notifications.list({ userId: reviewer })).items.length).toBe(before.feed);
    expect((await notifications.unreadCount(reviewer)).count).toBe(before.unread);
  });
});

/**
 * **처리됨 탭은 "내가 결정한 것" 에 답한다**(2026-09-24 · 사람 결정 · REQ-API-165).
 *
 * 한 `WHERE` 절이 두 탭을 겸하는 동안 이 탭은 **결정이 문서를 움직인 순간 그 기록을
 * 잃었다**: 승인하면 `approved`, 거절하면 `draft` 라 대기 탭을 위해 쓴 `sv.status =
 * 'in_review'` 에서 함께 탈락했다. 실측 2026-09-24 — 시드에서 넷을 결정하니 처리됨에
 * 둘만 남았고, 그 둘은 **문서를 안 움직인 것과 남이 낸 면제**였다. 매뉴얼은 그동안
 * "지워지지 않으므로 나중에도 읽을 수 있습니다" 라고 적고 있었다.
 *
 * 그리고 자격 판정도 갈랐다. `eligibleSql` 은 "이 카드가 **내 큐인가**" 를 묻는 식이라
 * 결정된 카드에 물으면 엉뚱한 답이 나온다 — 남이 낸 면제가 내 처리됨에 뜨고 내가 끝낸
 * 것은 빠졌다. 결정자는 이제 `decided_by_user_id` 한 열에 남는다(마이그레이션 0029).
 */
describe('처리됨 탭 — 내가 결정한 것 (REQ-API-165)', () => {
  /**
   * 남이 올린 스펙 결재 하나 — **세 축이 전부 planner 가 아니어야** 결정이 된다
   * (요청자 reviewer · 작성자 designer · 작성 세션 없음 · `approval-policy` 의 notSelfSql).
   */
  async function pendingSpec(): Promise<{ versionId: string; approvalId: string }> {
    const versionId = await makeSpecVersion('# 처리됨\n\n본문', 'in_review');
    await pool.query(
      `UPDATE spec_version SET author_user_id = $2, submitted_at = now() WHERE id = $1`,
      [versionId, designer],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: reviewer,
    });
    return { versionId, approvalId: approval_id };
  }

  const decidedOf = async (userId: string): Promise<Record<string, unknown>[]> =>
    (await approvals.inboxGlobal({ actor: person(userId), userId, state: 'decided' })).items;

  it('승인해서 문서가 approved 로 가도 기록은 남는다 — 이 자리가 비어 있었다', async () => {
    const { versionId, approvalId } = await pendingSpec();
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId,
      userId: planner,
      decision: 'approve',
    });
    // 문서는 옮겨 갔다 — 그래도 결재 기록은 처리됨에 있어야 한다
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]?.status).toBe('approved');

    const decided = await decidedOf(planner);
    expect(decided.map((c) => c['id'])).toContain(approvalId);
    expect(decided.find((c) => c['id'] === approvalId)?.['decision']).toBe('approve');
  });

  it('거절해서 문서가 draft 로 돌아가도 남는다 — 거절이야말로 나중에 읽는 기록이다', async () => {
    const { versionId, approvalId } = await pendingSpec();
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId,
      userId: planner,
      decision: 'reject',
      comment: '재시도 횟수를 적어 주세요',
    });
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]?.status).toBe('draft');
    expect((await decidedOf(planner)).map((c) => c['id'])).toContain(approvalId);
  });

  it('남이 결정한 것은 내 처리됨에 없다 — 빈 상태 문구가 "내가" 라고 적는다', async () => {
    const { approvalId } = await pendingSpec();
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId,
      userId: planner,
      decision: 'approve',
    });
    // reviewer 도 planner 역할이라 **대기 큐는 같았다** — 그래서 예전에는 남의 결정이
    // 자기 처리됨에 떴다. 기준이 큐가 아니라 결정자로 바뀐 자리다.
    expect((await decidedOf(reviewer)).map((c) => c['id'])).not.toContain(approvalId);
  });

  it('면제도 낸 사람의 처리됨에 있다 — 낸 사람이 곧 결정한 사람이다', async () => {
    const { approval_id } = await approvals.bypass({
      actor: person(planner),
      projectId,
      userId: planner,
      subjectType: 'spec_version',
      subjectId: await makeSpecVersion('# 면제\n\n본문'),
      reason: '핫픽스 배포, 사후 리뷰 예약',
    });
    expect((await decidedOf(planner)).map((c) => c['id'])).toContain(approval_id);
    expect((await decidedOf(reviewer)).map((c) => c['id'])).not.toContain(approval_id);
  });

  it('지정 카드를 admin 이 대신 결정하면 admin 의 처리됨에 뜬다 — 지정된 사람이 아니라', async () => {
    // `assignee_user_id` 는 COALESCE 라 **지정된 사람을 지킨다**. 그 열을 결정자로 읽으면
    // admin 은 자기가 내린 결정을 못 보고 지정된 사람은 내리지 않은 결정을 본다.
    const adminId = newId();
    await pool.query(
      // 주소는 유일해야 한다 — 이 파일의 다른 검사도 admin 을 하나씩 만든다
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,'대표','active')`,
      [adminId, `admin-${adminId}@example.com`],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, $2, $3, 'admin' FROM project WHERE id = $2`,
      [newId(), projectId, adminId],
    );
    const versionId = await makeSpecVersion('# 지정\n\n본문', 'in_review');
    await pool.query(
      `UPDATE spec_version SET author_user_id = $2, submitted_at = now() WHERE id = $1`,
      [versionId, designer],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: reviewer,
      assigneeUserId: designer,
    });
    await approvals.decide({
      actor: person(adminId),
      projectId,
      approvalId: approval_id,
      userId: adminId,
      decision: 'approve',
    });

    expect((await decidedOf(adminId)).map((c) => c['id'])).toContain(approval_id);
    expect((await decidedOf(designer)).map((c) => c['id'])).not.toContain(approval_id);
  });

  it('처리됨은 **결정한 순서**로 선다 — 요청 시각으로 세우면 오래된 요청이 묻힌다', async () => {
    const older = await pendingSpec();
    const newer = await pendingSpec();
    // 오래 묵은 요청을 방금 결정한다 — 요청 시각 정렬이면 이것이 아래로 간다
    await pool.query(`UPDATE approval SET requested_at = now() - interval '9 days' WHERE id = $1`, [
      older.approvalId,
    ]);
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId: newer.approvalId,
      userId: planner,
      decision: 'approve',
    });
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId: older.approvalId,
      userId: planner,
      decision: 'approve',
    });

    const ids = (await decidedOf(planner)).map((c) => c['id']);
    expect(ids.indexOf(older.approvalId)).toBeLessThan(ids.indexOf(newer.approvalId));
  });

  it('결정에 남긴 말을 함께 싣는다 — 거절 사유를 읽을 곳이 없었다 (REQ-WEB-133)', async () => {
    const { approvalId } = await pendingSpec();
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId,
      userId: planner,
      decision: 'reject',
      comment: '복원 실패 시 재시도 횟수를 적어 주세요',
    });
    const card = (await decidedOf(planner)).find((c) => c['id'] === approvalId);
    expect(card?.['comment_md']).toBe('복원 실패 시 재시도 횟수를 적어 주세요');
  });

  it('결정된 카드에 판정을 싣지 않는다 — 누를 것이 없는 카드의 계산이다', async () => {
    // `can_approve` 계열 넷은 "내가 이것을 누를 수 있는가" 에 답하고, 처리됨 카드에는
    // 누를 것이 없다. **빼는 것이지 false 로 채우는 것이 아니다** — 거짓 값은 판정으로
    // 읽히고 화면의 폴백(`typeof card.can_approve === 'boolean'`)이 그것을 그대로 믿는다.
    const { approvalId } = await pendingSpec();
    const pendingCard = (
      await approvals.inboxGlobal({ actor: person(planner), userId: planner })
    ).items.find((c) => c['id'] === approvalId);
    for (const key of ['can_approve', 'can_bulk_approve', 'bulk_block_reason', 'content_hash']) {
      expect(pendingCard).toHaveProperty(key);
    }

    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId,
      userId: planner,
      decision: 'approve',
    });
    const card = (await decidedOf(planner)).find((c) => c['id'] === approvalId)!;
    for (const key of [
      'can_approve',
      'can_approve_reason',
      'can_bulk_approve',
      'bulk_block_reason',
      'content_hash',
    ]) {
      expect(card).not.toHaveProperty(key);
    }
    // **정족수는 남긴다** — T3 를 하나 승인하고 둘째를 기다리는 중이라면 그 값은 사실이다
    expect(card['approvals_required']).toBe(1);
    expect(card['approvals_given']).toBe(1);
  });

  it('대기 탭은 그대로다 — 갈라 놓은 것이 대기 쪽을 건드리지 않았다', async () => {
    const { approvalId } = await pendingSpec();
    const { items: pending } = await approvals.inboxGlobal({
      actor: person(planner),
      userId: planner,
    });
    expect(pending.map((c) => c['id'])).toContain(approvalId);
    // 결정하면 대기에서 빠지고 처리됨으로 옮겨 간다
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId,
      userId: planner,
      decision: 'approve',
    });
    const { items: after } = await approvals.inboxGlobal({
      actor: person(planner),
      userId: planner,
    });
    expect(after.map((c) => c['id'])).not.toContain(approvalId);
    expect((await decidedOf(planner)).map((c) => c['id'])).toContain(approvalId);
  });
});

/**
 * **받은 요청은 쪽으로 나뉜다**(2026-09-24 · 사람 결정 · REQ-API-166).
 *
 * 전표는 처음부터 `Page<ApprovalCard>` 라 적었는데 서비스는 **맨 배열**을 주고
 * `LIMIT 100` 에서 말없이 잘렸다 — §1.6 선언이 이 자리에서도 거짓이었고, REQ-API-120 이
 * 이벤트 피드에서 잡은 것과 같은 형태다.
 *
 * 그리고 그 상한은 **오래 기다린 쪽**을 잘랐다: 질의가 `requested_at DESC LIMIT 100` 으로
 * 가장 최근 100건을 집고 화면이 다시 오래된 순으로 세웠다. 실측 2026-09-24(120건 ·
 * 0~119시간 전): 가장 오래 기다린 20건이 통째로 빠졌다 — 화면이 존재하는 이유를
 * (REQ-WEB-024: 오래 기다린 것이 위로) 상한이 정확히 뒤집고 있었다.
 */
describe('받은 요청의 쪽 넘김 (REQ-API-166)', () => {
  /** n 건을 서로 다른 시각으로 심는다 — i 가 클수록 오래 기다린 것이다 */
  async function seedPending(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      await pool.query(
        `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                               requested_at)
         VALUES ($1,$2,'plan',$3,$4, now() - ($5 || ' hours')::interval)`,
        [newId(), projectId, newId(), reviewer, String(i + 1)],
      );
    }
  }

  const pageOf = (
    cursor: string | null,
    limit = 5,
  ): Promise<Awaited<ReturnType<typeof approvals.inboxGlobal>>> =>
    approvals.inboxGlobal({ actor: person(planner), userId: planner, cursor, limit });

  it('상한이 **오래 기다린 쪽**을 자르지 않는다 — 맨 위가 가장 오래된 것이다', async () => {
    await seedPending(12);
    const first = await pageOf(null);
    expect(first.items).toHaveLength(5);
    // 12시간 전이 가장 오래 기다린 것이다 — 예전에는 이것이 목록에서 빠졌다
    const waits = first.items.map((c) => Number(c['waiting_seconds']));
    expect(waits[0]).toBeGreaterThan(waits[4]!);
    expect(Math.round(waits[0]! / 3600)).toBe(12);
  });

  it('총계는 쪽이 아니라 전체다 — 배지가 그 수를 쓴다', async () => {
    await seedPending(12);
    const first = await pageOf(null);
    expect(first.items).toHaveLength(5);
    expect(first.total).toBe(12);
  });

  it('커서로 전량을 정확히 한 번씩 훑는다', async () => {
    await seedPending(12);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof approvals.inboxGlobal>> = await pageOf(cursor);
      seen.push(...page.items.map((c) => String(c['id'])));
      cursor = page.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('같은 시각의 행이 쪽 경계에서 사라지지 않는다 (REQ-API-124)', async () => {
    // T3 제출은 한 트랜잭션에서 슬롯을 여럿 세운다 — **같은 `requested_at`** 이다.
    // 시각 하나로만 seek 하면 그 무리가 경계에 걸릴 때 남은 것이 어느 쪽에도 안 나온다.
    for (let i = 0; i < 12; i += 1) {
      await pool.query(
        `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                               requested_at)
         VALUES ($1,$2,'plan',$3,$4, now() - interval '1 hour')`,
        [newId(), projectId, newId(), reviewer],
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof approvals.inboxGlobal>> = await pageOf(cursor);
      seen.push(...page.items.map((c) => String(c['id'])));
      cursor = page.next_cursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(12);
  });

  it('질문도 같은 줄에서 쪽을 탄다 — 두 소스가 한 목록이다', async () => {
    await seedPending(4);
    for (let i = 0; i < 4; i += 1) {
      await questions.create({ projectId, sessionId, title: `질문 ${i}` });
    }
    const seen: string[] = [];
    const kinds = new Set<string>();
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof approvals.inboxGlobal>> = await pageOf(cursor, 3);
      for (const c of page.items) {
        seen.push(String(c['id']));
        kinds.add(String(c['subject_type']));
      }
      cursor = page.next_cursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(8);
    expect(kinds.has('question')).toBe(true);
    expect(kinds.has('plan')).toBe(true);
  });

  it('처리됨은 **최근 결정부터** 넘어간다 — 기록은 최근 것부터 읽는다', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { approval_id } = await approvals.request({
        projectId,
        subjectType: 'plan',
        subjectId: newId(),
        requestedByUserId: reviewer,
      });
      await approvals.decide({
        actor: person(planner),
        projectId,
        approvalId: approval_id,
        userId: planner,
        decision: 'approve',
      });
      ids.push(approval_id);
    }
    const page = await approvals.inboxGlobal({
      actor: person(planner),
      userId: planner,
      state: 'decided',
      limit: 4,
    });
    expect(page.items).toHaveLength(4);
    expect(page.total).toBe(6);
    // 마지막에 결정한 것이 맨 위다
    expect(page.items[0]?.['id']).toBe(ids.at(-1));

    const second = await approvals.inboxGlobal({
      actor: person(planner),
      userId: planner,
      state: 'decided',
      cursor: page.next_cursor,
      limit: 4,
    });
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
  });

  it('해독되지 않는 커서는 처음부터다 — 낡은 커서가 화면을 깨뜨리지 않는다 (§1.6)', async () => {
    await seedPending(3);
    const page = await pageOf('그럴듯하지-않은-커서');
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(3);
  });

  it('커서는 불투명하다 — 조각을 응답에 내보이지 않는다', async () => {
    await seedPending(3);
    const page = await pageOf(null, 2);
    expect(page.next_cursor).not.toBeNull();
    for (const card of page.items) expect(card).not.toHaveProperty('cursor_at');
  });
});

/**
 * **배지는 내가 누를 수 있는 것만 센다**(2026-09-25 — UI/UX 검토 HUB-04 · 사람 결정 D2 · REQ-API-184).
 *
 * `total` 은 대기 탭의 전체라 **내가 승인할 수 없는 카드**가 섞였다 — 내가 요청한 것 · 내가 쓴
 * 초안 · 내 세션이 쓴 초안 · T3 에서 이미 승인하고 남은 칸. 배지와 홈 인사가 그 수를 쓰는 동안
 * 할 수 있는 것을 다 처리해도 숫자가 0 이 되지 않았고, 잠긴 카드는 요청 시각 순으로 목록
 * 한가운데 끼어 누를 수 있는 카드를 뒤 쪽으로 밀어냈다.
 */
describe('누를 수 있는 것이 먼저 · 누를 수 있는 수 (REQ-API-184)', () => {
  /** planner 가 볼 대기 — 잠긴 것(자기 요청)은 **더 오래** 기다린 것으로 심는다 */
  async function seedMixed(): Promise<{ open: string[]; locked: string[] }> {
    const open: string[] = [];
    const locked: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = newId();
      locked.push(id);
      await pool.query(
        `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                               requested_at)
         VALUES ($1,$2,'plan',$3,$4, now() - ($5 || ' hours')::interval)`,
        [id, projectId, newId(), planner, String(20 - i)],
      );
    }
    for (let i = 0; i < 3; i += 1) {
      const id = newId();
      open.push(id);
      await pool.query(
        `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                               requested_at)
         VALUES ($1,$2,'plan',$3,$4, now() - ($5 || ' hours')::interval)`,
        [id, projectId, newId(), reviewer, String(5 - i)],
      );
    }
    return { open, locked };
  }

  it('누를 수 있는 수를 따로 준다 — 잠긴 카드는 전체에만 든다', async () => {
    await seedMixed();
    await questions.create({ projectId, sessionId, title: '어느 쪽으로 갈까' });
    const page = await approvals.inboxGlobal({ actor: person(planner), userId: planner });
    // 결재 여섯(잠김 셋) + 질문 하나
    expect(page.total).toBe(7);
    expect(page.actionable_total).toBe(4);
    // 판정은 카드의 `can_approve` 와 같은 식이다 — 두 수가 어긋나지 않는다
    const unlocked = page.items.filter(
      (c) => c['subject_type'] === 'question' || c['can_approve'] === true,
    );
    expect(unlocked).toHaveLength(page.actionable_total!);
  });

  it('잠긴 카드는 뒤로 간다 — 더 오래 기다렸어도 누를 수 있는 것이 먼저다', async () => {
    const { open, locked } = await seedMixed();
    const page = await approvals.inboxGlobal({ actor: person(planner), userId: planner });
    const ids = page.items.map((c) => String(c['id']));
    // 앞 구역 안에서는 여전히 오래 기다린 것이 위다(REQ-WEB-024)
    expect(ids).toEqual([...open, ...locked]);
    expect(page.items.at(-1)).toMatchObject({
      can_approve: false,
      can_approve_reason: 'self_requested',
    });
  });

  it('쪽 경계가 두 구역 사이에 걸려도 한 번씩만 훑는다 — 질문은 앞 구역이다', async () => {
    const { open, locked } = await seedMixed();
    const asked = await questions.create({ projectId, sessionId, title: '질문' });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof approvals.inboxGlobal>> = await approvals.inboxGlobal({
        actor: person(planner),
        userId: planner,
        cursor,
        limit: 2,
      });
      seen.push(...page.items.map((c) => String(c['id'])));
      cursor = page.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    // 질문은 방금 물었으니 앞 구역의 끝이다 — 잠긴 셋보다 먼저 온다
    expect(seen.slice(-3)).toEqual(locked);
    expect(seen.indexOf(asked.question_id)).toBe(open.length);
  });

  it('처리됨에는 누를 수 있는 수가 없다 — 누를 것이 없는 목록이다', async () => {
    await seedMixed();
    const page = await approvals.inboxGlobal({
      actor: person(planner),
      userId: planner,
      state: 'decided',
    });
    expect(page).not.toHaveProperty('actionable_total');
  });
});

/**
 * **요청의 그림자 알림은 요청과 함께 닫힌다**(2026-09-24 — UI/UX 검토 · REQ-API-176).
 *
 * 받은 요청에서 카드를 처리하면 받은 요청 배지는 줄었지만 알림 배지는 그대로였다 — 결정 경로
 * 어디에서도 그 알림을 읽음으로 바꾸지 않았고, 역할 큐의 다른 승인자가 먼저 처리해도 내 알림은
 * 여전히 "승인 요청" 이었다.
 */
describe('요청이 닫히면 그 알림도 닫힌다 (REQ-API-176)', () => {
  const unreadOf = async (type: string, subjectId: string): Promise<number> =>
    count(
      `SELECT count(*)::int AS n FROM notification n JOIN event e ON e.id = n.event_id
        WHERE e.type = '${type}' AND e.subject_id = '${subjectId}' AND n.state = 'unread'`,
    );
  const allOf = async (type: string, subjectId: string): Promise<number> =>
    count(
      `SELECT count(*)::int AS n FROM notification n JOIN event e ON e.id = n.event_id
        WHERE e.type = '${type}' AND e.subject_id = '${subjectId}'`,
    );

  async function specRequest(): Promise<string> {
    const versionId = await makeSpecVersion('# 알림\n\n본문', 'in_review');
    await pool.query(
      `UPDATE spec_version SET author_user_id = $2, submitted_at = now() WHERE id = $1`,
      [versionId, designer],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: designer,
    });
    return approval_id;
  }

  it('결정하면 그 요청의 알림이 **모든 수신자**에게서 읽음이 된다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const approvalId = await specRequest();
    await notifications.route();
    // 결재 큐(planner·reviewer 등)가 함께 받는다 — 한 사람이 처리하면 모두의 그림자가 닫혀야 한다
    expect(await unreadOf(NERV_EVENT.APPROVAL_REQUESTED, approvalId)).toBeGreaterThan(1);
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId,
      userId: reviewer,
      decision: 'approve',
    });
    expect(await unreadOf(NERV_EVENT.APPROVAL_REQUESTED, approvalId)).toBe(0);
  });

  it('파생보다 결정이 먼저면 알림은 **읽은 채로** 생긴다 — 뒤늦게 배지를 올리지 않는다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const approvalId = await specRequest();
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId,
      userId: reviewer,
      decision: 'reject',
      comment: '다시',
    });
    await notifications.route();
    expect(await allOf(NERV_EVENT.APPROVAL_REQUESTED, approvalId)).toBeGreaterThan(0);
    expect(await unreadOf(NERV_EVENT.APPROVAL_REQUESTED, approvalId)).toBe(0);
  });

  it('질문에 답하면 그 질문의 알림이 닫힌다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const made = await questions.create({ projectId, sessionId, title: '어느 쪽으로?' });
    const questionId = String(
      (made as Record<string, unknown>)['question_id'] ?? (made as Record<string, unknown>)['id'],
    );
    await notifications.route();
    expect(await unreadOf(NERV_EVENT.QUESTION_CREATED, questionId)).toBeGreaterThan(0);
    await questions.answer({
      projectId,
      questionId,
      userId: reviewer,
      actor: person(reviewer),
      answerMd: '왼쪽',
    });
    expect(await unreadOf(NERV_EVENT.QUESTION_CREATED, questionId)).toBe(0);
  });

  it('알림 목록은 그 요청이 닫혔는지와 누가 닫았는지를 싣는다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const approvalId = await specRequest();
    await notifications.route();
    await approvals.decide({
      actor: person(reviewer),
      projectId,
      approvalId,
      userId: reviewer,
      decision: 'approve',
    });
    const { items } = await notifications.list({ userId: planner });
    const row = items.find(
      (i) => i['event_type'] === NERV_EVENT.APPROVAL_REQUESTED && i['subject_id'] === approvalId,
    );
    expect(row).toMatchObject({ resolution: 'approve', resolved_by: '서연' });
  });
});

/**
 * **카드가 무엇을 · 누가 · 왜 를 싣는다**(2026-09-24 — UI/UX 검토 · REQ-API-177). 플랜·발견 카드는
 * 대상조차 가리키지 않았고, 스펙 카드는 변경 요약·요청 세션·게이트 티어를 싣지 않았다.
 */
describe('받은 요청 카드의 대상과 요청 줄 (REQ-API-177)', () => {
  const inboxOf = async (userId: string): Promise<Record<string, unknown>[]> =>
    (await approvals.inboxGlobal({ actor: person(userId), userId })).items;

  it('플랜 카드는 그 작업을, 세션이 올렸으면 그 세션과 기다림을 싣는다', async () => {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status) VALUES ($1,$2,'CLV-T-PLAN01','큰 작업','backlog')`,
      [taskId, projectId],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: taskId,
      requestedByUserId: planner,
      requestedBySessionId: sessionId,
    });
    await pool.query(`UPDATE agent_session SET state = 'awaiting_input' WHERE id = $1`, [
      sessionId,
    ]);
    const card = (await inboxOf(reviewer)).find((c) => c['id'] === approval_id);
    expect(card).toMatchObject({
      task_key: 'CLV-T-PLAN01',
      task_title: '큰 작업',
      requested_hostname: 'mac-07',
      requested_agent_type: 'claude-code',
      session_waiting: true,
    });
  });

  it('발견 카드는 그 발견의 제목·심각도와 갈 곳을 싣는다', async () => {
    const findingId = newId();
    const reviewSessionId = newId();
    await pool.query(
      `INSERT INTO review_session (id, project_id, branch, base_sha, head_sha, changeset_hash,
                                   kind, trigger)
       VALUES ($1,$2,'feat/y','base','head',decode($3,'hex'),'code','manual')`,
      [reviewSessionId, projectId, findingId.replaceAll('-', '').slice(0, 32)],
    );
    await pool.query(
      `INSERT INTO finding (id, project_id, fingerprint, category, severity, status, title,
                            first_session_id, last_session_id)
       VALUES ($1,$2,decode($3,'hex'),'correctness','critical','open','경계 밖 수정',$4,$4)`,
      [findingId, projectId, findingId.replaceAll('-', '').slice(0, 32), reviewSessionId],
    );
    // 발견 결재는 리뷰 서비스가 직접 세운다(critical 하향 · `review.service.ts`) — 같은 모양으로 넣는다
    const approval_id = newId();
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id)
       VALUES ($1, $2, 'finding', $3, $4)`,
      [approval_id, projectId, findingId, planner],
    );
    const card = (await inboxOf(reviewer)).find((c) => c['id'] === approval_id);
    expect(card).toMatchObject({
      finding_id: findingId,
      finding_title: '경계 밖 수정',
      finding_severity: 'critical',
    });
  });

  it('스펙 카드는 변경 요약과 게이트 티어를 싣는다', async () => {
    const versionId = await makeSpecVersion('# 요약\n\n본문', 'in_review');
    await pool.query(
      `UPDATE spec_version SET author_user_id = $2, submitted_at = now(),
              change_summary_md = '경계 절을 좁혔다' WHERE id = $1`,
      [versionId, designer],
    );
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: designer,
    });
    // 티어는 스펙 제출이 판정해 요청 이벤트에 싣는다 — event 는 append-only 라 그 이벤트를 흉내 낸다
    await pool.query(
      `INSERT INTO event (id, project_id, type, subject_type, subject_id, payload)
       VALUES ($1, $2, 'approval.requested', 'approval', $3, jsonb_build_object('gate_tier', 'T2'))`,
      [newId(), projectId, approval_id],
    );
    const card = (await inboxOf(reviewer)).find((c) => c['id'] === approval_id);
    expect(card).toMatchObject({ change_summary_md: '경계 절을 좁혔다', gate_tier: 'T2' });
  });
});

/**
 * **무엇에 일어났나**(2026-09-24 — UI/UX 검토 · REQ-API-181). 이벤트 피드는 대상을 싣지 않아
 * "초안 수정 · 관리자 · 16일 전" 만 늘어놓았고, 알림 목록은 스펙·작업 주체만 조인해서 결재 요청과
 * 질문 — 가장 무거운 두 알림 — 이 키도 제목도 없이 "승인 요청" 만 반복했다. 한 단계 건너(결재 →
 * 스펙 버전 · 플랜 → 작업 · 질문 → 작업)의 대상까지 따라가 두 목록이 같은 칸으로 싣는다.
 */
describe('알림과 피드가 무엇에 일어났는지 싣는다 (REQ-API-181)', () => {
  const feedOf = async (): Promise<Record<string, unknown>[]> => {
    const silent = {
      publish: async () => false,
      subscribe: async () => undefined,
    } as unknown as ValkeyService;
    return (await new EventService(drizzle(pool), silent).feed({ projectId })).items;
  };

  it('결재 요청은 그 스펙 버전의 키·제목·버전을 — 알림과 피드가 같게 — 싣는다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const versionId = await makeSpecVersion('# 결재\n\n본문', 'in_review');
    await pool.query(
      `UPDATE spec_version SET author_user_id = $2, submitted_at = now() WHERE id = $1`,
      [versionId, designer],
    );
    const { rows } = await pool.query<{ key: string }>(
      `SELECT s.key FROM spec s JOIN spec_version sv ON sv.spec_id = s.id WHERE sv.id = $1`,
      [versionId],
    );
    const specKey = rows[0]!.key;
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'spec_version',
      subjectId: versionId,
      requestedByUserId: designer,
    });
    await notifications.route();

    const row = (await notifications.list({ userId: planner })).items.find(
      (i) => i['event_type'] === NERV_EVENT.APPROVAL_REQUESTED && i['subject_id'] === approval_id,
    );
    expect(row).toMatchObject({ spec_key: specKey, spec_title: specKey, version_no: 1 });

    const fed = (await feedOf()).find(
      (e) => e['type'] === NERV_EVENT.APPROVAL_REQUESTED && e['subject_id'] === approval_id,
    );
    expect(fed).toMatchObject({ spec_key: specKey, version_no: 1, actor_user_id: designer });
  });

  it('질문은 제목과 그 질문이 붙은 작업을 싣는다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status) VALUES ($1,$2,'CLV-T-ASK001','물어볼 작업','backlog')`,
      [taskId, projectId],
    );
    const made = await questions.create({ projectId, sessionId, taskId, title: '어느 쪽으로?' });
    const questionId = String(
      (made as Record<string, unknown>)['question_id'] ?? (made as Record<string, unknown>)['id'],
    );
    await notifications.route();

    const row = (await notifications.list({ userId: planner })).items.find(
      (i) => i['event_type'] === NERV_EVENT.QUESTION_CREATED && i['subject_id'] === questionId,
    );
    expect(row).toMatchObject({
      question_title: '어느 쪽으로?',
      task_key: 'CLV-T-ASK001',
      task_title: '물어볼 작업',
    });
    const fed = (await feedOf()).find(
      (e) => e['type'] === NERV_EVENT.QUESTION_CREATED && e['subject_id'] === questionId,
    );
    expect(fed).toMatchObject({ question_title: '어느 쪽으로?', task_key: 'CLV-T-ASK001' });
  });

  it('플랜 결재는 그 작업을, 발견 결재는 그 발견을 가리킨다', async () => {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status) VALUES ($1,$2,'CLV-T-PLAN02','플랜 작업','backlog')`,
      [taskId, projectId],
    );
    const plan = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: taskId,
      requestedByUserId: designer,
    });
    const reviewSessionId = newId();
    const findingId = newId();
    await pool.query(
      `INSERT INTO review_session (id, project_id, branch, base_sha, head_sha, changeset_hash,
                                   kind, trigger)
       VALUES ($1,$2,'feat/z','base','head',decode($3,'hex'),'code','manual')`,
      [reviewSessionId, projectId, findingId.replaceAll('-', '').slice(0, 32)],
    );
    await pool.query(
      `INSERT INTO finding (id, project_id, fingerprint, category, severity, status, title,
                            first_session_id, last_session_id)
       VALUES ($1,$2,decode($3,'hex'),'correctness','critical','open','내릴 지적',$4,$4)`,
      [findingId, projectId, findingId.replaceAll('-', '').slice(0, 32), reviewSessionId],
    );
    // critical 하향 결재는 리뷰 처분이 만든다 — 여기서는 그 결과(결재 행과 요청 이벤트)만 둔다
    const lowerId = newId();
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id)
       VALUES ($1,$2,'finding',$3,$4)`,
      [lowerId, projectId, findingId, designer],
    );
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
       VALUES ($1,$2,now(),$3,$4,true,'approval',$5)`,
      [newId(), projectId, NERV_EVENT.APPROVAL_REQUESTED, designer, lowerId],
    );

    const feed = await feedOf();
    const byApproval = (id: string) =>
      feed.find((e) => e['type'] === NERV_EVENT.APPROVAL_REQUESTED && e['subject_id'] === id);
    expect(byApproval(plan.approval_id)).toMatchObject({
      task_key: 'CLV-T-PLAN02',
      task_title: '플랜 작업',
    });
    expect(byApproval(lowerId)).toMatchObject({
      finding_id: findingId,
      finding_title: '내릴 지적',
    });
  });
});

async function makeSpecVersion(body: string, status = 'draft'): Promise<string> {
  const specId = newId();
  const versionId = newId();
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
    // **앞자리를 잘라 쓰지 않는다** — UUIDv7 는 앞이 시각이라 같은 순간에 만든 둘이 겹친다
    [specId, projectId, `SPC-${specId}`],
  );
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,1,$5::spec_version_status,$3, digest($3,'sha256'), $4)`,
    [versionId, specId, body, planner, status],
  );
  return versionId;
}

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  designer = newId();
  developer = newId();
  qa = newId();
  viewer = newId();
  sessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [planner, 'jimin@example.com', '지민'],
    [reviewer, 'seoyeon@example.com', '서연'],
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
  // 직군 넷 — 매트릭스의 ○(지정 시)와 역할 큐를 보려면 그 역할의 사람이 있어야 한다
  for (const [id, email, name, role] of [
    [designer, 'dana@example.com', '다나', 'designer'],
    [developer, 'minu@example.com', '민우', 'developer'],
    [qa, 'sora@example.com', '소라', 'qa'],
    [viewer, 'hyun@example.com', '현', 'viewer'],
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

/**
 * **결정이 필요한 것과 배경 활동을 나눈다**(2026-09-07 · REQ-API-149·150 · FR-12).
 * 서버는 티어로 갈라 저장하는데 표면이 그 축을 주지 않았고, 재확인 요청은 문서의 주인이
 * 아니라 역할 큐로 흩뿌려졌다 — 실측 recheck 1,336건이 결정 19건을 덮었다.
 */
describe('알림의 등급과 수신자 (REQ-API-149·150)', () => {
  it('안 읽은 수를 등급으로 나눠 준다 — 배지는 앞엣것을 쓴다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent,
                          subject_type, subject_id)
       VALUES ($1,$2,now(),'question.created',$3,true,'question',$4)`,
      [newId(), projectId, planner, newId()],
    );
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent,
                          subject_type, subject_id)
       VALUES ($1,$2,now(),'task.ready',$3,false,'task',$4)`,
      [newId(), projectId, planner, newId()],
    );
    expect(await notifications.route()).toBeGreaterThan(0);

    const counted = await notifications.unreadCount(reviewer);
    expect(counted.count).toBeGreaterThan(counted.immediate);
    expect(counted.immediate).toBeGreaterThan(0);

    // 목록도 그 축으로 좁힌다
    const onlyImmediate = await notifications.list({ userId: reviewer, importance: 'immediate' });
    expect(onlyImmediate.items.length).toBe(counted.immediate);
    // 알림은 조직을 가로지른다 — 어느 조직의 것인지 싣는다(REQ-API-170)
    expect(onlyImmediate.items[0]).toMatchObject({ org_slug: 'nerv', org_name: 'NERV' });
    // 어휘 밖의 값은 접지 않고 거절한다(REQ-API-126)
    await expect(
      notifications.list({ userId: reviewer, importance: 'urgent' }),
    ).rejects.toMatchObject({ details: { kind: 'invalid_input', field: 'importance' } });
  });

  it('재확인 요청은 그 문서의 주인 역할에게 간다 — 없으면 기본 큐다', async () => {
    const notifications = new NotificationService(drizzle(pool));
    const specId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title, owner_role)
       VALUES ($1,$2,'feature','SPC-OWNED','주인 있는 문서','qa')`,
      [specId, projectId],
    );
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent,
                          subject_type, subject_id)
       VALUES ($1,$2,now(),'spec.recheck_requested',$3,false,'spec',$4)`,
      [newId(), projectId, planner, specId],
    );
    expect(await notifications.route()).toBeGreaterThan(0);

    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT n.user_id FROM notification n
         JOIN event e ON e.id = n.event_id
        WHERE e.type = 'spec.recheck_requested'`,
    );
    expect(rows.map((r) => r.user_id)).toEqual([qa]);
  });
});

/**
 * EP-APR-06 일괄 결정 — 저위험 경계 · 부분 실패 · 감사 (REQ-API-162~164 · 2026-09-22 사람 결정)
 *
 * **일괄 승인은 본문을 열지 않고 누르는 조작이다.** 그래서 이 블록이 지키는 것은 "되는가"
 * 가 아니라 그 조작에 달아 둔 브레이크다 — 무엇이 빠지는가(T3·면제) · 누구는 예외인가
 * (admin) · 한 건의 실패가 나머지를 되돌리지 않는가 · 감사가 일괄을 셀 수 있는가.
 */
describe('일괄 결정 (EP-APR-06 · REQ-API-162~164)', () => {
  /** 승인 대기 상태의 스펙 버전 하나 — 제출이 놓는 것과 같은 순서로 흉내 낸다 */
  async function pending(key: string, slots = 1): Promise<{ versionId: string; ids: string[] }> {
    const created = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key,
      title: key,
      type: 'feature',
      bodyMd: `# ${key}\n\n본문`,
      userId: planner,
    });
    const versionId = created['spec_version_id'] as string;
    await pool.query(
      `UPDATE spec_version SET status = 'in_review', submitted_at = now(),
              edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
        WHERE id = $1`,
      [versionId],
    );
    // 슬롯이 곧 정족수다(`ensurePendingApproval` 과 같은 모양) — T3 는 둘이다
    const ids: string[] = [];
    for (let i = 0; i < slots; i += 1) {
      const id = newId();
      await pool.query(
        `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id)
         VALUES ($1,$2,'spec_version',$3,$4)`,
        [id, projectId, versionId, planner],
      );
      ids.push(id);
    }
    return { versionId, ids };
  }

  /** 대기 중인 게이트 면제 요청 — 실데이터에 있는 모양 그대로(제목 재료가 없는 카드다) */
  async function pendingBypassRequest(): Promise<string> {
    const id = newId();
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id)
       VALUES ($1,$2,'gate_bypass',$3,$4)`,
      [id, projectId, newId(), planner],
    );
    return id;
  }

  async function statusOf(versionId: string): Promise<string> {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    return rows[0]!.status;
  }

  /** admin 한 명을 잠깐 들인다 — 시드에 없고, 남기면 다른 검사의 승인자 수가 바뀐다 */
  async function withAdmin(fn: (adminId: string) => Promise<void>): Promise<void> {
    const adminId = newId();
    const { rows } = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM project WHERE id = $1`,
      [projectId],
    );
    const orgId = rows[0]!.org_id;
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,'관리자','active')`,
      [adminId, `admin-${adminId}@example.com`],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
      [newId(), orgId, projectId, adminId],
    );
    try {
      await fn(adminId);
    } finally {
      // **소속만 거둔다.** 승인자 수를 세는 것은 `membership` 이라 이걸로 원상태가 된다.
      // 사용자 행은 남긴다 — 방금 내린 결재가 `assignee_user_id` 로 그를 가리키고 있어
      // (그게 결재가 남긴 기록이다) 지우면 FK 가 막는다.
      await pool.query(`DELETE FROM membership WHERE user_id = $1`, [adminId]);
    }
  }

  it('저위험만 지나간다 — T3(정족수 2)는 일괄에서 빠지고 나머지는 승인된다', async () => {
    const low = await pending('SPC-BULK-LOW');
    const high = await pending('SPC-BULK-T3', 2);

    const out = await approvals.decideBulk({
      actor: person(reviewer),
      userId: reviewer,
      decision: 'approve',
      items: [{ id: low.ids[0]! }, { id: high.ids[0]! }],
    });

    expect(out.decided).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results.find((r) => r.id === high.ids[0])?.kind).toBe('bulk_quorum');
    expect(await statusOf(low.versionId)).toBe('approved');
    // **막힌 카드는 그대로 대기다** — 일괄이 건드리지 못했다고 사라지면 안 된다
    expect(await statusOf(high.versionId)).toBe('in_review');
  });

  it('게이트 면제 요청은 일괄 승인에서 빠진다 — 면제가 조용히 일어나지 않는 것이 기능이다', async () => {
    const bypassId = await pendingBypassRequest();

    const out = await approvals.decideBulk({
      actor: person(reviewer),
      userId: reviewer,
      decision: 'approve',
      items: [{ id: bypassId }],
    });

    expect(out.decided).toBe(0);
    expect(out.results[0]?.kind).toBe('bulk_gate_bypass');
    const { rows } = await pool.query<{ decision: string | null }>(
      `SELECT decision::text AS decision FROM approval WHERE id = $1`,
      [bypassId],
    );
    expect(rows[0]!.decision).toBeNull();
  });

  it('admin 은 둘 다 면제다 — 2026-09-22 사람 결정', async () => {
    const high = await pending('SPC-BULK-ADMIN-T3', 2);
    const bypassId = await pendingBypassRequest();

    await withAdmin(async (adminId) => {
      const out = await approvals.decideBulk({
        actor: person(adminId),
        userId: adminId,
        decision: 'approve',
        items: [{ id: high.ids[0]! }, { id: bypassId }],
      });
      expect(out.failed).toBe(0);
      expect(out.decided).toBe(2);
    });
  });

  it('한 건의 stale 이 나머지를 되돌리지 않는다 — 건마다 제 트랜잭션이다', async () => {
    const a = await pending('SPC-BULK-FRESH');
    const b = await pending('SPC-BULK-STALE');

    const out = await approvals.decideBulk({
      actor: person(reviewer),
      userId: reviewer,
      decision: 'approve',
      items: [
        { id: a.ids[0]!, seenContentHash: await hashOfVersion(a.versionId) },
        // 카드를 연 뒤 본문이 바뀐 것과 같다 — 이 검사가 일괄의 **구멍을 막는 자리**다
        { id: b.ids[0]!, seenContentHash: 'deadbeef' },
      ],
    });

    expect(out.decided).toBe(1);
    expect(out.results.find((r) => r.id === b.ids[0])?.kind).toBe('stale_approval');
    expect(await statusOf(a.versionId)).toBe('approved');
    expect(await statusOf(b.versionId)).toBe('in_review');
  });

  it('거절은 고른 것 전부다 — 서버가 막는 것은 승인뿐이다(EP-APR-03)', async () => {
    const high = await pending('SPC-BULK-REJ-T3', 2);

    const out = await approvals.decideBulk({
      actor: person(reviewer),
      userId: reviewer,
      decision: 'reject',
      comment: '범위가 넓습니다',
      items: [{ id: high.ids[0]! }],
    });

    expect(out.decided).toBe(1);
    // 거절은 문서를 되돌린다 — 갇히지 않는다(REQ-API-063)
    expect(await statusOf(high.versionId)).toBe('draft');
  });

  it('감사가 일괄을 셀 수 있다 — 건별 이벤트에 `bulk`·`batch_id` 가 남는다', async () => {
    const a = await pending('SPC-BULK-AUDIT-1');
    const b = await pending('SPC-BULK-AUDIT-2');

    const out = await approvals.decideBulk({
      actor: person(reviewer),
      userId: reviewer,
      decision: 'approve',
      items: [{ id: a.ids[0]! }, { id: b.ids[0]! }],
    });

    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE type = $1 ORDER BY occurred_at`,
      [NERV_EVENT.APPROVAL_DECIDED],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.payload['bulk']).toBe(true);
      expect(row.payload['batch_id']).toBe(out.batch_id);
    }
  });

  it('없는 id 하나가 배치를 죽이지 않는다 — uuid 가 아니어도 그 한 건만 실패다', async () => {
    const a = await pending('SPC-BULK-BADID');

    const out = await approvals.decideBulk({
      actor: person(reviewer),
      userId: reviewer,
      decision: 'approve',
      items: [{ id: 'not-a-uuid' }, { id: a.ids[0]! }],
    });

    expect(out.results[0]?.kind).toBe('not_found');
    expect(out.decided).toBe(1);
  });

  it('에이전트는 일괄도 부를 수 없다 — 결정은 사람 전용이다(REQ-API-123)', async () => {
    const a = await pending('SPC-BULK-AGENT');
    await expect(
      approvals.decideBulk({
        actor: agent(reviewer),
        userId: reviewer,
        decision: 'approve',
        items: [{ id: a.ids[0]! }],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
  });

  it('일괄이 받는 결정은 승인·거절 둘뿐이다 — `comment` 는 어휘 밖이다', async () => {
    const a = await pending('SPC-BULK-CMT');
    await expect(
      approvals.decideBulk({
        actor: person(reviewer),
        userId: reviewer,
        decision: 'comment',
        items: [{ id: a.ids[0]! }],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });
});
