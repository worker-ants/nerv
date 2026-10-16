// 변경 요청(CR) — 승인본 위의 초안을 감싼다 (2026-10-16 · 사람 결정 D1 · D2 · REQ-API-328 ~ 332 · E19-S01)
//
//   WHEN 승인본이 있는 문서에 새 초안이 생기면 THE SYSTEM SHALL 변경 요청을 연다(표시 키 `<PRJ>-C-XXXXXX`)
//   WHEN 그 초안이 검토 요청 · 승인 · 거절되면 THE SYSTEM SHALL 변경 요청을 같은 트랜잭션에서 옮긴다
//   WHEN planner · admin 이 변경 요청을 거절하거나 작성자가 철회하면 THE SYSTEM SHALL 초안을 버린다(`discarded`)
//   WHEN 승인 전에 영향을 물으면 THE SYSTEM SHALL 델타 · 작업의 몫 · 클레임 · 참조 문서 · 제안을 준다
//   WHEN 그 버전이 승인되면 THE SYSTEM SHALL 고른 제안을 하고 바뀌거나 빠진 요구사항의 작업을 쥔 세션의 사람에게 알린다
//
// 결재는 지금처럼 스펙 버전이 받는다 — 그래서 이 스위트가 보는 것은 **결재 경로가 그대로이고 CR 이 그 거울로 움직이는가**와
// CR 만의 행위(거절 · 철회)와 영향이다.

import { NERV_ERROR, NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { displayKey } from '@nerv/schema/keys';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { ChangeRequestService } from '../../src/modules/spec/change-request.service.js';
import { SearchService } from '../../src/modules/spec/search.service.js';
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
let notifications: NotificationService;
let tasks: TaskService;
let search: SearchService;
let projectId: string;
let planner: string;
let reviewer: string;
let developer: string;
let viewer: string;
let devSession: string;

const person = (userId: string) => ({ userId, isAgent: false });

beforeAll(async () => {
  db = await createScratchDb('nerv_cr');
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
  const claims = new ClaimService();
  tasks = new TaskService(
    claims,
    events,
    new QuestionService(events, orm),
    new SessionService(events, orm, new ClaimService()),
    approvals,
    orm,
    new FailopenService(events, orm),
  );
  search = new SearchService(orm);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('UPDATE agent_session SET current_task_id = NULL');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task_dependency');
  await pool.query('DELETE FROM task');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('UPDATE spec_version SET change_request_id = NULL');
  await pool.query('DELETE FROM change_request');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  await tiers('T2');
});

async function tiers(tier: 'T0' | 'T2' | 'T3'): Promise<void> {
  const boundaries = tier === 'T0' ? [100, 100, 100] : tier === 'T2' ? [0, 0, 100] : [0, 0, 0];
  await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ spec_gate: { tier_boundaries: boundaries, dynamic_escalation: false } }),
    projectId,
  ]);
}

const BODY_V1 = [
  '# 웹챗 위젯',
  '',
  '- REQ-CRX-001 WHEN 세션을 재개하면 THE SYSTEM SHALL 마지막 20건을 복원한다',
  '- REQ-CRX-002 WHEN iframe 으로 임베드하면 THE SYSTEM SHALL 레거시 모드로 그린다',
  '',
].join('\n');

/** 001 을 고치고 002 를 빼고 003 을 더한다 */
const BODY_V2 = [
  '# 웹챗 위젯',
  '',
  '- REQ-CRX-001 WHEN 세션을 재개하면 THE SYSTEM SHALL 마지막 30건을 복원한다',
  '- REQ-CRX-003 WHEN 연결이 끊기면 THE SYSTEM SHALL 재시도 배너를 보인다',
  '',
].join('\n');

async function hashOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

/** 승인본 v1 을 가진 문서 — 결재 경로로 승인한다(T2 · planner 의 바로 승인) */
async function approvedSpec(key: string, body = BODY_V1): Promise<{ specId: string; v1: string }> {
  const saved = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId: planner,
  });
  const v1 = saved['spec_version_id'] as string;
  // 첫 초안은 변경 요청이 아니다 — 고칠 약속이 아직 없다
  expect(saved['change_request']).toBeNull();
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

/** 승인본 위의 새 초안 */
async function draftOver(
  specId: string,
  body = BODY_V2,
  userId = developer,
  sessionId: string | null = null,
): Promise<Record<string, unknown>> {
  const base = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version
      WHERE spec_id = $1 AND status IN ('approved', 'draft') ORDER BY version_no DESC LIMIT 1`,
    [specId],
  );
  return specs.draftUpsert({
    roles: ['developer'],
    projectId,
    specId,
    bodyMd: body,
    baseHash: base.rows[0]!.h,
    changeSummary: '재개 30건 · 레거시 임베드 제거',
    userId,
    sessionId,
    allowShrink: true,
  });
}

async function crRow(versionId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT id, key, status::text AS status, risk::text AS risk, origin::text AS origin,
            planned_actions, decided_at, base_version_id, title, rationale_md
       FROM change_request WHERE proposed_version_id = $1`,
    [versionId],
  );
  return rows[0] as Record<string, unknown>;
}

async function eventsOf(type: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT subject_type, subject_id, from_state, to_state, actor_user_id, payload
       FROM event WHERE type = $1 ORDER BY occurred_at, id`,
    [type],
  );
  return rows as Record<string, unknown>[];
}

async function statusOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ s: string }>(
    `SELECT status::text AS s FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.s;
}

/** 결재 자리 하나를 reviewer 가 결정한다 */
async function decideAs(
  versionId: string,
  decision: 'approve' | 'reject',
  extra: Partial<Parameters<ApprovalService['decide']>[0]> = {},
): ReturnType<ApprovalService['decide']> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM approval WHERE subject_id = $1 AND decision IS NULL ORDER BY requested_at LIMIT 1`,
    [versionId],
  );
  return approvals.decide({
    actor: person(reviewer),
    projectId,
    approvalId: rows[0]!.id,
    userId: reviewer,
    decision,
    comment: decision === 'reject' ? '레거시 제거는 다음 분기에' : '',
    seenContentHash: await hashOf(versionId),
    ...extra,
  });
}

/** 이 문서의 작업 — 출처 요구사항 번호로 잇는다 */
async function task(
  specVersionId: string,
  ref: string | null,
  status: string,
  title: string,
): Promise<{ id: string; key: string }> {
  const id = newId();
  const key = displayKey('CLV', 'T', id);
  const req =
    ref === null
      ? null
      : ((await pool.query<{ id: string }>(`SELECT id FROM requirement WHERE ref = $1`, [ref]))
          .rows[0]?.id ?? null);
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id, source_requirement_id,
                       goal_md, output_format_md, tools_sources_md, boundaries_md, spec_impact, done_at)
     VALUES ($1,$2,$3,$4,$5::task_status,$6,$7,'g','o','t','b',
             CASE WHEN $5 = 'done' THEN '{"none": true}'::jsonb END,
             CASE WHEN $5 = 'done' THEN now() END)`,
    [id, projectId, key, title, status, specVersionId, req],
  );
  return { id, key };
}

async function claimOf(
  taskId: string,
  userId = developer,
  sessionId = devSession,
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,'active', now() + interval '20 minutes')`,
    [id, projectId, taskId, sessionId, userId],
  );
  return id;
}

async function notifiedFor(type: string): Promise<{ user_id: string; tier: string }[]> {
  await notifications.route();
  const { rows } = await pool.query<{ user_id: string; tier: string }>(
    `SELECT n.user_id, n.importance::text AS tier FROM notification n
       JOIN event e ON e.id = n.event_id WHERE e.type = $1 ORDER BY n.user_id`,
    [type],
  );
  return rows;
}

describe('자동 생성과 표시 키 (REQ-API-328 · 사람 결정 D2)', () => {
  it('승인본 위의 새 초안이 CR 을 연다 — 키는 <PRJ>-C-XXXXXX, 초안과 서로를 가리킨다', async () => {
    const { specId, v1 } = await approvedSpec('SPC-CR-OPEN');
    // 승인본이 없던 첫 초안(v1)은 CR 이 아니다 — 고칠 약속이 아직 없었다
    const before = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM change_request WHERE spec_id = $1`,
      [specId],
    );
    expect(before.rows[0]!.n).toBe(0);
    const saved = await draftOver(specId);
    const v2 = saved['spec_version_id'] as string;

    const cr = await crRow(v2);
    expect(cr['status']).toBe('open');
    expect(cr['base_version_id']).toBe(v1);
    expect(cr['origin']).toBe('human');
    expect(cr['title']).toBe('SPC-CR-OPEN');
    expect(cr['rationale_md']).toBe('재개 30건 · 레거시 임베드 제거');
    expect(cr['key']).toMatch(/^CLV-C-[0-9A-HJKMNP-TV-Z]{6}$/);
    // 씨앗은 CR 의 UUID 다 — 같은 함수가 같은 키를 낸다
    expect(cr['key']).toBe(displayKey('CLV', 'C', String(cr['id'])));
    const { rows } = await pool.query<{ cr: string }>(
      `SELECT change_request_id AS cr FROM spec_version WHERE id = $1`,
      [v2],
    );
    expect(rows[0]!.cr).toBe(cr['id']);

    // 저장 응답 · 문서 응답이 CR 을 말한다 — 승인본으로 읽어도 열린 CR 이 보인다
    expect(saved['change_request']).toMatchObject({ key: cr['key'], status: 'open' });
    expect(String((saved['change_request'] as Record<string, unknown>)['web_url'])).toContain(
      `/p/clemvion/crs/${String(cr['key'])}`,
    );
    const read = await specs.get({ projectId, specKey: 'SPC-CR-OPEN' });
    expect(read['change_request']).toBeNull();
    expect(read['open_change_request']).toMatchObject({ key: cr['key'], status: 'open' });

    const opened = await eventsOf(NERV_EVENT_PHASE2.CR_OPENED);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      subject_type: 'change_request',
      subject_id: cr['id'],
      to_state: 'open',
      payload: { spec_key: 'SPC-CR-OPEN', base_version_no: 1, version_no: 2 },
    });
  });

  it('같은 초안을 다시 저장하면 CR 은 그대로 하나다 — 이유는 변경 요약을 따른다', async () => {
    const { specId } = await approvedSpec('SPC-CR-RESAVE');
    const first = await draftOver(specId);
    const v2 = first['spec_version_id'] as string;
    await specs.draftUpsert({
      roles: ['developer'],
      projectId,
      specId,
      bodyMd: `${BODY_V2}\n추가 문단\n`,
      baseHash: await hashOf(v2),
      changeSummary: '배너 문구 보강',
      userId: developer,
    });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM change_request`);
    expect(rows[0]).toEqual({ n: 1 });
    expect((await crRow(v2))['rationale_md']).toBe('배너 문구 보강');
  });

  it('키는 프로젝트 안에서 유일하고, 문서마다 열린 CR 은 하나다(DB 가 막는다)', async () => {
    const { specId } = await approvedSpec('SPC-CR-UNIQUE');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    const cr = await crRow(v2);
    const { rows: base } = await pool.query<{ id: string }>(
      `SELECT base_version_id AS id FROM change_request WHERE id = $1`,
      [cr['id']],
    );
    // 같은 키
    await expect(
      pool.query(
        `INSERT INTO change_request (id, project_id, spec_id, key, base_version_id, proposed_version_id,
                                     title, status, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$5,'x','approved',$6)`,
        [newId(), projectId, specId, cr['key'], base[0]!.id, planner],
      ),
    ).rejects.toMatchObject({ constraint: 'change_request_key_uq' });
    // 같은 문서의 두 번째 열린 CR
    await expect(
      pool.query(
        `INSERT INTO change_request (id, project_id, spec_id, key, base_version_id, proposed_version_id,
                                     title, status, created_by_user_id)
         VALUES ($1,$2,$3,'CLV-C-ZZZZZZ',$4,$4,'x','open',$5)`,
        [newId(), projectId, specId, base[0]!.id, planner],
      ),
    ).rejects.toMatchObject({ constraint: 'change_request_spec_open_uq' });
  });

  it('에이전트 세션이 쓴 초안이면 출처가 agent 다', async () => {
    const { specId } = await approvedSpec('SPC-CR-AGENT');
    const v2 = (await draftOver(specId, BODY_V2, developer, devSession))[
      'spec_version_id'
    ] as string;
    expect((await crRow(v2))['origin']).toBe('agent');
  });
});

describe('상태 동기화 — 결재는 버전이 받고 CR 은 그 거울이다 (REQ-API-328 · 사람 결정 D1)', () => {
  it('검토 요청 → 검토 중(위험도는 티어) · 결재 거절 → 다시 열림 · 다시 내고 승인 → 승인', async () => {
    const { specId } = await approvedSpec('SPC-CR-SYNC');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;

    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    expect(await crRow(v2)).toMatchObject({ status: 'in_review', risk: 'normal' });

    await decideAs(v2, 'reject');
    // 결재의 거절은 "고쳐서 다시 내라" 다 — CR 은 닫히지 않는다
    expect(await statusOf(v2)).toBe('draft');
    expect((await crRow(v2))['status']).toBe('open');
    expect((await eventsOf(NERV_EVENT_PHASE2.CR_REOPENED))[0]).toMatchObject({
      from_state: 'in_review',
      to_state: 'open',
      payload: { cause: 'rejected' },
    });

    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    const decided = await decideAs(v2, 'approve');
    expect(decided.quorum).toMatchObject({ satisfied: true });
    const cr = await crRow(v2);
    expect(cr['status']).toBe('approved');
    expect(cr['decided_at']).not.toBeNull();
    expect(await eventsOf(NERV_EVENT_PHASE2.CR_SUBMITTED)).toHaveLength(2);
    expect((await eventsOf(NERV_EVENT_PHASE2.CR_APPROVED))[0]).toMatchObject({
      from_state: 'in_review',
      to_state: 'approved',
      payload: { version_no: 2, base_version_no: 1, delta: { added: 1, modified: 1, removed: 1 } },
    });
  });

  it('자동 통과(T0)는 위험도 low 로 검토 중을 지나 승인된다', async () => {
    const { specId } = await approvedSpec('SPC-CR-T0');
    await tiers('T0');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    expect(await crRow(v2)).toMatchObject({ status: 'approved', risk: 'low' });
  });

  it('T3 이면 위험도 high 다', async () => {
    const { specId } = await approvedSpec('SPC-CR-T3');
    await tiers('T3');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    expect(await crRow(v2)).toMatchObject({ status: 'in_review', risk: 'high' });
  });

  it('결재 만료도 CR 을 다시 연다', async () => {
    const { specId } = await approvedSpec('SPC-CR-EXPIRE');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    await pool.query(
      `UPDATE approval SET requested_at = now() - interval '8 days' WHERE subject_id = $1`,
      [v2],
    );
    expect(await approvals.expireDue()).toEqual({ expired: 1 });
    expect((await crRow(v2))['status']).toBe('open');
    expect((await eventsOf(NERV_EVENT_PHASE2.CR_REOPENED))[0]).toMatchObject({
      payload: { cause: 'expired' },
    });
  });
});

describe('거절 · 철회 — 초안을 버린다 (REQ-API-329 · 사람 결정 D1)', () => {
  it('planner 가 사유와 함께 거절하면 초안은 버려지고 다음 저장은 새 버전 · 새 CR 이다', async () => {
    const { specId } = await approvedSpec('SPC-CR-REJECT');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    const cr = await crRow(v2);

    const out = await crs.reject({
      projectId,
      ref: String(cr['key']),
      actor: person(planner),
      roles: ['planner'],
      reason: '이번 분기 범위가 아니다',
    });
    expect(out).toMatchObject({ status: 'rejected', discarded_version_no: 2 });
    expect(await statusOf(v2)).toBe('discarded');
    expect((await crRow(v2))['status']).toBe('rejected');
    // 리스는 초안에만 남는다 — 함께 비웠다
    const { rows: lease } = await pool.query(
      `SELECT edit_lease_user_id FROM spec_version WHERE id = $1`,
      [v2],
    );
    expect(lease[0]).toEqual({ edit_lease_user_id: null });

    // 문서는 승인본 상태로 돌아간다 — 최신 기준도 버린 초안을 건너뛴다
    const latest = await specs.get({ projectId, specKey: 'SPC-CR-REJECT', basis: 'latest' });
    expect(latest).toMatchObject({ version_no: 1, doc_status: 'approved', latest_version_no: 1 });
    expect(latest['open_change_request']).toBeNull();
    // 이력에는 남는다 — 어느 제안이었는지까지
    const versions = await specs.versions({ projectId, specKey: 'SPC-CR-REJECT' });
    expect(versions[0]).toMatchObject({
      version_no: 2,
      status: 'discarded',
      change_request_key: cr['key'],
      change_request_status: 'rejected',
    });

    // 다음 저장 — 번호는 다시 쓰지 않고, 계보는 승인본이다
    const next = await draftOver(specId, `${BODY_V2}\n다시\n`);
    const v3 = next['spec_version_id'] as string;
    expect(next).toMatchObject({ version_no: 3, created: true });
    const { rows: lineage } = await pool.query<{ base: string }>(
      `SELECT b.version_no AS base FROM spec_version d JOIN spec_version b ON b.id = d.base_version_id
        WHERE d.id = $1`,
      [v3],
    );
    expect(lineage[0]!.base).toBe(1);
    expect((await crRow(v3))['status']).toBe('open');
    expect((await crRow(v3))['key']).not.toBe(cr['key']);

    // 작성자에게 중요(high) 알림 — 거절한 사람은 받지 않는다
    expect((await eventsOf(NERV_EVENT_PHASE2.CR_REJECTED))[0]).toMatchObject({
      to_state: 'rejected',
      payload: { reason: '이번 분기 범위가 아니다', discarded: true },
    });
    expect(await notifiedFor(NERV_EVENT_PHASE2.CR_REJECTED)).toEqual([
      { user_id: developer, tier: 'immediate' },
    ]);
  });

  it('거절은 planner · admin 만 · 사람만 하고, 검토 중이면 결재부터다', async () => {
    const { specId } = await approvedSpec('SPC-CR-REJECT-GUARD');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    const key = String((await crRow(v2))['key']);
    await expect(
      crs.reject({
        projectId,
        ref: key,
        actor: person(developer),
        roles: ['developer'],
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'role_required' } });
    await expect(
      crs.reject({
        projectId,
        ref: key,
        actor: { userId: planner, isAgent: true },
        roles: ['planner'],
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });

    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    await expect(
      crs.reject({ projectId, ref: key, actor: person(planner), roles: ['planner'], reason: 'x' }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION, details: { kind: 'cr_in_review' } });
    expect(await statusOf(v2)).toBe('in_review');
  });

  it('작성자는 철회한다 — 남은 철회하지 못한다', async () => {
    const { specId } = await approvedSpec('SPC-CR-WITHDRAW');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    const key = String((await crRow(v2))['key']);
    await expect(
      crs.withdraw({
        projectId,
        ref: key,
        userId: reviewer,
        sessionId: null,
        isAgent: false,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'not_author' } });

    const out = await crs.withdraw({
      projectId,
      ref: key,
      userId: developer,
      sessionId: null,
      isAgent: false,
      reason: '다른 방법으로 간다',
    });
    expect(out).toMatchObject({ status: 'withdrawn' });
    expect(await statusOf(v2)).toBe('discarded');
    expect(await eventsOf(NERV_EVENT_PHASE2.CR_WITHDRAWN)).toHaveLength(1);
    // 철회는 기록만 한다
    expect(await notifiedFor(NERV_EVENT_PHASE2.CR_WITHDRAWN)).toEqual([]);
    // 끝난 CR 은 다시 끝내지 못한다
    await expect(
      crs.withdraw({
        projectId,
        ref: key,
        userId: developer,
        sessionId: null,
        isAgent: false,
        reason: null,
      }),
    ).rejects.toMatchObject({ details: { kind: 'cr_closed', status: 'withdrawn' } });
  });
});

describe('영향 미리보기 (REQ-API-330 · spec-workflow §3.3)', () => {
  async function scene(): Promise<{
    specId: string;
    v1: string;
    v2: string;
    done1: { id: string; key: string };
    progress1: { id: string; key: string };
    backlog2: { id: string; key: string };
    claimed2: { id: string; key: string };
    claimProgress: string;
    claimRemoved: string;
  }> {
    const { specId, v1 } = await approvedSpec('SPC-CR-IMPACT');
    const done1 = await task(v1, 'REQ-CRX-001', 'done', '재개 복원 구현');
    const progress1 = await task(v1, 'REQ-CRX-001', 'in_progress', '재개 복원 다듬기');
    const backlog2 = await task(v1, 'REQ-CRX-002', 'backlog', '레거시 임베드 문서');
    const claimed2 = await task(v1, 'REQ-CRX-002', 'in_progress', '레거시 임베드 고치기');
    const claimProgress = await claimOf(progress1.id);
    const claimRemoved = await claimOf(claimed2.id);
    // 이 문서를 참조하는 다른 문서
    const other = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-CR-REFERER',
      title: '참조하는 문서',
      type: 'feature',
      bodyMd: '# 참조\n\n[웹챗](SPC-CR-IMPACT)\n',
      userId: planner,
    });
    // 본문의 링크가 참조 관계가 된다(REQ-API-024) — 영향은 그 역방향을 센다
    expect(other['spec_id']).toBeDefined();
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    return { specId, v1, v2, done1, progress1, backlog2, claimed2, claimProgress, claimRemoved };
  }

  it('델타 · 작업의 몫 · 클레임 · 참조 문서 · 제안을 센다 — CR 상세와 EP-SPEC-31 이 같은 값이다', async () => {
    const s = await scene();
    const impact = await crs.impactOfVersion({ projectId, specVersionId: s.v2 });
    expect(impact.base_version_no).toBe(1);
    expect(impact.counts).toEqual({
      added: 1,
      modified: 1,
      removed: 1,
      tasks: 4,
      claims: 2,
      affected_claims: 2,
      referencing: 1,
    });
    expect(impact.delta.modified[0]).toMatchObject({
      ref: 'REQ-CRX-001',
      before: expect.stringContaining('20건') as unknown,
      after: expect.stringContaining('30건') as unknown,
    });
    const effect = Object.fromEntries(impact.tasks.map((t) => [t.key, t.effect]));
    expect(effect).toEqual({
      [s.done1.key]: 'reverify',
      [s.progress1.key]: 'rebrief',
      [s.backlog2.key]: 'cancel',
      [s.claimed2.key]: 'stop',
    });
    expect(impact.suggestions.derive.map((d) => d.ref)).toEqual(['REQ-CRX-003']);
    expect(impact.suggestions.reverify).toEqual([
      {
        ref: 'REQ-CRX-001',
        statement: expect.stringContaining('30건') as unknown,
        done_tasks: [s.done1.key],
      },
    ]);
    expect(impact.suggestions.cancel.map((c) => c.task_key)).toEqual([s.backlog2.key]);
    expect(impact.claims.every((c) => c.hostname === 'linux-ci-01')).toBe(true);
    expect(impact.referencing).toEqual([
      { key: 'SPC-CR-REFERER', title: '참조하는 문서', kinds: ['references'] },
    ]);

    const detail = await crs.get({ projectId, ref: String((await crRow(s.v2))['key']) });
    expect((detail['impact'] as { counts: unknown }).counts).toEqual(impact.counts);
    expect(detail).toMatchObject({
      spec_key: 'SPC-CR-IMPACT',
      base_version_no: 1,
      proposed_version_no: 2,
    });
  });

  it('CR 을 연 사람이 그 클레임을 쥔 사람이면 받지 않는다 — 자기가 한 일의 알림은 소음이다', async () => {
    await scene();
    // 초안을 쓴 developer 가 두 클레임을 다 쥐고 있다 — 행위자라 빠진다
    expect(await notifiedFor(NERV_EVENT_PHASE2.CR_OPENED)).toEqual([]);
    // 이벤트에는 남는다 — 누가 영향을 받는지는 기록이다
    expect((await eventsOf(NERV_EVENT_PHASE2.CR_OPENED))[0]).toMatchObject({
      payload: { claim_user_ids: [developer] },
    });
  });

  it('남이 쥔 작업이면 그 사람이 받는다', async () => {
    const { specId, v1 } = await approvedSpec('SPC-CR-NOTIFY');
    const busy = await task(v1, 'REQ-CRX-001', 'in_progress', '재개 복원');
    await claimOf(busy.id);
    await draftOver(specId, BODY_V2, planner);
    expect(await notifiedFor(NERV_EVENT_PHASE2.CR_OPENED)).toEqual([
      { user_id: developer, tier: 'immediate' },
    ]);
  });
});

describe('승인 때 세 축 — 고른 제안과 중단 확인 (REQ-API-331 · spec-workflow §3.3)', () => {
  it('고른 제안을 하고, 쥔 세션의 사람에게 알리고, 빠진 요구사항의 클레임은 하트비트로 중단 확인을 받는다', async () => {
    const { specId, v1 } = await approvedSpec('SPC-CR-APPLY');
    const done1 = await task(v1, 'REQ-CRX-001', 'done', '재개 복원 구현');
    const backlog2 = await task(v1, 'REQ-CRX-002', 'backlog', '레거시 임베드 문서');
    const claimed2 = await task(v1, 'REQ-CRX-002', 'in_progress', '레거시 임베드 고치기');
    const claim = await claimOf(claimed2.id);
    const v2 = (await draftOver(specId, BODY_V2, planner))['spec_version_id'] as string;

    await specs.submitReview({ projectId, specVersionId: v2, userId: planner, roles: ['planner'] });
    // 고르지 않은 것(REQ-CRX-999)은 건너뛰고 기록한다
    await decideAs(v2, 'approve', {
      crActions: {
        derive: ['REQ-CRX-003', 'REQ-CRX-999'],
        reverify: ['REQ-CRX-001'],
        cancel: [backlog2.key],
      },
    });
    expect(await statusOf(v2)).toBe('approved');

    const approved = (await eventsOf(NERV_EVENT_PHASE2.CR_APPROVED))[0]!;
    const payload = approved['payload'] as Record<string, unknown>;
    const created = payload['created_tasks'] as { key: string; kind: string; ref: string }[];
    expect(created.map((c) => [c.kind, c.ref])).toEqual([
      ['derive', 'REQ-CRX-003'],
      ['reverify', 'REQ-CRX-001'],
    ]);
    expect(payload['archived_tasks']).toEqual([backlog2.key]);
    expect(payload['skipped']).toEqual([{ kind: 'derive', value: 'REQ-CRX-999' }]);
    expect(payload['claim_user_ids']).toEqual([developer]);

    // 만든 작업은 backlog 이고 이 승인본 · 그 요구사항을 기준으로 한다(위임 명세의 목표 칸이 초안이다)
    const { rows: made } = await pool.query(
      `SELECT t.status::text AS status, t.source_spec_version_id AS basis, r.ref, t.goal_md
         FROM task t LEFT JOIN requirement r ON r.id = t.source_requirement_id
        WHERE t.key = ANY($1) ORDER BY r.ref DESC`,
      [created.map((c) => c.key)],
    );
    expect(made).toEqual([
      {
        status: 'backlog',
        basis: v2,
        ref: 'REQ-CRX-003',
        goal_md: expect.stringContaining('재시도 배너'),
      },
      {
        status: 'backlog',
        basis: v2,
        ref: 'REQ-CRX-001',
        goal_md: expect.stringContaining(done1.key),
      },
    ]);
    // 고른 미착수 작업은 보관 — 사유 obsolete 와 그 CR
    const { rows: archived } = await pool.query(
      `SELECT archive_reason::text AS reason, archive_note, archived_by_user_id AS by FROM task WHERE id = $1`,
      [backlog2.id],
    );
    expect(archived[0]).toMatchObject({ reason: 'obsolete', by: reviewer });
    expect(String(archived[0]!['archive_note'])).toContain('REQ-CRX-002');

    // 쥔 세션의 사람에게 critical — 결재한 사람이 아니라 그 작업을 쥔 사람이다
    expect(await notifiedFor(NERV_EVENT_PHASE2.CR_APPROVED)).toEqual([
      { user_id: developer, tier: 'immediate' },
    ]);

    // 진행 중 작업의 요구사항이 빠졌다 — 하트비트가 그 세션에 전한다(중단 확인 요청)
    const beat = await tasks.heartbeat({
      claimId: claim,
      actor: { projectId, userId: developer, sessionId: devSession, isAdmin: false },
    });
    expect(beat.pending).toContainEqual(
      expect.objectContaining({
        kind: 'basis_superseded',
        task_key: claimed2.key,
        requirement_ref: 'REQ-CRX-002',
        requirement_removed: true,
      }),
    );
    // 이미 있던 축은 그대로다 — 재브리핑 · 묘비
    const { rows: rebrief } = await pool.query(
      `SELECT rebrief_required_at IS NOT NULL AS flagged FROM task WHERE id = $1`,
      [claimed2.id],
    );
    expect(rebrief[0]).toEqual({ flagged: true });
    const { rows: tomb } = await pool.query(
      `SELECT removed_in_version_id AS removed FROM requirement WHERE ref = 'REQ-CRX-002'`,
    );
    expect(tomb[0]).toEqual({ removed: v2 });
  });

  it('T3 의 첫 승인이 고른 것을 남기면 둘째 승인이 그것을 한다 — 바로 승인도 같은 칸이다', async () => {
    const { specId } = await approvedSpec('SPC-CR-QUORUM');
    await tiers('T3');
    const v2 = (await draftOver(specId, BODY_V2, developer))['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    const first = await decideAs(v2, 'approve', { crActions: { derive: ['REQ-CRX-003'] } });
    expect(first.quorum).toMatchObject({ satisfied: false });
    expect((await crRow(v2))['planned_actions']).toEqual({
      derive: ['REQ-CRX-003'],
      reverify: [],
      cancel: [],
    });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM approval WHERE subject_id = $1 AND decision IS NULL`,
      [v2],
    );
    await approvals.decide({
      actor: person(planner),
      projectId,
      approvalId: rows[0]!.id,
      userId: planner,
      decision: 'approve',
      seenContentHash: await hashOf(v2),
    });
    const approved = (await eventsOf(NERV_EVENT_PHASE2.CR_APPROVED))[0]!;
    expect((approved['payload'] as Record<string, unknown>)['created_tasks']).toEqual([
      expect.objectContaining({ kind: 'derive', ref: 'REQ-CRX-003' }),
    ]);
  });

  it('고른 제안은 승인에만 붙고, 변경 요청이 없는 결재에는 붙지 않는다(400)', async () => {
    const { specId } = await approvedSpec('SPC-CR-ACTIONS-GUARD');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    await expect(decideAs(v2, 'reject', { crActions: { derive: [] } })).rejects.toMatchObject({
      details: { kind: 'invalid_input', field: 'cr_actions' },
    });
    // 첫 버전(승인본이 없는 문서)의 결재
    const fresh = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-CR-FIRST',
      title: 'first',
      type: 'feature',
      bodyMd: '# 첫 문서\n\n- REQ-CRF-001 WHEN 열면 THE SYSTEM SHALL 보인다\n',
      userId: developer,
    });
    const v1 = fresh['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v1,
      userId: developer,
      roles: ['developer'],
    });
    await expect(
      decideAs(v1, 'approve', { crActions: { derive: ['REQ-CRF-001'] } }),
    ).rejects.toMatchObject({ details: { kind: 'invalid_input', reason: 'no_change_request' } });
    expect(await statusOf(v1)).toBe('in_review');
  });
});

describe('표면 — 받은 요청의 CR 카드 · 검색 · REST (REQ-API-332)', () => {
  it('결재 카드가 CR 카드가 된다 — 같은 결재를 두 카드로 보이지 않는다', async () => {
    const { specId } = await approvedSpec('SPC-CR-CARD');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: v2,
      userId: developer,
      roles: ['developer'],
    });
    const page = await approvals.inboxGlobal({ actor: person(reviewer), userId: reviewer });
    const cards = page.items.filter((c) => c['subject_id'] === v2);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cr_key: (await crRow(v2))['key'],
      cr_status: 'in_review',
      cr_base_version_no: 1,
      cr_delta: { added: 1, modified: 1, removed: 1 },
      cr_impact: { referencing: 0 },
      cr_planned: { derive: 0, reverify: 0, cancel: 0 },
    });
    expect((cards[0]!['cr_delta'] as { items: unknown[] }).items).toHaveLength(3);
  });

  it('검색이 CR 키를 찾는다 — 작업 키와 같은 규칙이다', async () => {
    const { specId } = await approvedSpec('SPC-CR-SEARCH');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    const key = String((await crRow(v2))['key']);
    const hits = await search.search({ projectId, query: key, limit: 5 });
    expect(hits.items[0]).toMatchObject({ key, kind: 'change_request', matched_by: ['id'] });
    const list = await crs.list({ projectId, status: 'open' });
    expect(list.items.map((i) => i['key'])).toEqual([key]);
    await expect(crs.list({ projectId, status: 'closed' })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });
  });
});

describe('REST — EP-CR-01~04 · EP-SPEC-31', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  let viewerToken: string;
  let plannerToken: string;
  let humanPlanner: string;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = db.url;
    process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const email = 'cr-planner@example.com';
    const password = 'correct-horse-battery';
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { email, password, name: '기획' },
    });
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email, password },
    });
    const setCookie = signIn.headers['set-cookie'];
    cookie =
      (Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '')).split(';')[0] ?? '';
    const { rows } = await pool.query<{ id: string; org: string }>(
      `SELECT u.id, (SELECT org_id FROM project WHERE id = $2) AS org FROM "user" u WHERE u.email = $1`,
      [email, projectId],
    );
    humanPlanner = rows[0]!.id;
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), rows[0]!.org, projectId, humanPlanner],
    );
    const auth = app.get(AuthService);
    viewerToken = (
      await auth.issueToken({ projectId, userId: viewer, name: 'v', scopes: ['spec:read'] })
    ).token;
    plannerToken = (
      await auth.issueToken({
        projectId,
        userId: planner,
        name: 'p',
        scopes: ['spec:read', 'spec:draft'],
      })
    ).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('목록 · 단건 · 영향은 읽기 권한이고, 거절은 사람 planner 만 · viewer 는 거절하지 못한다', async () => {
    const { specId } = await approvedSpec('SPC-CR-REST');
    const v2 = (await draftOver(specId))['spec_version_id'] as string;
    const key = String((await crRow(v2))['key']);
    const read = (url: string) =>
      app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${viewerToken}` } });

    const list = await read('/api/v1/projects/clemvion/crs?status=open');
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: { key: string }[] }>().items.map((i) => i.key)).toEqual([key]);
    const one = await read(`/api/v1/projects/clemvion/crs/${key}`);
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ key, status: 'open', impact: { counts: { added: 1 } } });
    const impact = await read(`/api/v1/projects/clemvion/spec-versions/${v2}/impact`);
    expect(impact.json()).toMatchObject({ counts: { added: 1, modified: 1, removed: 1 } });

    const byViewer = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/clemvion/crs/${key}/reject`,
      headers: { authorization: `Bearer ${viewerToken}`, 'content-type': 'application/json' },
      payload: { reason: 'x' },
    });
    expect(byViewer.statusCode).toBe(403);
    // 토큰은 사람이 아니다
    const byToken = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/clemvion/crs/${key}/reject`,
      headers: { authorization: `Bearer ${plannerToken}`, 'content-type': 'application/json' },
      payload: { reason: 'x' },
    });
    expect(byToken.statusCode).toBe(403);
    expect(byToken.json()).toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
    // 사유가 비면 400
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/clemvion/crs/${key}/reject`,
      headers: { cookie, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' },
      payload: { reason: '  ' },
    });
    expect(empty.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/clemvion/crs/${key}/reject`,
      headers: { cookie, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' },
      payload: { reason: '범위 밖' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ key, status: 'rejected' });
    expect(await statusOf(v2)).toBe('discarded');
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  developer = newId();
  viewer = newId();
  devSession = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [id, email, name, role] of [
    [planner, 'jimin@example.com', '지민', 'planner'],
    [reviewer, 'seoyeon@example.com', '서연', 'planner'],
    [developer, 'minu@example.com', '민우', 'developer'],
    [viewer, 'view@example.com', '열람', 'viewer'],
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
