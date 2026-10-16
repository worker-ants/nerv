// 결재 SLA — 지연(T+2d) · 만료(T+7d) · 역할 큐 재검토 지표 (2026-10-15 · 사람 결정 둘)
//   정본: docs/03-proposal/spec-workflow.md §2.2 · §2.6 · docs/04-mvp/api.md REQ-API-304 ~ 307
//
// 리마인더(T+4h · T+1d)만 집행하던 동안 결재는 끝없이 기다렸다 — 검토 중인 버전이 남으면 새 초안 저장이 409 로
// 막히고(REQ-API-200), 직군 자리(qa · designer · developer) 결재는 그 역할 멤버만 알림을 받아 admin 은 묵은 결재를
// 몰랐다. 이 스위트가 보는 것:
//   ① 만료 — 7일이 지난 스펙 결재는 거절과 같은 전이로 초안이 되고, 결재 행에는 결정을 쓰지 않으며, 요청자에게
//      알린다. 다시 제출하면 앞선 라운드의 승인은 세지 않는다. 기다리던 세션은 깨어나 하트비트로 듣는다.
//   ② 만료와 사람의 결정이 겹쳐도 한쪽만 이긴다(실제 Postgres — mock 으로 보지 않는다).
//   ③ 지연 — 2일이 지난 결재마다 한 번. 알림은 결정할 수 있는데 요청 알림을 못 받은 사람(직군 자리의 admin)에게만.
//   ④ 돌아갈 초안이 없는 결재(계획)는 만료하지 않고 지연만 한다.
//   ⑤ 결재 흐름(EP-APR-08) — 지연 수와 30일 창의 "하루를 넘긴 비율" · 30% 기준.

import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NervDb } from '../../src/common/database.module.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import type { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let orm: NervDb;
let specs: SpecService;
let approvals: ApprovalService;
let notifications: NotificationService;
let orgId: string;
let projectId: string;
/** 초안을 쓰고 검토를 요청한 사람 — 만료 알림을 받는다 */
let author: string;
/** 기본 큐의 다른 사람 */
let planner: string;
/** qa 를 겸하지 않는 admin — 직군 자리 결재의 지연 알림을 받는다 */
let admin: string;
/** qa 를 겸한 admin(조직 단위 qa) — 요청 알림을 이미 받았으니 지연 알림은 받지 않는다 */
let adminQa: string;
/** 직군 자리(qa)의 사람 */
let qa: string;

const person = (userId: string) => ({ userId, isAgent: false });

/** 모든 문서를 T3 로 — 슬롯이 기본 큐 하나 + 직군(qa) 하나다 */
const T3_POLICY = { spec_gate: { tier_boundaries: [0, 0, 0], dynamic_escalation: false } };

beforeAll(async () => {
  db = await createScratchDb('nerv_approval_sla');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  orm = drizzle(pool) as unknown as NervDb;
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const events = new EventService(orm, silent);
  specs = new SpecService(
    events,
    new SpecCheckService(orm),
    new SpecRelationService(orm),
    new SpecCommentService(events, orm),
    new AttachmentService(null as never, orm),
    orm,
  );
  approvals = new ApprovalService(events, specs, new AuthService(orm), orm);
  notifications = new NotificationService(orm);

  orgId = newId();
  projectId = newId();
  author = newId();
  planner = newId();
  admin = newId();
  adminQa = newId();
  qa = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'sla','SLA')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name, gate_policy)
     VALUES ($1,$2,'sla','SLA','결재 SLA',$3::jsonb)`,
    [projectId, orgId, JSON.stringify(T3_POLICY)],
  );
  for (const [id, name] of [
    [author, '지민'],
    [planner, '서연'],
    [admin, '민서'],
    [adminQa, '하준'],
    [qa, '도윤'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${id.slice(-8)}@mail.test`, name],
    );
  }
  for (const [user, role, scoped] of [
    [author, 'planner', true],
    [planner, 'planner', true],
    [admin, 'admin', true],
    [adminQa, 'admin', true],
    // 조직 단위 qa — 요청 알림 · 지연 대상 판정이 조직 경계를 함께 본다(REQ-API-125)
    [adminQa, 'qa', false],
    [qa, 'qa', true],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5::member_role)`,
      [newId(), orgId, scoped ? projectId : null, user, role],
    );
  }
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM approval');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM task');
  // 변경 요청이 초안을 감싼다(2026-10-16) — 버전과 서로를 가리키므로 먼저 푼다
  await pool.query('UPDATE spec_version SET change_request_id = NULL');
  await pool.query('DELETE FROM change_request');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('TRUNCATE event');
  await pool.query('DELETE FROM agent_session');
});

/** 초안 하나를 써서 검토를 요청한다(T3 — 기본 큐 + qa 자리) */
async function submitted(
  key: string,
  sessionId: string | null = null,
): Promise<{ versionId: string; specId: string }> {
  const draft = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: `# ${key}\n\n본문`,
    userId: author,
  });
  const versionId = draft['spec_version_id'] as string;
  const result = await specs.submitReview({
    projectId,
    specVersionId: versionId,
    userId: author,
    sessionId,
  });
  expect(result.status).toBe('in_review');
  return { versionId, specId: draft['spec_id'] as string };
}

async function slots(
  versionId: string,
): Promise<{ id: string; role: string | null; decision: string | null }[]> {
  const { rows } = await pool.query(
    `SELECT id, assignee_role::text AS role, decision::text AS decision FROM approval
      WHERE subject_id = $1 ORDER BY assignee_role NULLS FIRST, id`,
    [versionId],
  );
  return rows;
}

/** 이번 라운드를 `days` 일 전으로 돌린다 — 요청 시각과 제출 시각(라운드 경계)을 함께 */
async function ageRound(versionId: string, days: number): Promise<void> {
  await pool.query(
    `UPDATE approval SET requested_at = requested_at - make_interval(days => $2)
      WHERE subject_id = $1 AND decision IS NULL`,
    [versionId, days],
  );
  await pool.query(
    `UPDATE spec_version SET submitted_at = submitted_at - make_interval(days => $2) WHERE id = $1`,
    [versionId, days],
  );
}

async function statusOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status::text AS status FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]?.status ?? '';
}

async function eventsOf(type: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT subject_type, subject_id, actor_user_id, from_state, to_state, payload FROM event
      WHERE type = $1 ORDER BY occurred_at`,
    [type],
  );
  return rows;
}

/** 그 이벤트가 만든 알림 — 누구에게 어떤 등급 · 상태로 */
async function notificationsOf(
  type: string,
): Promise<{ user_id: string; importance: string; state: string }[]> {
  const { rows } = await pool.query(
    `SELECT n.user_id, n.importance::text AS importance, n.state::text AS state
       FROM notification n JOIN event e ON e.id = n.event_id
      WHERE e.type = $1 ORDER BY n.user_id`,
    [type],
  );
  return rows;
}

/** 계획 승인 결재 하나 — `hoursAgo` 시간 전에 요청됐다(기본 큐) */
async function planApproval(hoursAgo: number): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id, requested_at)
     VALUES ($1,$2,'plan',$3,$4, now() - make_interval(hours => $5))`,
    [id, projectId, newId(), author, hoursAgo],
  );
  return id;
}

describe('결재 만료 — 7일 (REQ-API-304)', () => {
  it('7일이 지난 스펙 결재는 초안으로 돌아가고 결재 행에는 결정을 쓰지 않는다 — 다시 돌려도 한 번이다', async () => {
    const fresh = await submitted('SLA-FRESH');
    const { versionId } = await submitted('SLA-OLD');
    await ageRound(fresh.versionId, 6);
    await ageRound(versionId, 8);

    expect(await approvals.expireDue()).toEqual({ expired: 1 });
    expect(await approvals.expireDue()).toEqual({ expired: 0 });

    expect(await statusOf(versionId)).toBe('draft');
    expect(await statusOf(fresh.versionId)).toBe('in_review');
    // 결정은 사람이 한다 — 만료는 결재 행을 건드리지 않는다
    for (const slot of await slots(versionId)) expect(slot.decision).toBeNull();
    const expired = await eventsOf(NERV_EVENT.APPROVAL_EXPIRED);
    expect(expired).toHaveLength(1);
    const ids = (await slots(versionId)).map((slot) => slot.id);
    expect(expired[0]).toMatchObject({
      subject_type: 'spec_version',
      subject_id: versionId,
      actor_user_id: null,
      from_state: 'in_review',
      to_state: 'draft',
      payload: expect.objectContaining({
        approval_id: ids[0],
        approval_ids: ids,
        requested_by_user_id: author,
        approvals_given: 0,
        approvals_required: 2,
      }),
    });
    // 낡은 카드에서 누른 결정은 만료를 보고 거절된다 — 초안이 된 문서의 자리에 결정만 남기지 않는다
    await expect(
      approvals.decide({
        actor: person(planner),
        projectId,
        approvalId: ids[0]!,
        userId: planner,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ details: { kind: 'approval_expired' } });
    // 만료한 문서는 지연 · 리마인더로 다시 알리지 않는다 — 초안이 된 문서의 자리는 대기가 아니다. 6일 된 문서의 두
    // 자리만 지연과 2회째 리마인더를 받는다
    expect(await approvals.slaDue()).toEqual({ expired: 0, escalated: 2, reminded: 2 });
    const freshIds = (await slots(fresh.versionId)).map((slot) => slot.id).sort();
    expect(
      (await eventsOf(NERV_EVENT.APPROVAL_OVERDUE)).map((e) => e['subject_id']).sort(),
    ).toEqual(freshIds);
  });

  it('요청자에게 보통 알림이 가고, 그 요청의 알림(요청 · 리마인더 · 지연)은 읽음이 된다', async () => {
    const { versionId } = await submitted('SLA-NOTIFY');
    await ageRound(versionId, 3);
    await approvals.escalateDue();
    await approvals.remindDue();
    await notifications.route();
    expect(
      (await notificationsOf(NERV_EVENT.APPROVAL_REQUESTED)).some((n) => n.state === 'unread'),
    ).toBe(true);

    await ageRound(versionId, 5);
    await approvals.expireDue();
    await notifications.route();

    expect(await notificationsOf(NERV_EVENT.APPROVAL_EXPIRED)).toEqual([
      { user_id: author, importance: 'digest', state: 'unread' },
    ]);
    for (const type of [
      NERV_EVENT.APPROVAL_REQUESTED,
      NERV_EVENT.APPROVAL_REMINDED,
      NERV_EVENT.APPROVAL_OVERDUE,
    ]) {
      for (const row of await notificationsOf(type)) expect(row.state, type).toBe('read');
    }
  });

  it('T3 에서 채워진 승인은 다시 낸 라운드에서 세지 않는다 — 같은 사람이 다시 승인해야 하고, 리마인더도 다시 센다', async () => {
    const { versionId } = await submitted('SLA-ROUND');
    const [first] = await slots(versionId);
    const approved = await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId: first!.id,
      userId: planner,
      decision: 'approve',
    });
    expect(approved.quorum).toEqual({ given: 1, required: 2, satisfied: false });
    await ageRound(versionId, 8);
    // 지난 라운드의 리마인더(qa 자리의 2회째 · 사흘 전) — 다시 낸 라운드에서 세지 않아야 한다
    const qaSlot = (await slots(versionId)).find((slot) => slot.role === 'qa')!;
    await pool.query(
      `INSERT INTO event (id, project_id, type, subject_type, subject_id, payload, occurred_at)
       VALUES ($1,$2,$3,'approval',$4,'{"level":2}'::jsonb, now() - interval '3 days')`,
      [newId(), projectId, NERV_EVENT.APPROVAL_REMINDED, qaSlot.id],
    );

    await approvals.expireDue();
    const [expired] = await eventsOf(NERV_EVENT.APPROVAL_EXPIRED);
    expect(expired?.['payload']).toMatchObject({ approvals_given: 1, approvals_required: 2 });

    await specs.submitReview({ projectId, specVersionId: versionId, userId: author });
    const { items } = await approvals.inbox({
      projectId,
      userId: admin,
      actor: person(admin),
    });
    const cards = items.filter((card) => card['spec_key'] === 'SLA-ROUND');
    expect(cards.map((card) => [card['approvals_given'], card['approvals_required']])).toEqual([
      [0, 2],
      [0, 2],
    ]);
    // 남은 자리(qa)를 다시 쓰고, 빠진 기본 큐 자리를 새로 만든다 — 두 자리가 같은 역할이 되지 않는다
    expect(cards.map((card) => card['assignee_role']).sort()).toEqual([null, 'qa'].sort());
    // 앞 라운드에 승인한 사람도 이번 라운드에서는 다시 승인할 수 있다 — 그리고 그것만으로는 확정되지 않는다
    const pending = (await slots(versionId)).filter((slot) => slot.decision === null);
    const again = await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId: pending.find((slot) => slot.role === null)!.id,
      userId: planner,
      decision: 'approve',
    });
    expect(again.quorum).toEqual({ given: 1, required: 2, satisfied: false });
    expect(await statusOf(versionId)).toBe('in_review');

    // 재사용한 자리(qa)의 요청 시각이 이번 제출이라 리마인더를 다시 센다
    await pool.query(
      `UPDATE approval SET requested_at = now() - interval '5 hours'
        WHERE subject_id = $1 AND decision IS NULL`,
      [versionId],
    );
    expect(await approvals.remindDue()).toEqual({ reminded: 1 });
  });

  it('기다리던 세션은 깨어나고 하트비트 역채널로 만료를 듣는다', async () => {
    const sessionId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','mac-07','active')`,
      [sessionId, projectId, author],
    );
    const { versionId } = await submitted('SLA-SESSION', sessionId);
    const { rows: before } = await pool.query(`SELECT state FROM agent_session WHERE id = $1`, [
      sessionId,
    ]);
    expect(before[0]?.state).toBe('awaiting_input');

    await ageRound(versionId, 8);
    await approvals.expireDue();

    const { rows: after } = await pool.query(`SELECT state FROM agent_session WHERE id = $1`, [
      sessionId,
    ]);
    expect(after[0]?.state).toBe('active');
    const pending = await approvals.pendingDecisionsFor(sessionId);
    expect(pending).toEqual([
      expect.objectContaining({
        kind: 'approval_expired',
        approval_id: (await slots(versionId))[0]!.id,
        subject_type: 'spec_version',
        subject_id: versionId,
        subject_key: 'SLA-SESSION',
        version_no: 1,
      }),
    ]);
    // 전달로 사라지지 않는다 — 다음 하트비트에도 온다
    expect(await approvals.pendingDecisionsFor(sessionId)).toHaveLength(1);
    // 다른 세션에는 오지 않는다
    expect(await approvals.pendingDecisionsFor(newId())).toEqual([]);
  });

  it('만료 탭에는 내 큐였던 만료 카드가 만료 시각과 함께 보이고 다시 제출하면 대기로 돌아간다', async () => {
    const { versionId } = await submitted('SLA-TAB');
    await ageRound(versionId, 8);
    await approvals.expireDue();

    const pending = await approvals.inbox({ projectId, userId: qa, actor: person(qa) });
    expect(pending.items.filter((card) => card['spec_key'] === 'SLA-TAB')).toEqual([]);
    const expired = await approvals.inbox({
      projectId,
      userId: qa,
      actor: person(qa),
      state: 'expired',
    });
    // qa 는 qa 자리만 자기 큐다
    expect(expired.total).toBe(1);
    expect(expired.items[0]).toMatchObject({
      spec_key: 'SLA-TAB',
      assignee_role: 'qa',
      decision: null,
      expired_at: expect.any(String),
    });
    expect(expired.items[0]).not.toHaveProperty('can_approve');
    // admin 은 두 자리 모두
    expect(
      (await approvals.inbox({ projectId, userId: admin, actor: person(admin), state: 'expired' }))
        .total,
    ).toBe(2);

    await specs.submitReview({ projectId, specVersionId: versionId, userId: author });
    expect(
      (await approvals.inbox({ projectId, userId: qa, actor: person(qa), state: 'expired' })).total,
    ).toBe(0);
    expect(
      (await approvals.inbox({ projectId, userId: qa, actor: person(qa) })).items.some(
        (card) => card['spec_key'] === 'SLA-TAB',
      ),
    ).toBe(true);
  });

  it('만료와 사람의 승인이 겹쳐도 한쪽만 이긴다 — 확정과 만료가 함께 남지 않는다', async () => {
    // T2 — 자리 하나라 승인 한 번이면 확정된다
    await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({ spec_gate: { tier_boundaries: [0, 0, 99], dynamic_escalation: false } }),
      projectId,
    ]);
    try {
      for (let round = 0; round < 5; round += 1) {
        const { versionId } = await submitted(`SLA-RACE-${round}`);
        const [slot] = await slots(versionId);
        await ageRound(versionId, 8);
        const [expired, decided] = await Promise.allSettled([
          approvals.expireDue(),
          approvals.decide({
            actor: person(planner),
            projectId,
            approvalId: slot!.id,
            userId: planner,
            decision: 'approve',
          }),
        ]);
        // 교착 없이 둘 다 끝난다 — 만료가 먼저면 늦은 승인은 만료를 보고 거절된다(결정을 남기지 않는다)
        expect(expired.status).toBe('fulfilled');
        const status = await statusOf(versionId);
        const { rows } = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM event WHERE type = $1 AND subject_id = $2`,
          [NERV_EVENT.APPROVAL_EXPIRED, versionId],
        );
        const [after] = await slots(versionId);
        if (status === 'approved') {
          expect(decided.status).toBe('fulfilled');
          expect(rows[0]?.n).toBe(0);
          expect(after?.decision).toBe('approve');
        } else {
          expect(status).toBe('draft');
          expect(rows[0]?.n).toBe(1);
          expect(decided.status).toBe('rejected');
          expect((decided as PromiseRejectedResult).reason).toMatchObject({
            details: { kind: 'approval_expired' },
          });
          expect(after?.decision).toBeNull();
        }
      }
    } finally {
      await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
        JSON.stringify(T3_POLICY),
        projectId,
      ]);
    }
  });

  it('돌아갈 초안이 없는 결재(계획)는 7일이 지나도 만료하지 않고 지연만 한 번 한다', async () => {
    const plan = await planApproval(8 * 24);
    expect(await approvals.slaDue()).toEqual({ expired: 0, escalated: 1, reminded: 0 });
    expect(await approvals.slaDue()).toEqual({ expired: 0, escalated: 0, reminded: 0 });
    const { rows } = await pool.query(`SELECT decision FROM approval WHERE id = $1`, [plan]);
    expect(rows[0]?.decision).toBeNull();
    expect(await eventsOf(NERV_EVENT.APPROVAL_EXPIRED)).toEqual([]);
  });
});

describe('지연 결재 — 2일 (REQ-API-305)', () => {
  it('2일이 지난 결재마다 한 번 낸다 — 2일 전이면 내지 않는다', async () => {
    const due = await planApproval(49);
    await planApproval(47);
    expect(await approvals.escalateDue()).toEqual({ escalated: 1 });
    expect(await approvals.escalateDue()).toEqual({ escalated: 0 });
    expect((await eventsOf(NERV_EVENT.APPROVAL_OVERDUE)).map((e) => e['subject_id'])).toEqual([
      due,
    ]);
  });

  it('직군 자리 결재는 그 역할을 겸하지 않은 admin 에게만 중요 알림이 간다 — 기본 큐 결재는 아무에게도', async () => {
    const { versionId } = await submitted('SLA-ESC');
    await ageRound(versionId, 3);
    await approvals.escalateDue();
    await notifications.route();

    const escalated = await eventsOf(NERV_EVENT.APPROVAL_OVERDUE);
    expect(escalated.map((e) => (e['payload'] as Record<string, unknown>)['queue']).sort()).toEqual(
      ['default', 'role_slot'],
    );
    // 기본 큐(admin · planner 가 요청 알림을 받았다)는 없음, qa 자리는 qa 를 겸하지 않은 admin 하나
    expect(await notificationsOf(NERV_EVENT.APPROVAL_OVERDUE)).toEqual([
      { user_id: admin, importance: 'immediate', state: 'unread' },
    ]);
    // 요청 알림은 그 자리의 역할 — 그 admin 은 받지 못했었다
    const requested = await notificationsOf(NERV_EVENT.APPROVAL_REQUESTED);
    expect(requested.filter((n) => n.user_id === admin)).toHaveLength(1);
    expect(requested.filter((n) => n.user_id === adminQa)).toHaveLength(2);
  });

  it('지정 결재는 지정된 사람이 아닌 admin 에게 간다', async () => {
    const id = newId();
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                             assignee_user_id, requested_at)
       VALUES ($1,$2,'plan',$3,$4,$5, now() - interval '3 days')`,
      [id, projectId, newId(), author, admin],
    );
    await approvals.escalateDue();
    await notifications.route();
    expect((await notificationsOf(NERV_EVENT.APPROVAL_OVERDUE)).map((n) => n.user_id)).toEqual([
      adminQa,
    ]);
  });

  it('결정하면 지연 알림도 읽음이 된다', async () => {
    const { versionId } = await submitted('SLA-ESC-DONE');
    await ageRound(versionId, 3);
    await approvals.escalateDue();
    await notifications.route();
    const qaSlot = (await slots(versionId)).find((slot) => slot.role === 'qa')!;
    await approvals.decide({
      actor: person(qa),
      projectId,
      approvalId: qaSlot.id,
      userId: qa,
      decision: 'reject',
      comment: '다시',
    });
    for (const row of await notificationsOf(NERV_EVENT.APPROVAL_OVERDUE)) {
      expect(row.state).toBe('read');
    }
  });

  it('받은 요청 카드는 2일이 지나면 지연이다(`overdue`)', async () => {
    const { versionId } = await submitted('SLA-OVERDUE');
    const before = await approvals.inbox({ projectId, userId: admin, actor: person(admin) });
    expect(before.items.every((card) => card['overdue'] === false)).toBe(true);
    await ageRound(versionId, 3);
    const after = await approvals.inbox({ projectId, userId: admin, actor: person(admin) });
    expect(after.items.map((card) => card['overdue'])).toEqual([true, true]);
  });
});

describe('결재 흐름 — 지연 수와 역할 큐 재검토 지표 (REQ-API-305 · 307)', () => {
  /** 결재 하나 — 결정 여부와 2회째 리마인더까지 갔는지를 고른다 */
  async function approvalWith(input: {
    daysAgo: number;
    decided?: boolean;
    late?: boolean;
  }): Promise<string> {
    const id = newId();
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                             requested_at, decision, decided_by_user_id, decided_at)
       VALUES ($1,$2,'plan',$3,$4, now() - make_interval(days => $5),
               ${input.decided === true ? `'approve', $6, now()` : 'NULL, NULL, NULL'})`,
      [id, projectId, newId(), author, input.daysAgo, ...(input.decided === true ? [admin] : [])],
    );
    if (input.late === true) {
      await pool.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id, payload)
         VALUES ($1,$2,$3,'approval',$4,'{"level":2}'::jsonb)`,
        [newId(), projectId, NERV_EVENT.APPROVAL_REMINDED, id],
      );
    }
    return id;
  }

  it('하루를 넘긴 비율이 30%를 넘으면 재검토 — 하루가 안 된 결재와 창 밖의 결재는 세지 않는다', async () => {
    await approvalWith({ daysAgo: 2, decided: true });
    await approvalWith({ daysAgo: 3, decided: true });
    await approvalWith({ daysAgo: 4, decided: true, late: true });
    // 하루가 안 됐고 결정되지 않았다 — 어느 쪽인지 아직 모른다
    await approvalWith({ daysAgo: 0 });
    // 창 밖 — 40일 전
    await approvalWith({ daysAgo: 40, decided: true, late: true });

    const flow = await approvals.flow(projectId);
    expect(flow.lag).toMatchObject({
      window_days: 30,
      total: 3,
      late: 1,
      threshold: 0.3,
      review_due: true,
    });
    expect(flow.lag.ratio).toBeCloseTo(1 / 3);
  });

  it('30% 이하면 재검토하지 않는다 · 결재가 없으면 비율이 없다', async () => {
    expect((await approvals.flow(projectId)).lag).toMatchObject({
      total: 0,
      ratio: null,
      review_due: false,
    });
    for (const daysAgo of [1, 2, 3, 4, 5, 6, 7]) await approvalWith({ daysAgo, decided: true });
    await approvalWith({ daysAgo: 8, decided: true, late: true });
    // 2회째까지 가고 아직 결정되지 않은 것 — 분모와 분자 모두에 든다
    await approvalWith({ daysAgo: 2, late: true });
    const { lag } = await approvals.flow(projectId);
    expect(lag).toMatchObject({ total: 9, late: 2, review_due: false });
  });

  it('지연 수는 받은 요청과 같은 대기 조건이다 — 결정된 것 · 초안이 된 문서의 자리는 빠진다', async () => {
    await planApproval(49);
    await planApproval(10);
    await approvalWith({ daysAgo: 5, decided: true });
    const { versionId } = await submitted('SLA-FLOW');
    await ageRound(versionId, 3);
    expect((await approvals.flow(projectId)).overdue).toBe(3);
    await ageRound(versionId, 5);
    await approvals.expireDue();
    expect((await approvals.flow(projectId)).overdue).toBe(1);
  });
});
