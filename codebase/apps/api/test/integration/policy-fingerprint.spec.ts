// 판정 이벤트의 적용 정책 지문 · done 게이트의 조건별 결과 (2026-10-15 · 사람 결정 · REQ-API-303)
//
// 정책에는 버전 번호가 없다. 대신 판정마다 **그 판정에 쓴 유효 정책의 지문**을 남기고, 정책을 고칠 때의 감사가 같은 지문과
// 정책 본문을 함께 남긴다 — 둘을 이으면 "그때 왜 자동 통과했나" 를 다시 계산할 수 있다. done 에는 사람 승인이 없으므로
// (2026-09-28 결정 · 10-15 재확인) `task.done` 이 무엇을 보고 닫았는지가 그 판정의 유일한 감사다.

import { defaultGatePolicy, effectiveGatePolicy, newId, NERV_EVENT } from '@nerv/schema';
import { policyFingerprint } from '@nerv/schema/keys';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let admin: string;
let reviewer: string;

const DEFAULT = policyFingerprint(defaultGatePolicy());

beforeAll(async () => {
  db = await createScratchDb('nerv_policy_fp');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query(`UPDATE project SET gate_policy = '{}'::jsonb`);
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM task');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_relation');
  // 변경 요청이 초안을 감싼다(2026-10-16) — 버전과 서로를 가리키므로 먼저 푼다
  await pool.query('UPDATE spec_version SET change_request_id = NULL');
  await pool.query('DELETE FROM change_request');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('TRUNCATE event');
});

async function payloadOf(type: string, subjectId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM event WHERE type = $1 AND subject_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
    [type, subjectId],
  );
  return rows[0]?.payload ?? {};
}

/** 사람이 화면에서 정책을 고친다(EP-PRJ-04) */
async function setPolicy(policy: Record<string, unknown>): Promise<void> {
  await app.get(AuthService).updateProject({
    projectId,
    roles: ['admin'],
    actor: { userId: admin, isAgent: false },
    gatePolicy: policy,
  });
}

/** 요구사항 둘을 더하는 새 feature 문서 — 3점 + 첫 승인 버전 = T2(사람 결재) */
async function draftT2(key: string): Promise<string> {
  const draft = await app.get(SpecService).draftUpsert({
    roles: ['admin'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: [
      `# ${key}`,
      '',
      'REQ-FPR-001 WHEN 사용자가 저장하면 THE SYSTEM SHALL 문서를 남긴다',
      'REQ-FPR-002 WHEN 문서가 없으면 THE SYSTEM SHALL 빈 상태를 보인다',
    ].join('\n'),
    userId: admin,
  });
  return draft['spec_version_id'] as string;
}

/** 요구사항 없는 design 문서 — 1점 + 첫 승인 버전 = T1(자동 통과) */
async function draftT1(key: string): Promise<string> {
  const draft = await app.get(SpecService).draftUpsert({
    roles: ['admin'],
    projectId,
    key,
    title: key,
    type: 'design',
    bodyMd: `# ${key}\n\n화면 설명`,
    userId: admin,
  });
  return draft['spec_version_id'] as string;
}

const submit = (specVersionId: string) =>
  app.get(SpecService).submitReview({ projectId, specVersionId, userId: admin, roles: ['admin'] });

describe('스펙 판정 — 제출 · 승인 이벤트의 지문 (REQ-API-303)', () => {
  it('자동 통과는 제출과 승인이 같은 지문을 남긴다 — 고치지 않은 프로젝트는 기본 정책의 것이다', async () => {
    const versionId = await draftT1('SPC-FP-T1');
    const result = await submit(versionId);
    expect(result.status).toBe('approved');
    // 응답은 그대로다 — 지문은 감사 기록의 것이고 에이전트가 읽을 계약이 아니다
    expect(result.gate).not.toHaveProperty('policyFingerprint');

    const submitted = await payloadOf(NERV_EVENT.SPEC_SUBMITTED, versionId);
    expect(submitted).toMatchObject({
      gate_tier: 'T1',
      policy_fingerprint: DEFAULT,
      gate_inputs: {
        spec_type: 'design',
        requirements_added: 0,
        referencing_specs: 0,
        derived_tasks: 0,
        first_approved_version: true,
      },
    });
    expect(submitted).not.toHaveProperty('policy_fallback');
    expect(await payloadOf(NERV_EVENT.SPEC_APPROVED, versionId)).toEqual({
      gate_tier: 'T1',
      auto_passed: true,
      policy_fingerprint: DEFAULT,
    });
  });

  it('사람 결재로 승인하면 제출 때의 지문을 그대로 기록한다 — 그 사이에 정책을 고쳐도 승인 기록은 판정 때의 정책이다', async () => {
    const versionId = await draftT2('SPC-FP-T2');
    const result = await submit(versionId);
    expect(result.status).toBe('in_review');
    expect(await payloadOf(NERV_EVENT.SPEC_SUBMITTED, versionId)).toMatchObject({
      gate_tier: 'T2',
      policy_fingerprint: DEFAULT,
    });
    // 결재 요청도 같은 모양이다 — 카드가 읽는 칸은 그대로다
    expect(await payloadOf(NERV_EVENT.APPROVAL_REQUESTED, result.approval_id!)).toMatchObject({
      gate_tier: 'T2',
      policy_fingerprint: DEFAULT,
    });

    await setPolicy({ spec_gate: { tier_boundaries: [3, 5, 7] } });
    await app.get(ApprovalService).decide({
      actor: { userId: reviewer, isAgent: false },
      projectId,
      approvalId: result.approval_id!,
      userId: reviewer,
      decision: 'approve',
    });
    expect(await payloadOf(NERV_EVENT.SPEC_APPROVED, versionId)).toEqual({
      gate_tier: 'T2',
      auto_passed: false,
      policy_fingerprint: DEFAULT,
    });
  });

  it('정책을 고치면 감사가 바뀐 뒤의 유효 정책 본문과 지문을 남기고, 다음 판정은 그 지문을 쓴다', async () => {
    await setPolicy({ spec_gate: { dynamic_escalation: false } });
    const changed = policyFingerprint(
      effectiveGatePolicy({ spec_gate: { dynamic_escalation: false } }).policy,
    );
    expect(changed).not.toBe(DEFAULT);

    const audit = await payloadOf(NERV_EVENT.PROJECT_UPDATED, projectId);
    expect(audit).toMatchObject({
      fields: ['gate_policy'],
      policy_fingerprint: changed,
      policy_fingerprint_before: DEFAULT,
    });
    // 본문은 기본값까지 채운 유효 정책이다 — 이 본문의 지문이 곧 판정 이벤트의 지문이다
    const body = audit['gate_policy'] as Record<string, unknown>;
    expect(body).toMatchObject({
      version: 1,
      spec_gate: { tier_boundaries: [2, 4, 6], dynamic_escalation: false },
      done_gate: { evidence_source: 'any', review_coverage: false },
    });
    expect(policyFingerprint(effectiveGatePolicy(body).policy)).toBe(changed);

    // 동적 강화를 끈 정책 — 첫 승인 버전이 티어를 올리지 않는다. 판정에 넣은 값은 그대로 남는다
    const versionId = await draftT2('SPC-FP-OFF');
    expect((await submit(versionId)).gate.tier).toBe('T1');
    expect(await payloadOf(NERV_EVENT.SPEC_SUBMITTED, versionId)).toMatchObject({
      gate_tier: 'T1',
      gate_signals: [],
      policy_fingerprint: changed,
      gate_inputs: { requirements_added: 2, first_approved_version: true },
    });
    expect(await payloadOf(NERV_EVENT.SPEC_APPROVED, versionId)).toMatchObject({
      policy_fingerprint: changed,
    });
  });

  it('정책이 깨져 기본값으로 판정하면 지문도 기본 정책의 것이고 그 사실을 남긴다 (REQ-API-240)', async () => {
    await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({ spec_gate: { tier_boundries: [9, 9, 9] } }),
      projectId,
    ]);
    const versionId = await draftT2('SPC-FP-BROKEN');
    await submit(versionId);
    expect(await payloadOf(NERV_EVENT.SPEC_SUBMITTED, versionId)).toMatchObject({
      gate_tier: 'T2',
      policy_fingerprint: DEFAULT,
      policy_fallback: true,
    });
  });
});

describe('done 판정 — task.done 의 지문 · 조건별 결과 · 면제 (REQ-API-303)', () => {
  async function readyToClose(key: string): Promise<string> {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
      [taskId, projectId, key],
    );
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'user_guide','docs/guide.md','human')`,
      [newId(), projectId, taskId],
    );
    return taskId;
  }
  const close = (taskId: string) =>
    app.get(TaskService).transition({
      projectId,
      taskId,
      status: 'done',
      userId: admin,
      roles: ['admin'],
      specImpact: { none: true },
    });

  it('기본 정책 — 스펙 영향과 증적 두 조건을 통과했고 면제는 쓰지 않았다. 응답은 그대로다', async () => {
    const taskId = await readyToClose('CLV-T-FPDEF1');
    const result = await close(taskId);
    expect(result.gate).toEqual({ ok: true, missing: [], uncoveredKinds: [] });
    expect(await payloadOf(NERV_EVENT.TASK_DONE, taskId)).toEqual({
      policy_fingerprint: DEFAULT,
      done_gate: {
        conditions: [
          { condition: 'spec_impact', result: 'passed' },
          { condition: 'evidence', result: 'passed' },
        ],
        waiver_used: false,
      },
    });
  });

  it('리뷰 조건을 켠 정책 — 면제로 넘긴 종류는 면제로 남고 지문은 고친 정책의 것이다', async () => {
    const policy = { done_gate: { review_coverage: ['code', 'consistency'] } };
    await setPolicy(policy);
    const taskId = await readyToClose('CLV-T-FPWV01');
    // 코드를 내지 않은 작업 — 사람이 두 종류를 사유와 함께 면제한다
    await app.get(ApprovalService).bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: taskId,
      userId: admin,
      reason: '문서만 고친 작업이라 받을 리뷰가 없다',
      actor: { userId: admin, isAgent: false },
      kinds: ['code', 'consistency'],
      roles: ['admin'],
    });
    await close(taskId);
    expect(await payloadOf(NERV_EVENT.TASK_DONE, taskId)).toEqual({
      policy_fingerprint: policyFingerprint(effectiveGatePolicy(policy).policy),
      done_gate: {
        conditions: [
          { condition: 'spec_impact', result: 'passed' },
          { condition: 'evidence', result: 'passed' },
          { condition: 'review_kind', kind: 'code', result: 'waived' },
          { condition: 'review_kind', kind: 'consistency', result: 'waived' },
        ],
        waiver_used: true,
      },
    });
  });

  it('범위 없는 면제는 리뷰 조건을 통째로 넘긴다 — 종류 무관 조건이 면제로 남는다', async () => {
    await setPolicy({ done_gate: { review_coverage: true } });
    const taskId = await readyToClose('CLV-T-FPWV02');
    await app.get(ApprovalService).bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: taskId,
      userId: admin,
      reason: '리뷰 서버가 멈춰 사람이 직접 확인했다',
      actor: { userId: admin, isAgent: false },
      roles: ['admin'],
    });
    await close(taskId);
    expect(await payloadOf(NERV_EVENT.TASK_DONE, taskId)).toMatchObject({
      done_gate: {
        conditions: [
          { condition: 'spec_impact', result: 'passed' },
          { condition: 'evidence', result: 'passed' },
          { condition: 'review_coverage', result: 'waived' },
        ],
        waiver_used: true,
      },
    });
  });

  it('정책이 깨져 기본값으로 판정하면 done 도 기본 정책의 지문과 그 사실을 남긴다', async () => {
    await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({ done_gate: { review_coverage: 'code' } }),
      projectId,
    ]);
    const taskId = await readyToClose('CLV-T-FPBRK1');
    await close(taskId);
    expect(await payloadOf(NERV_EVENT.TASK_DONE, taskId)).toMatchObject({
      policy_fingerprint: DEFAULT,
      policy_fallback: true,
      done_gate: { waiver_used: false },
    });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  admin = newId();
  reviewer = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [admin, 'admin@example.com', '관리자'],
    [reviewer, 'reviewer@example.com', '검토자'],
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
  for (const [user, role] of [
    [admin, 'admin'],
    [reviewer, 'planner'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5::member_role)`,
      [newId(), orgId, projectId, user, role],
    );
  }
}
