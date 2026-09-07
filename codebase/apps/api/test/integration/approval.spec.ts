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

/** 사람 주체 — 받은 요청·면제·답변은 사람 전용이다(REQ-API-123) */
const person = (userId: string) => ({ userId, isAgent: false });
/** 에이전트 주체 — 같은 자리에서 막히는지 보는 쪽 */
const agent = (userId: string) => ({ userId, isAgent: true });

let db: ScratchDb;
let pool: pg.Pool;
let approvals: ApprovalService;
let specs: SpecService;
let questions: QuestionService;
let projectId: string;
let planner: string;
let reviewer: string;
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
      details: { kind: 'self_approval', allowed_roles: ['admin'] },
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
    const mine = (
      await approvals.inbox({ projectId, userId: planner, actor: person(planner) })
    ).find((c) => c.id === approval_id);
    expect(mine).toMatchObject({ self_requested: true, can_approve: false });

    const others = (
      await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) })
    ).find((c) => c.id === approval_id);
    expect(others).toMatchObject({ self_requested: false, can_approve: true });
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
    const card = (await approvals.inbox({ projectId, userId: admin, actor: person(admin) })).find(
      (c) => c.id === approval_id,
    );
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

describe('E13-S01 받은 요청 — 내 결정을 기다리는 것만 (§6.6 원칙 3)', () => {
  it('결정되지 않은 카드만 온다 — 처리한 것은 사라진다', async () => {
    const { approval_id } = await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    expect(
      await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) }),
    ).toHaveLength(1);

    await approvals.decide({
      actor: { userId: planner, isAgent: false },
      projectId,
      approvalId: approval_id,
      userId: reviewer,
      decision: 'approve',
    });
    expect(
      await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) }),
    ).toHaveLength(0);
  });

  it('지정 승인자가 있으면 그 사람에게만 보인다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
      assigneeUserId: reviewer,
    });
    expect(
      await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) }),
    ).toHaveLength(1);
    expect(
      await approvals.inbox({ projectId, userId: planner, actor: person(planner) }),
    ).toHaveLength(0);
  });

  it('카드가 self_requested 를 표시한다 — 내가 올린 것을 내가 승인할 수 없음을 UI 가 안다', async () => {
    await approvals.request({
      projectId,
      subjectType: 'plan',
      subjectId: newId(),
      requestedByUserId: planner,
    });
    const [card] = await approvals.inbox({ projectId, userId: planner, actor: person(planner) });
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
    expect(
      await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) }),
    ).toHaveLength(1);
  });
});

describe('E13-S01 프로젝트 받은 요청도 사람 전용이다 (REQ-API-123)', () => {
  it('에이전트 주체는 프로젝트 받은 요청을 읽지 못한다 — 전역 경로와 같은 규칙', async () => {
    await expect(
      approvals.inbox({ projectId, userId: reviewer, actor: agent(reviewer) }),
    ).rejects.toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
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

    const [card] = await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) });
    const seen = card?.content_hash as string;

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
    const [card] = await approvals.inbox({ projectId, userId: reviewer, actor: person(reviewer) });

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
    expect(await notifications.unreadCount(planner)).toBeGreaterThan(0);
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
      ).length,
      feed: (await notifications.list({ userId: reviewer })).items.length,
      unread: await notifications.unreadCount(reviewer),
    };
    expect(before.cards).toBeGreaterThan(0);
    expect(before.feed).toBeGreaterThan(0);

    await archive(true);
    expect(
      await approvals.inboxGlobal({
        actor: { userId: planner, isAgent: false },
        userId: reviewer,
        state: 'pending',
      }),
    ).toHaveLength(0);
    expect((await notifications.list({ userId: reviewer })).items).toHaveLength(0);
    // **배지와 목록이 같은 조건으로 센다**(REQ-WEB-035) — 어긋나면 지울 수 없는 숫자가 남는다
    expect(await notifications.unreadCount(reviewer)).toBe(0);

    await archive(false);
    expect(
      (
        await approvals.inboxGlobal({
          actor: { userId: planner, isAgent: false },
          userId: reviewer,
          state: 'pending',
        })
      ).length,
    ).toBe(before.cards);
    expect((await notifications.list({ userId: reviewer })).items.length).toBe(before.feed);
    expect(await notifications.unreadCount(reviewer)).toBe(before.unread);
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
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-07','active')`,
    [sessionId, projectId, planner],
  );
}
