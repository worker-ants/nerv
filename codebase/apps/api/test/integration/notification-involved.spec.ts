// 알림 관여 라우팅 — 작성자 · 담당자 · 스레드 참여자 · 리뷰 요청자 (2026-10-15 · Phase 2 E17-S01 · REQ-API-316)
//
// 카탈로그(spec-workflow §6.3)가 수신자로 적은 사람을 산출한다. 역할 큐로 가던 이벤트는 역할 큐가 그대로 받고 관여자를
// 더한다(겹치면 한 번). 발견 이벤트(`finding.opened` — critical 만 · `finding.resolved`)는 관여자에게만 간다. 행위자와
// 프로젝트 멤버가 아닌 사람은 받지 않는다.

import { NERV_EVENT, NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import type { SubmitResult } from '../../src/modules/review/review.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let reviews: ReviewService;
let notifications: NotificationService;
let orgId: string;
let projectId: string;
let specId: string;

/** 사람들 — 역할 큐(admin · planner)와 관여자가 겹치는지를 보려고 역할을 나눴다 */
const U = {
  admin: newId(),
  planner: newId(),
  /** 작업 담당자 */
  dev: newId(),
  /** 스펙 버전 작성자 */
  writer: newId(),
  /** 리뷰를 제출한 사람(리뷰 요청자) */
  reviewer: newId(),
  /** 다른 코멘트 스레드의 사람 */
  bystander: newId(),
  /** 프로젝트 멤버가 아니다 */
  outsider: newId(),
};
let reviewerSession: string;
let devSession: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_notification_involved');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  reviews = app.get(ReviewService);
  // 방송 없이 파생만 — 알림 행이 진실이다(D-14)
  notifications = new NotificationService(drizzle(pool));
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  await pool.query('DELETE FROM resolution');
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM spec_comment');
});

/** 사람마다 받은 알림 — 등급 · 상태 · 묶음 수 */
async function inboxOf(
  userId: string,
): Promise<{ type: string; importance: string; state: string; batch: number }[]> {
  const { rows } = await pool.query(
    `SELECT e.type, n.importance::text AS importance, n.state::text AS state, n.batch_size AS batch
       FROM notification n JOIN event e ON e.id = n.event_id
      WHERE n.user_id = $1 ORDER BY n.created_at`,
    [userId],
  );
  return rows as { type: string; importance: string; state: string; batch: number }[];
}

/** 이 이벤트 종류의 알림을 받은 사람들 */
async function recipientsOf(type: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT n.user_id FROM notification n JOIN event e ON e.id = n.event_id
      WHERE e.type = $1 ORDER BY n.user_id`,
    [type],
  );
  return rows.map((r) => r.user_id);
}

const sorted = (ids: string[]): string[] => [...ids].sort();

/** 스펙 버전 하나 — 작성자를 고른다 */
async function version(author: string, no: number): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,$3,'approved','# 본문', sha256($4::bytea), $5)`,
    [id, specId, no, `v-${id}`, author],
  );
  return id;
}

async function task(key: string, assignee: string | null): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, assignee_user_id,
                       goal_md, output_format_md, tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,'작업','in_progress',$4,'목표','PR','도구','경계')`,
    [id, projectId, key, assignee],
  );
  return id;
}

async function emitEvent(
  type: string,
  subjectType: string,
  subjectId: string,
  actor: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
     VALUES ($1,$2,now(),$3,$4,false,$5,$6)`,
    [newId(), projectId, type, actor, subjectType, subjectId],
  );
}

async function submit(over: {
  taskId: string;
  headSha?: string;
  findings: Record<string, unknown>[];
  changeset?: string[];
}): Promise<SubmitResult> {
  return reviews.submit({
    projectId,
    userId: U.reviewer,
    sessionId: reviewerSession,
    isAgent: true,
    branch: 'feat/notify',
    baseSha: 'ba5e0000',
    headSha: over.headSha ?? 'a1b2c3d4',
    kind: 'code',
    changeset: over.changeset ?? ['src/widget.ts'],
    summaryMd: '봤다.',
    reviewer: { role: 'security', risk: 'high' },
    taskId: over.taskId,
    findings: over.findings as never,
  } as Parameters<ReviewService['submit']>[0]);
}

const finding = (
  severity: string,
  title: string,
  specVersionId?: string,
): Record<string, unknown> => ({
  severity,
  title,
  body_md: `${title} — 본문`,
  file: 'src/widget.ts',
  line: 1,
  category: 'security',
  ...(specVersionId === undefined ? {} : { spec_version_id: specVersionId }),
});

describe('발견 알림 — 작업 담당자 · 리뷰 요청자 · 스펙 작성자 (REQ-API-316)', () => {
  it('critical 발견이 열리면 작업 담당자와 스펙 작성자가 중요 알림을 받는다 — 제출한 사람과 역할 큐는 받지 않는다', async () => {
    const taskId = await task('CLV-T-NTFY01', U.dev);
    const v = await version(U.writer, 1);
    await submit({
      taskId,
      findings: [
        finding('critical', '토큰이 로그에 남는다', v),
        finding('warning', '재시도에 상한이 없다'),
      ],
    });
    await notifications.route();

    expect(sorted(await recipientsOf(NERV_EVENT_PHASE2.FINDING_OPENED))).toEqual(
      sorted([U.dev, U.writer]),
    );
    expect(await inboxOf(U.dev)).toEqual([
      {
        type: NERV_EVENT_PHASE2.FINDING_OPENED,
        importance: 'immediate',
        state: 'unread',
        batch: 1,
      },
    ]);
    // warning 발견은 알림을 만들지 않는다 — 카탈로그는 critical 만 적는다
    expect(await inboxOf(U.writer)).toHaveLength(1);
    for (const nobody of [U.reviewer, U.admin, U.planner])
      expect(await inboxOf(nobody)).toEqual([]);
  });

  it('행위자 자신은 받지 않는다 — 담당자가 직접 리뷰를 제출하면 담당자에게는 가지 않는다', async () => {
    const taskId = await task('CLV-T-NTFY02', U.reviewer);
    await submit({ taskId, findings: [finding('critical', '권한을 보지 않는다')] });
    await notifications.route();
    expect(await recipientsOf(NERV_EVENT_PHASE2.FINDING_OPENED)).toEqual([]);
  });

  it('파생보다 처분이 먼저면 열림 알림은 읽은 채로 남는다', async () => {
    const taskId = await task('CLV-T-NTFY03', U.dev);
    const out = await submit({ taskId, findings: [finding('critical', '이미 고친 결함')] });
    await reviews.resolve({
      projectId,
      findingId: out.findings_new[0]!,
      userId: U.dev,
      sessionId: devSession,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '고쳤다',
      commitSha: 'c0ffee1',
    });
    await notifications.route();
    // 기록은 남고 배지에는 들지 않는다 — 처분한 사람(담당자)에게 처분 알림은 가지 않는다
    expect(await inboxOf(U.dev)).toEqual([
      {
        type: NERV_EVENT_PHASE2.FINDING_OPENED,
        importance: 'immediate',
        state: 'read',
        batch: 1,
      },
    ]);
  });

  it('발견이 처분되면 리뷰 요청자 · 작업 담당자 · 스펙 작성자가 보통 알림을 받고, 같은 라운드의 처분은 한 줄로 묶인다', async () => {
    const taskId = await task('CLV-T-NTFY04', U.dev);
    const v = await version(U.writer, 2);
    const out = await submit({
      taskId,
      findings: [
        finding('critical', '경계값이 빠졌다', v),
        finding('warning', '이름이 모호하다', v),
      ],
    });
    await notifications.route();
    await pool.query('DELETE FROM notification_batch_event');
    await pool.query('DELETE FROM notification');
    for (const findingId of out.findings_new) {
      await reviews.resolve({
        projectId,
        findingId,
        userId: U.dev,
        sessionId: devSession,
        isAgent: true,
        kind: 'fixed',
        status: 'fixed',
        rationale: '고쳤다',
        commitSha: 'c0ffee2',
      });
    }
    await notifications.route();

    // 처분한 사람(담당자)은 빠지고 리뷰 요청자 · 스펙 작성자가 받는다 — 역할 큐는 받지 않는다
    expect(await inboxOf(U.reviewer)).toEqual([
      { type: NERV_EVENT_PHASE2.FINDING_RESOLVED, importance: 'digest', state: 'unread', batch: 2 },
    ]);
    expect(await inboxOf(U.writer)).toEqual([
      { type: NERV_EVENT_PHASE2.FINDING_RESOLVED, importance: 'digest', state: 'unread', batch: 2 },
    ]);
    for (const nobody of [U.dev, U.admin, U.planner]) expect(await inboxOf(nobody)).toEqual([]);
  });
});

describe('역할 큐에 관여자를 더한다 (REQ-API-316)', () => {
  it('스펙 승인은 역할 큐와 그 버전의 작성자에게 간다 — 겹치면 한 번이고 행위자는 빠진다', async () => {
    const byWriter = await version(U.writer, 3);
    await emitEvent(NERV_EVENT.SPEC_APPROVED, 'spec_version', byWriter, U.admin);
    const byPlanner = await version(U.planner, 4);
    await emitEvent(NERV_EVENT.SPEC_REJECTED, 'spec_version', byPlanner, U.admin);
    await notifications.route();

    expect(sorted(await recipientsOf(NERV_EVENT.SPEC_APPROVED))).toEqual(
      sorted([U.planner, U.writer]),
    );
    // 작성자가 역할 큐에도 있으면 한 줄이다
    expect(await recipientsOf(NERV_EVENT.SPEC_REJECTED)).toEqual([U.planner]);
    expect(await inboxOf(U.admin)).toEqual([]);
  });

  it('프로젝트 멤버가 아닌 작성자에게는 보내지 않는다', async () => {
    const byOutsider = await version(U.outsider, 5);
    await emitEvent(NERV_EVENT.SPEC_APPROVED, 'spec_version', byOutsider, U.admin);
    await notifications.route();
    expect(await recipientsOf(NERV_EVENT.SPEC_APPROVED)).toEqual([U.planner]);
  });

  it('막힌 작업은 담당자에게, 재브리핑은 담당자와 클레임한 세션의 사람에게 간다', async () => {
    const blocked = await task('CLV-T-NTFY05', U.dev);
    await emitEvent(NERV_EVENT.TASK_BLOCKED, 'task', blocked, U.admin);
    const rebrief = await task('CLV-T-NTFY06', U.writer);
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, rebrief, devSession, U.dev],
    );
    await emitEvent(NERV_EVENT.TASK_REBRIEF_REQUIRED, 'task', rebrief, U.admin);
    await notifications.route();

    expect(sorted(await recipientsOf(NERV_EVENT.TASK_BLOCKED))).toEqual(sorted([U.planner, U.dev]));
    expect(sorted(await recipientsOf(NERV_EVENT.TASK_REBRIEF_REQUIRED))).toEqual(
      sorted([U.planner, U.writer, U.dev]),
    );
  });

  it('코멘트는 같은 앵커의 열린 코멘트를 쓴 사람에게 간다 — 다른 앵커 · 처분된 코멘트의 사람은 받지 않는다', async () => {
    const v = await version(U.writer, 6);
    const comments = app.get(SpecCommentService);
    await comments.add({
      projectId,
      specVersionId: v,
      anchor: 'REQ-NTF-001',
      bodyMd: '경계가 모호하다',
      userId: U.dev,
    });
    await comments.add({
      projectId,
      specVersionId: v,
      anchor: 'REQ-NTF-002',
      bodyMd: '다른 줄',
      userId: U.bystander,
    });
    const resolved = await comments.add({
      projectId,
      specVersionId: v,
      anchor: 'REQ-NTF-001',
      bodyMd: '이미 반영된 지적',
      userId: U.outsider,
    });
    await pool.query(`UPDATE spec_comment SET status = 'resolved' WHERE id = $1`, [
      resolved.comment_id,
    ]);
    // 지금까지의 알림은 지우고 마지막 코멘트만 본다
    await notifications.route();
    await pool.query('DELETE FROM notification_batch_event');
    await pool.query('DELETE FROM notification');
    await pool.query('TRUNCATE event');

    await comments.add({
      projectId,
      specVersionId: v,
      anchor: 'REQ-NTF-001',
      bodyMd: '동의한다',
      userId: U.reviewer,
    });
    await notifications.route();
    // 역할 큐(admin · planner) + 같은 앵커의 열린 코멘트를 쓴 사람(dev) — 작성자(reviewer) · 다른 앵커(bystander) ·
    // 처분된 코멘트(outsider — 멤버도 아니다)는 받지 않는다
    expect(sorted(await recipientsOf(NERV_EVENT.SPEC_COMMENT_ADDED))).toEqual(
      sorted([U.admin, U.planner, U.dev]),
    );
  });

  it('리뷰 결정 「코멘트」는 그 버전의 작성자에게 간다', async () => {
    const v = await version(U.writer, 7);
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id, payload)
       VALUES ($1,$2,now(),$3,$4,false,'spec_version',$5,'{"comment":"3장을 다시 써 주세요"}'::jsonb)`,
      [newId(), projectId, NERV_EVENT.SPEC_COMMENT_ADDED, U.planner, v],
    );
    await notifications.route();
    expect(sorted(await recipientsOf(NERV_EVENT.SPEC_COMMENT_ADDED))).toEqual(
      sorted([U.admin, U.writer]),
    );
  });
});

/**
 * **배포 직후 — 새 워커는 지난 이벤트에 새 규칙을 소급하지 않는다**(2026-10-15 · REQ-API-317).
 *
 * 워커의 물마루는 메모리에 있어 재기동하면 빈다. 예전에는 그때 알림이 없는 이벤트를 처음부터 훑어서, 위의 관여 라우팅이
 * 들어온 배포 뒤 첫 실행에 지난 발견 이벤트 전부가 알림이 됐다. 이제 새 워커는 최근 한 시간의 이벤트만 다시 본다.
 */
describe('새 워커의 첫 파생 (REQ-API-317)', () => {
  /** critical 발견 둘을 열고 그 열림 이벤트를 지운다 — 시각을 골라 다시 넣으려고(이벤트는 append-only 라 고칠 수 없다) */
  async function openFindings(n: number): Promise<readonly string[]> {
    const taskId = await task(`CLV-T-RSM${String(n).padStart(3, '0')}`, U.dev);
    const out = await submit({
      taskId,
      // 제목이 달라야 다른 발견이다 — 지문은 제목의 숫자를 지워 같은 지적의 변형을 하나로 접는다
      findings: ['토큰이 로그에 남는다', '권한을 보지 않는다', '입력을 검증하지 않는다']
        .slice(0, n)
        .map((title) => finding('critical', title)),
    });
    await pool.query('TRUNCATE event');
    expect(out.findings_new).toHaveLength(n);
    return out.findings_new;
  }

  /** 발견 열림 이벤트를 `ago` 만큼 지난 시각으로 넣는다 */
  async function opened(findingId: string, ago: string): Promise<string> {
    const id = newId();
    await pool.query(`SELECT nerv_ensure_month_partitions((now() - $1::interval)::date)`, [ago]);
    await pool.query(
      `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, actor_session_id, is_agent,
                          subject_type, subject_id)
       VALUES ($1,$2, now() - $3::interval, $4, $5, $6, true, 'finding', $7)`,
      [
        id,
        projectId,
        ago,
        NERV_EVENT_PHASE2.FINDING_OPENED,
        U.reviewer,
        reviewerSession,
        findingId,
      ],
    );
    return id;
  }

  /** 이 이벤트들 가운데 알림이 된 것 */
  async function notified(eventIds: string[]): Promise<string[]> {
    const { rows } = await pool.query<{ event_id: string }>(
      `SELECT DISTINCT event_id FROM notification WHERE event_id = ANY($1::uuid[])`,
      [eventIds],
    );
    return rows.map((r) => r.event_id);
  }

  it('지난 발견 이벤트는 알림이 되지 않고 재기동 직전 몇 분의 놓친 이벤트는 파생된다', async () => {
    const [old, recent] = await openFindings(2);
    const before = await opened(old!, '3 days');
    const missed = await opened(recent!, '5 minutes');

    // 배포한 뒤 새로 뜬 워커 — 물마루가 없다
    await new NotificationService(drizzle(pool)).route();
    expect(await notified([before, missed])).toEqual([missed]);
    expect(await inboxOf(U.dev)).toHaveLength(1);
  });

  it('한 시간 창 안에서 이미 알림이 된 이벤트는 다시 만들지 않는다 — 다시 훑어도 한 이벤트 · 한 사람 · 한 행이다', async () => {
    const [done, missed] = await openFindings(2);
    const before = await opened(done!, '20 minutes');
    // 옛 워커가 이미 파생했다
    await notifications.route({ since: new Date(Date.now() - 30 * 60_000) });
    expect(await notified([before])).toEqual([before]);
    const after = await opened(missed!, '5 minutes');

    await new NotificationService(drizzle(pool)).route();
    expect(sorted(await notified([before, after]))).toEqual(sorted([before, after]));
    expect(await inboxOf(U.dev)).toHaveLength(2);
  });

  it('물마루가 있는 워커는 그대로 잇는다 — 한 시간 창은 새로 뜬 워커의 첫 실행에만 쓴다', async () => {
    const worker = new NotificationService(drizzle(pool));
    await worker.route();
    const [first] = await openFindings(1);
    const live = await opened(first!, '0 seconds');
    await worker.route();
    expect(await notified([live])).toEqual([live]);
  });
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  specId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [key, id] of Object.entries(U)) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${key}@example.com`, key],
    );
  }
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [id, role] of [
    [U.admin, 'admin'],
    [U.planner, 'planner'],
    [U.dev, 'developer'],
    [U.writer, 'designer'],
    [U.reviewer, 'developer'],
    [U.bystander, 'qa'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), orgId, projectId, id, role],
    );
  }
  reviewerSession = newId();
  devSession = newId();
  for (const [id, user, host] of [
    [reviewerSession, U.reviewer, 'mac-07'],
    [devSession, U.dev, 'mac-02'],
  ] as const) {
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code',$4,'active')`,
      [id, projectId, user, host],
    );
  }
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-NTF','알림')`,
    [specId, projectId],
  );
}
