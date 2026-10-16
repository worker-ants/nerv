// SPEC-DRIFT → 변경 요청 · 에스컬레이션 카드 (2026-10-16 · 사람 결정 D3 · REQ-API-332 ~ 337 · E19-S02 · E19-S03)
//
//   WHEN planner · admin 이 spec_drift 발견을 변경 요청으로 보내면 THE SYSTEM SHALL 승인본에서 초안을 열고(열린 CR 이 있으면 거기에)
//        CR(출처 spec_drift)에 발견을 묶고 그 처분을 escalated(사유 spec)로 남긴다
//   WHEN 그 CR 이 승인되면 THE SYSTEM SHALL 발견을 fixed(스펙 수정 · 근거는 승인본)로, 거절되면 dismissed 와 코드 되돌림 작업으로 닫는다
//   WHEN 발견을 사람에게 넘기면 THE SYSTEM SHALL 사유가 정한 사람의 받은 요청에 카드를 세우고, 기다리는 처분이면 세션을 멈췄다가
//        카드의 결정이 그 세션을 바로 푼다
//   WHEN 받은 요청을 유형으로 거르면 THE SYSTEM SHALL 에스컬레이션 카드와 사유가 있는 질문을 함께 모은다

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { displayKey } from '@nerv/schema/keys';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { ChangeRequestService } from '../../src/modules/spec/change-request.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { FailopenService } from '../../src/modules/task/failopen.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let approvals: ApprovalService;
let crs: ChangeRequestService;
let reviews: ReviewService;
let questions: QuestionService;
let notifications: NotificationService;
let projectId: string;
let admin: string;
let planner: string;
let developer: string;
let otherDev: string;
let qa: string;
let devSession: string;

const person = (userId: string) => ({ userId, isAgent: false });
const HEAD = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

beforeAll(async () => {
  db = await createScratchDb('nerv_escalation');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const orm = drizzle(pool);
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
  crs = new ChangeRequestService(events, orm);
  notifications = new NotificationService(orm, silent);
  questions = new QuestionService(events, orm);
  const tasks = new TaskService(
    new ClaimService(),
    events,
    questions,
    new SessionService(events, orm, new ClaimService()),
    approvals,
    orm,
    new FailopenService(events, orm),
  );
  reviews = new ReviewService(events, tasks, orm);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query(`UPDATE agent_session SET state = 'active', current_task_id = NULL`);
  await pool.query('DELETE FROM question');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM resolution');
  await pool.query('UPDATE finding SET promoted_task_id = NULL');
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM review_session');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('UPDATE spec_version SET change_request_id = NULL');
  await pool.query('DELETE FROM change_request');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  // T2 — 검토 요청이 사람의 결재를 세운다(바로 승인은 planner 가 한다)
  await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ spec_gate: { tier_boundaries: [0, 0, 100], dynamic_escalation: false } }),
    projectId,
  ]);
});

const BODY = [
  '# 웹챗 위젯',
  '',
  '- REQ-ESC-001 WHEN 세션을 재개하면 THE SYSTEM SHALL 마지막 20건을 복원한다',
  '',
].join('\n');

const BODY_FIXED = [
  '# 웹챗 위젯',
  '',
  '- REQ-ESC-001 WHEN 세션을 재개하면 THE SYSTEM SHALL 마지막 30건을 복원한다',
  '',
].join('\n');

async function hashOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

/** 승인본 v1 을 가진 문서 */
async function approvedSpec(key: string): Promise<{ specId: string; v1: string }> {
  const saved = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: BODY,
    userId: planner,
  });
  const v1 = saved['spec_version_id'] as string;
  await approvals.approveDirect({
    actor: person(planner),
    surface: 'rest',
    projectId,
    specVersionId: v1,
    userId: planner,
    seenContentHash: await hashOf(v1),
  });
  return { specId: saved['spec_id'] as string, v1 };
}

/** 리뷰 한 라운드와 그 발견 — 작업이 있으면 그 작업의 라운드다 */
async function finding(input: {
  title: string;
  tags?: string[];
  specVersionId?: string | null;
  taskId?: string | null;
  severity?: 'critical' | 'warning' | 'info';
}): Promise<string> {
  const id = newId();
  const sessionRow = newId();
  await pool.query(
    `INSERT INTO review_session (id, project_id, branch, base_sha, head_sha, changeset_hash, kind,
                                 trigger, task_id, agent_session_id)
     VALUES ($1,$2,'feat/esc',$3,$3,decode($4,'hex'),'code','manual',$5,$6)`,
    [
      sessionRow,
      projectId,
      HEAD,
      id.replaceAll('-', '').slice(0, 32),
      input.taskId ?? null,
      devSession,
    ],
  );
  await pool.query(
    `INSERT INTO finding (id, project_id, fingerprint, category, severity, status, title, detail_md,
                          tags, spec_version_id, first_session_id, last_session_id, file_path, line_start)
     VALUES ($1,$2,decode($3,'hex'),'requirement',$4::finding_severity,'open',$5,'원문 — 구현은 30건을 복원한다',
             $6::text[],$7,$8,$8,'src/widget.ts',42)`,
    [
      id,
      projectId,
      id.replaceAll('-', '').slice(0, 32),
      input.severity ?? 'warning',
      input.title,
      input.tags ?? [],
      input.specVersionId ?? null,
      sessionRow,
    ],
  );
  return id;
}

async function taskFor(assignee: string | null, specVersionId: string | null): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, assignee_user_id, source_spec_version_id)
     VALUES ($1,$2,$3,'위젯 복원','backlog',$4,$5)`,
    [id, projectId, displayKey('CLV', 'T', id), assignee, specVersionId],
  );
  return id;
}

async function findingRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT f.status::text AS status, f.promoted_task_id,
            r.kind::text AS kind, r.escalate_reason::text AS reason, r.change_request_id,
            r.commit_sha, r.spec_version_id, r.blocking, r.rationale_md
       FROM finding f
  LEFT JOIN LATERAL (SELECT * FROM resolution WHERE finding_id = f.id
                      ORDER BY created_at DESC LIMIT 1) r ON true
      WHERE f.id = $1`,
    [id],
  );
  return rows[0] as Record<string, unknown>;
}

async function cardsOf(findingId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.decision::text AS decision, a.assignee_role::text AS assignee_role,
            a.assignee_user_id, a.decided_by_user_id, a.comment_md, a.requested_by_session_id
       FROM approval a JOIN resolution r ON r.id = a.subject_id
      WHERE a.subject_type = 'escalation' AND r.finding_id = $1
      ORDER BY a.requested_at`,
    [findingId],
  );
  return rows as Record<string, unknown>[];
}

async function sessionState(): Promise<string> {
  const { rows } = await pool.query<{ s: string }>(
    `SELECT state::text AS s FROM agent_session WHERE id = $1`,
    [devSession],
  );
  return rows[0]!.s;
}

async function inboxOf(
  userId: string,
  extra: { kind?: string; state?: string } = {},
): ReturnType<ApprovalService['inboxGlobal']> {
  return approvals.inboxGlobal({ actor: person(userId), userId, ...extra });
}

async function escalate(
  findingId: string,
  reason: string,
  options: { blocking?: boolean; sessionId?: string | null } = {},
): ReturnType<ReviewService['resolve']> {
  const sessionId = options.sessionId === undefined ? devSession : options.sessionId;
  return reviews.resolve({
    projectId,
    findingId,
    userId: developer,
    sessionId,
    isAgent: sessionId !== null,
    kind: 'escalated',
    status: 'open',
    rationale: '판단이 내 몫이 아니다',
    escalateReason: reason,
    ...(options.blocking === undefined ? {} : { blocking: options.blocking }),
  });
}

async function rejection(fn: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await fn();
  } catch (error) {
    const e = error as { code?: string; details?: Record<string, unknown> };
    return { code: e.code, ...(e.details ?? {}) };
  }
  throw new Error('거절되지 않았다');
}

describe('발견을 변경 요청으로 보낸다 (REQ-API-332 · 337 · E19-S02)', () => {
  it('승인본에서 초안을 열고 CR(출처 spec_drift)에 발견을 묶는다 — 처분은 escalated(spec), 근거와 커밋이 남는다', async () => {
    const { specId, v1 } = await approvedSpec('SPC-ESC-A');
    const f = await finding({
      title: '복원 건수가 스펙과 다르다',
      tags: ['spec_drift'],
      specVersionId: v1,
    });

    const sent = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
      rationale: '구현의 30건이 맞다',
    });
    expect(sent).toMatchObject({ finding_id: f, linked: true, draft_created: true });
    const cr = sent['change_request'] as Record<string, unknown>;
    expect(cr['origin']).toBe('spec_drift');
    expect(cr['status']).toBe('open');
    expect(cr['base_version_no']).toBe(1);
    expect(cr['proposed_version_no']).toBe(2);

    // 초안은 승인본의 본문으로 시작한다 — 스펙을 어떻게 고칠지는 사람이 쓴다
    const { rows: drafts } = await pool.query<{
      id: string;
      body_md: string;
      lease: string | null;
    }>(
      `SELECT id, body_md, edit_lease_user_id AS lease FROM spec_version
        WHERE spec_id = $1 AND status = 'draft'`,
      [specId],
    );
    expect(drafts[0]!.body_md).toBe(BODY);
    expect(drafts[0]!.lease).toBeNull();
    expect(await hashOf(drafts[0]!.id)).toBe(await hashOf(v1));

    expect(await findingRow(f)).toMatchObject({
      status: 'open',
      kind: 'escalated',
      reason: 'spec',
      change_request_id: cr['id'],
      commit_sha: HEAD,
      rationale_md: '구현의 30건이 맞다',
      blocking: false,
    });

    // planner 의 카드 — 유형은 CR 이고 출처 발견과 "초안이 아직 승인본과 같다" 를 보인다
    const inbox = await inboxOf(planner);
    const card = inbox.items.find((c) => c['subject_type'] === 'escalation');
    expect(card).toMatchObject({
      kind: 'cr',
      assignee_role: 'planner',
      escalate_reason: 'spec',
      escalation_cr_key: cr['key'],
      escalation_cr_status: 'open',
      escalation_cr_unchanged: true,
      escalation_cr_spec_key: 'SPC-ESC-A',
    });
    expect(card?.['cr_findings']).toEqual([
      expect.objectContaining({ id: f, title: '복원 건수가 스펙과 다르다', commit_sha: HEAD }),
    ]);
    expect(inbox.kind_counts).toMatchObject({ cr: 1, escalation: 0 });
  });

  it('열린 CR 이 있으면 거기에 잇는다 — 카드는 CR 하나에 하나, 다시 보내도 늘지 않는다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-B');
    const a = await finding({ title: '하나', tags: ['spec_drift'], specVersionId: v1 });
    const b = await finding({ title: '둘', tags: ['spec_drift'], specVersionId: v1 });
    const send = (id: string): ReturnType<ChangeRequestService['fromFinding']> =>
      crs.fromFinding({
        projectId,
        findingId: id,
        userId: planner,
        sessionId: null,
        isAgent: false,
        roles: ['planner'],
      });
    const first = await send(a);
    const second = await send(b);
    expect(second).toMatchObject({ linked: true, draft_created: false });
    expect((second['change_request'] as Record<string, unknown>)['key']).toBe(
      (first['change_request'] as Record<string, unknown>)['key'],
    );
    const again = await send(a);
    expect(again).toMatchObject({ linked: false });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval WHERE subject_type = 'escalation'`,
    );
    expect(rows[0]!.n).toBe(1);
    // 근거를 주지 않으면 서버가 적는다
    expect(String((await findingRow(b))['rationale_md'])).toContain('둘');
  });

  it('권한 · 태그 · 승인본 · 대상이 맞지 않으면 아무것도 바꾸지 않는다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-C');
    const drift = await finding({ title: 'drift', tags: ['spec_drift'], specVersionId: v1 });
    const plain = await finding({ title: '코드 결함', specVersionId: v1 });
    const send = (id: string, roles: string[]): Promise<Record<string, unknown>> =>
      rejection(() =>
        crs.fromFinding({
          projectId,
          findingId: id,
          userId: developer,
          sessionId: null,
          isAgent: false,
          roles,
        }),
      );
    // qa 는 처분은 하지만 스펙을 열지 않는다 — planner · admin 의 일이다
    expect(await send(drift, ['qa'])).toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      kind: 'role_required',
    });
    expect(await send(plain, ['planner'])).toMatchObject({ kind: 'not_spec_drift' });
    const orphan = await finding({ title: 'orphan', tags: ['spec_drift'] });
    expect(await send(orphan, ['admin'])).toMatchObject({ kind: 'no_origin_spec' });
    // 승인본이 없는 문서는 CR 이 아니다
    const fresh = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-ESC-FRESH',
      title: 'fresh',
      type: 'feature',
      bodyMd: BODY,
      userId: planner,
    });
    const onDraft = await finding({
      title: 'fresh drift',
      tags: ['spec_drift'],
      specVersionId: fresh['spec_version_id'] as string,
    });
    expect(await send(onDraft, ['planner'])).toMatchObject({ kind: 'no_approved_version' });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM change_request`,
    );
    expect(rows[0]!.n).toBe(0);
    expect(await findingRow(drift)).toMatchObject({ status: 'open', kind: null });
  });

  it('초안이 승인본과 같으면 검토를 요청할 수 없다 — 고치면 결재가 서고, 그동안 planner 카드는 쉰다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-D');
    const f = await finding({ title: '스펙 갱신', tags: ['spec_drift'], specVersionId: v1 });
    const sent = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
    });
    const cr = sent['change_request'] as Record<string, unknown>;
    const draftId = String(cr['proposed_version_id']);
    const refused = await rejection(() =>
      specs.submitReview({
        projectId,
        specVersionId: draftId,
        userId: planner,
        roles: ['planner'],
      }),
    );
    expect(refused).toMatchObject({ kind: 'cr_unchanged', change_request_key: cr['key'] });

    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: 'SPC-ESC-D',
      bodyMd: BODY_FIXED,
      baseHash: await hashOf(draftId),
      changeSummary: '30건으로',
      userId: planner,
    });
    await specs.submitReview({
      projectId,
      specVersionId: draftId,
      userId: planner,
      roles: ['planner'],
    });
    // 검토 중에는 스펙 결재 카드가 CR 카드다 — 출처 발견 · 커밋을 함께 보인다. planner 카드는 대기에서 빠진다
    const inbox = await inboxOf(admin);
    expect(inbox.items.filter((c) => c['subject_type'] === 'escalation')).toEqual([]);
    const crCard = inbox.items.find((c) => c['subject_type'] === 'spec_version');
    expect(crCard).toMatchObject({ kind: 'cr', cr_key: cr['key'], cr_origin: 'spec_drift' });
    expect(crCard?.['cr_findings']).toEqual([expect.objectContaining({ id: f, commit_sha: HEAD })]);
  });

  it('CR 이 승인되면 발견은 fixed — 처분은 spec_change 이고 근거는 승인된 버전이다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-E');
    const f = await finding({ title: '승인으로 닫힌다', tags: ['spec_drift'], specVersionId: v1 });
    const sent = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
    });
    const cr = sent['change_request'] as Record<string, unknown>;
    const draftId = String(cr['proposed_version_id']);
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: 'SPC-ESC-E',
      bodyMd: BODY_FIXED,
      baseHash: await hashOf(draftId),
      userId: planner,
    });
    await approvals.approveDirect({
      actor: person(admin),
      surface: 'rest',
      projectId,
      specVersionId: draftId,
      userId: admin,
      seenContentHash: await hashOf(draftId),
    });
    expect(await findingRow(f)).toMatchObject({
      status: 'fixed',
      kind: 'spec_change',
      spec_version_id: draftId,
      change_request_id: cr['id'],
    });
    // planner 카드는 승인으로 닫혔다 — 누른 사람이 결정자다
    const [card] = await cardsOf(f);
    expect(card).toMatchObject({ decision: 'approve', decided_by_user_id: admin });
    const decided = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE type = $1 AND subject_id = $2`,
      [NERV_EVENT.APPROVAL_DECIDED, card!['id']],
    );
    expect(decided.rows[0]!.payload).toMatchObject({
      resolution: 'spec_change',
      settled: true,
      change_request_key: cr['key'],
    });
  });

  it('CR 이 거절되면 발견은 dismissed 이고 코드 되돌림 작업이 생긴다 — 담당 · 기준은 발견의 작업에서 온다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-F');
    const work = await taskFor(developer, v1);
    const f = await finding({
      title: '거절로 되돌린다',
      tags: ['spec_drift'],
      specVersionId: v1,
      taskId: work,
      severity: 'critical',
    });
    const sent = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
    });
    const cr = sent['change_request'] as Record<string, unknown>;
    await crs.reject({
      projectId,
      ref: String(cr['key']),
      actor: person(planner),
      roles: ['planner'],
      reason: '스펙의 20건이 계약이다',
    });
    const row = await findingRow(f);
    expect(row).toMatchObject({
      status: 'dismissed',
      kind: 'dismissed',
      change_request_id: cr['id'],
    });
    expect(String(row['rationale_md'])).toContain('스펙의 20건이 계약이다');
    const { rows: made } = await pool.query(
      `SELECT key, title, body_md, status::text AS status, priority::text AS priority,
              assignee_user_id, source_spec_version_id
         FROM task WHERE id = $1`,
      [row['promoted_task_id']],
    );
    expect(made[0]).toMatchObject({
      status: 'backlog',
      priority: 'P0',
      assignee_user_id: developer,
      source_spec_version_id: v1,
    });
    expect(String(made[0]!['title'])).toContain('거절로 되돌린다');
    expect(String(made[0]!['body_md'])).toContain(String(cr['key']));
    expect(String(made[0]!['body_md'])).toContain(HEAD);
    expect(String(made[0]!['body_md'])).toContain(f);
    const created = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT e.payload FROM event e JOIN task t ON t.id = e.subject_id WHERE e.type = $1 AND t.key = $2`,
      [NERV_EVENT.TASK_CREATED, made[0]!['key']],
    );
    expect(created.rows[0]!.payload).toMatchObject({ kind: 'revert', finding_id: f });
    const [card] = await cardsOf(f);
    expect(card).toMatchObject({ decision: 'reject', decided_by_user_id: planner });
  });

  it('CR 을 철회하면 발견은 열린 채로 남고 카드만 닫힌다 — 다시 보낼 수 있다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-G');
    const f = await finding({ title: '철회', tags: ['spec_drift'], specVersionId: v1 });
    const sent = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
    });
    const cr = sent['change_request'] as Record<string, unknown>;
    await crs.withdraw({
      projectId,
      ref: String(cr['key']),
      userId: planner,
      sessionId: null,
      isAgent: false,
      reason: null,
    });
    expect(await findingRow(f)).toMatchObject({ status: 'open', kind: 'escalated' });
    expect((await cardsOf(f))[0]).toMatchObject({ decision: 'reject' });
    const again = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
    });
    expect(again).toMatchObject({ linked: true, draft_created: true });
  });

  it('에이전트가 초안을 올리며 finding_id 를 주면 같은 CR 로 묶는다 — 판정이 맞지 않으면 본문도 남지 않는다', async () => {
    const { specId, v1 } = await approvedSpec('SPC-ESC-H');
    const f = await finding({
      title: '에이전트가 고친다',
      tags: ['spec_drift'],
      specVersionId: v1,
    });
    const plain = await finding({ title: '태그 없음', specVersionId: v1 });
    const v1Hash = await hashOf(v1);
    const refused = await rejection(() =>
      specs.draftUpsert({
        roles: ['developer'],
        projectId,
        specId,
        bodyMd: BODY_FIXED,
        baseHash: v1Hash,
        userId: developer,
        sessionId: devSession,
        findingId: plain,
      }),
    );
    expect(refused).toMatchObject({ kind: 'not_spec_drift' });
    const { rows: none } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spec_version WHERE spec_id = $1`,
      [specId],
    );
    expect(none[0]!.n).toBe(1);

    const saved = await specs.draftUpsert({
      roles: ['developer'],
      projectId,
      specId,
      bodyMd: BODY_FIXED,
      baseHash: await hashOf(v1),
      changeSummary: '구현의 30건으로 스펙을 맞춘다',
      userId: developer,
      sessionId: devSession,
      findingId: f,
    });
    const crKey = (saved['change_request'] as Record<string, unknown>)['key'];
    expect(saved['finding']).toMatchObject({ id: f, linked: true, change_request_key: crKey });
    const { rows } = await pool.query<{ origin: string }>(
      `SELECT origin::text AS origin FROM change_request WHERE key = $1`,
      [crKey],
    );
    expect(rows[0]!.origin).toBe('spec_drift');
    expect(await findingRow(f)).toMatchObject({ kind: 'escalated', reason: 'spec' });
    // 고친 초안이라 카드는 "검토를 요청할 수 있다" 를 말한다
    const card = (await inboxOf(planner)).items.find((c) => c['subject_type'] === 'escalation');
    expect(card).toMatchObject({ escalation_cr_unchanged: false });
  });
});

describe('에스컬레이션 카드 — 사유별 받는 사람 (REQ-API-333 · E19-S03 · 사람 결정 D3)', () => {
  it('spec 은 planner, infra · sensitive-fix 는 admin, 그 밖은 작업 담당자와 기본 큐', async () => {
    const work = await taskFor(otherDev, null);
    const forSpec = await finding({ title: '스펙 공백' });
    const forInfra = await finding({ title: '인프라' });
    const forUser = await finding({ title: '제품 결정', taskId: work });
    await escalate(forSpec, 'spec', { blocking: false });
    await escalate(forInfra, 'infra', { blocking: false });
    await escalate(forUser, 'user-decision', { blocking: false });

    expect((await cardsOf(forSpec))[0]).toMatchObject({ assignee_role: 'planner' });
    expect((await cardsOf(forInfra))[0]).toMatchObject({ assignee_role: 'admin' });
    expect((await cardsOf(forUser))[0]).toMatchObject({
      assignee_role: null,
      assignee_user_id: otherDev,
    });

    const titles = async (userId: string): Promise<string[]> =>
      (await inboxOf(userId, { kind: 'escalation' })).items
        .map((c) => String(c['finding_title']))
        .sort();
    expect(await titles(planner)).toEqual(['스펙 공백', '제품 결정']);
    expect(await titles(admin)).toEqual(['스펙 공백', '인프라', '제품 결정']);
    // 담당자는 결재권이 없는 역할이어도 받는다 — 담당하지 않는 developer 는 받지 않는다
    expect(await titles(otherDev)).toEqual(['제품 결정']);
    expect(await titles(developer)).toEqual([]);
    const assigned = (await inboxOf(otherDev)).items[0]!;
    expect(assigned).toMatchObject({
      kind: 'escalation',
      can_approve: true,
      escalate_reason: 'user-decision',
      finding_detail_md: '원문 — 구현은 30건을 복원한다',
      escalation_commit: HEAD,
      escalation_rationale: '판단이 내 몫이 아니다',
      finding_task_key: expect.stringMatching(/^CLV-T-/),
    });

    // 알림도 같은 사람에게 간다 — 담당자와 기본 큐(행위자 제외)
    await notifications.route();
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT n.user_id FROM notification n JOIN event e ON e.id = n.event_id
        WHERE e.type = $1 AND e.payload->>'finding_id' = $2 ORDER BY 1`,
      [NERV_EVENT.APPROVAL_REQUESTED, forUser],
    );
    expect(rows.map((r) => r.user_id).sort()).toEqual([admin, otherDev, planner].sort());
  });

  it('다시 넘겨도 카드는 하나다 — 서 있는 카드를 돌려준다', async () => {
    const f = await finding({ title: '한 번만' });
    const first = await escalate(f, 'infra', { blocking: false });
    const again = await escalate(f, 'infra', { blocking: false });
    expect(again.escalation).toMatchObject({
      approval_id: first.escalation?.approval_id,
      existing: true,
    });
    expect(await cardsOf(f)).toHaveLength(1);
    // CR id 를 적어 넘기면 변경 요청으로 보내는 길로 안내한다
    expect(
      await rejection(() =>
        reviews.resolve({
          projectId,
          findingId: f,
          userId: developer,
          kind: 'escalated',
          status: 'open',
          rationale: 'x',
          escalateReason: 'spec',
          changeRequestId: newId(),
        }),
      ),
    ).toMatchObject({ field: 'change_request_id', reason: 'send_to_change_request' });
  });
});

describe('기다리는 세션 — 결정이 바로 푼다 (REQ-API-334 · 335)', () => {
  it('세션이 넘긴 처분은 기본으로 기다린다 — 카드의 결정(고칠 것)이 세션을 풀고 하트비트로 전한다', async () => {
    const f = await finding({ title: '기다린다' });
    const made = await escalate(f, 'infra');
    expect(made.escalation).toMatchObject({ blocking: true, assignee_role: 'admin' });
    expect(await sessionState()).toBe('awaiting_input');
    const card = (await inboxOf(admin)).items.find((c) => c['subject_type'] === 'escalation')!;
    expect(card).toMatchObject({ session_waiting: true, escalation_blocking: true });

    const decided = await approvals.decide({
      actor: person(admin),
      projectId,
      approvalId: String(card['id']),
      userId: admin,
      decision: 'comment',
      resolution: 'fix',
      comment: '고쳐라 — 설정 파일만 바꾸면 된다',
    });
    expect(decided).toMatchObject({ decision: 'approve', resolution: 'fix' });
    expect(await sessionState()).toBe('active');
    // 고칠 것은 발견을 열린 채로 둔다 — 넘긴 세션이 커밋과 함께 닫는다
    expect(await findingRow(f)).toMatchObject({ status: 'open', kind: 'escalated' });
    const pending = await approvals.pendingDecisionsFor(devSession);
    expect(pending.find((p) => p['subject_type'] === 'escalation')).toMatchObject({
      kind: 'approval_decided',
      decision: 'approve',
      resolution: 'fix',
      finding_id: f,
      comment_md: '고쳐라 — 설정 파일만 바꾸면 된다',
      subject_key: '기다린다',
    });
    // 에이전트가 폴링으로도 읽는다 — 발견 목록이 그 결정을 준다
    const listed = await reviews.findings({ projectId, status: ['open'] });
    expect(listed.items.find((i) => i['id'] === f)).toMatchObject({
      escalate_reason: 'infra',
      escalation_decision: 'approve',
      escalation_resolution: 'fix',
    });
  });

  it('유예 · 기각은 그 발견을 닫는다 — 근거와 처분이 필수이고 다른 결재에는 처분을 받지 않는다', async () => {
    const a = await finding({ title: '유예한다' });
    const b = await finding({ title: '기각한다' });
    await escalate(a, 'sensitive-fix');
    await escalate(b, 'sensitive-fix');
    const cards = (await inboxOf(admin)).items.filter((c) => c['subject_type'] === 'escalation');
    const idOf = (title: string): string =>
      String(cards.find((c) => c['finding_title'] === title)!['id']);
    const decide = (
      id: string,
      resolution: string | null,
      comment: string,
    ): ReturnType<ApprovalService['decide']> =>
      approvals.decide({
        actor: person(admin),
        projectId,
        approvalId: id,
        userId: admin,
        decision: 'approve',
        comment,
        ...(resolution === null ? {} : { resolution }),
      });
    expect(await rejection(() => decide(idOf('유예한다'), null, '근거'))).toMatchObject({
      field: 'resolution',
    });
    expect(await rejection(() => decide(idOf('유예한다'), 'wont_fix', '  '))).toMatchObject({
      kind: 'missing_rationale',
    });
    // 한 세션이 두 카드를 기다린다 — 하나를 정해도 남은 카드가 붙잡는다
    await decide(idOf('유예한다'), 'wont_fix', '다음 분기에 본다');
    expect(await sessionState()).toBe('awaiting_input');
    await decide(idOf('기각한다'), 'dismissed', '오탐');
    expect(await sessionState()).toBe('active');
    expect(await findingRow(a)).toMatchObject({ status: 'wont_fix', kind: 'deferred' });
    expect(await findingRow(b)).toMatchObject({ status: 'dismissed', kind: 'dismissed' });
    // 처리됨 탭이 무엇으로 정했는지 보인다
    const done = await inboxOf(admin, { state: 'decided' });
    expect(
      done.items
        .filter((c) => c['subject_type'] === 'escalation')
        .map((c) => c['escalation_resolution'])
        .sort(),
    ).toEqual(['dismissed', 'wont_fix']);
    // 일괄에는 들지 않는다
    expect(cards[0]).toMatchObject({
      can_bulk_approve: false,
      bulk_block_reason: 'bulk_escalation',
    });
  });

  it('기다리지 않는 처분은 세션을 멈추지 않고, 다른 결정이 세션을 깨우는 것도 막지 않는다', async () => {
    const quiet = await finding({ title: '기다리지 않는다' });
    await escalate(quiet, 'infra', { blocking: false });
    expect(await sessionState()).toBe('active');
    const loud = await finding({ title: '기다린다' });
    await escalate(loud, 'infra');
    expect(await sessionState()).toBe('awaiting_input');
    const card = (await cardsOf(loud))[0]!;
    await approvals.decide({
      actor: person(admin),
      projectId,
      approvalId: String(card['id']),
      userId: admin,
      decision: 'approve',
      resolution: 'fix',
      comment: '고친다',
    });
    // 기다리지 않는 카드가 남아 있어도 세션은 풀린다
    expect(await sessionState()).toBe('active');
  });

  it('다른 길로 처분하면 카드도 닫힌다 — 기다리던 세션이 풀린다', async () => {
    const f = await finding({ title: '리뷰 센터에서 닫는다' });
    await escalate(f, 'user-decision');
    expect(await sessionState()).toBe('awaiting_input');
    await reviews.resolve({
      projectId,
      findingId: f,
      userId: planner,
      kind: 'dismissed',
      status: 'dismissed',
      rationale: '사람이 직접 기각',
    });
    expect((await cardsOf(f))[0]).toMatchObject({
      decision: 'reject',
      decided_by_user_id: planner,
    });
    expect(await sessionState()).toBe('active');
  });

  it('사유가 spec 인 카드에서 변경 요청으로 보내면 그 카드는 change_request 로 닫히고 세션이 풀린다', async () => {
    const { v1 } = await approvedSpec('SPC-ESC-I');
    const f = await finding({ title: '스펙이 틀렸다', tags: ['spec_drift'], specVersionId: v1 });
    await escalate(f, 'spec');
    expect(await sessionState()).toBe('awaiting_input');
    const sent = await crs.fromFinding({
      projectId,
      findingId: f,
      userId: planner,
      sessionId: null,
      isAgent: false,
      roles: ['planner'],
    });
    const cards = await cardsOf(f);
    expect(cards[0]).toMatchObject({ decision: 'approve', decided_by_user_id: planner });
    expect(await sessionState()).toBe('active');
    const pending = await approvals.pendingDecisionsFor(devSession);
    expect(pending.find((p) => p['subject_type'] === 'escalation')).toMatchObject({
      resolution: 'change_request',
      change_request_key: (sent['change_request'] as Record<string, unknown>)['key'],
    });
    // CR 카드가 남은 하나다 — 그 카드는 처분을 받지 않는다(CR 의 결말이 결정이다)
    const drift = cards.find((c) => c['decision'] === null)!;
    expect(
      await rejection(() =>
        approvals.decide({
          actor: person(planner),
          projectId,
          approvalId: String(drift['id']),
          userId: planner,
          decision: 'approve',
          resolution: 'fix',
          comment: 'x',
        }),
      ),
    ).toMatchObject({ kind: 'escalation_has_cr' });
  });
});

describe('받은 요청의 유형 필터 (REQ-API-336)', () => {
  it('에스컬레이션은 발견 카드와 사유가 있는 질문을 함께 모은다 — 질문은 질문으로도 남고, 어휘 밖은 400 이다', async () => {
    const f = await finding({ title: '넘긴 발견' });
    await escalate(f, 'user-decision', { blocking: false });
    await questions.create({
      projectId,
      sessionId: devSession,
      title: '사유 있는 질문',
      escalate: 'user-decision',
      urgency: 'normal',
    });
    await questions.create({
      projectId,
      sessionId: devSession,
      title: '그냥 질문',
      urgency: 'normal',
    });
    const escalations = await inboxOf(planner, { kind: 'escalation' });
    expect(escalations.items.map((c) => c['subject_type']).sort()).toEqual([
      'escalation',
      'question',
    ]);
    expect(escalations.total).toBe(2);
    const onlyQuestions = await inboxOf(planner, { kind: 'question' });
    expect(onlyQuestions.items.map((c) => c['title']).sort()).toEqual([
      '그냥 질문',
      '사유 있는 질문',
    ]);
    const all = await inboxOf(planner);
    expect(all.kind_counts).toMatchObject({ escalation: 2, question: 2, cr: 0, spec: 0 });
    expect(await rejection(() => inboxOf(planner, { kind: 'phase2' }))).toMatchObject({
      kind: 'invalid_input',
    });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  admin = newId();
  planner = newId();
  developer = newId();
  otherDev = newId();
  qa = newId();
  devSession = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [id, email, name, role] of [
    [admin, 'admin@example.com', '관리', 'admin'],
    [planner, 'jimin@example.com', '지민', 'planner'],
    [developer, 'minu@example.com', '민우', 'developer'],
    [otherDev, 'yuna@example.com', '유나', 'developer'],
    [qa, 'qa@example.com', '큐에이', 'qa'],
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
     VALUES ($1,$2,$3,'codex','linux-ci-01','active')`,
    [devSession, projectId, developer],
  );
}
