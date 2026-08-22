// REST 표면 전량 — 프로젝트·멤버·토큰 · Task · 세션 steer · 승인함 · 커버리지 · 알림
//
// 실제 HTTP 로 돈다. 서비스 단위 테스트가 이미 판정을 지키고 있으므로 여기서 확인할 것은
// **번역**이다(REQ-CB-003): 경로·역할 가드·에러 코드가 화면이 기대하는 모양으로 나오는가.
// 화면(E08)이 이 계약 위에 올라가므로, 여기가 어긋나면 화면은 조용히 빈 상태를 렌더한다.

import { NERV_ERROR, newId, runMigrations } from '@nerv/schema';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let adminToken: string;
let viewerToken: string;
let projectId: string;
let orgId: string;
let adminId: string;
let viewerId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_rest');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = app.get(AuthService);
  adminToken = (
    await auth.issueToken({
      projectId,
      userId: adminId,
      name: 'admin-pat',
      scopes: ['spec:read', 'spec:draft', 'task:claim', 'task:update'],
    })
  ).token;
  viewerToken = (
    await auth.issueToken({
      projectId,
      userId: viewerId,
      name: 'viewer-pat',
      scopes: ['spec:read'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM activity');
  await pool.query('DELETE FROM task_dependency');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM event');
});

interface Res {
  status: number;
  body: Record<string, unknown> | Record<string, unknown>[];
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: { token?: string; payload?: unknown } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  headers['authorization'] = `Bearer ${options.token ?? adminToken}`;
  const res = await app.inject({
    method,
    url,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
  return {
    status: res.statusCode,
    body: res.body === '' ? {} : (res.json() as Record<string, unknown>),
  };
}

describe('테넌시 표면 (EP-AUTH-01 · EP-ORG-01 · EP-PRJ-01·03)', () => {
  it('me 는 프로필과 멤버십·역할을 함께 준다 — 셸의 첫 질문에 한 번에 답한다', async () => {
    const res = await call('GET', '/api/v1/me');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['email']).toBe('admin@example.com');
    expect((body['memberships'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('프로젝트 목록에 활성 세션·승인 대기 카운트가 실린다 (S1 카드의 데이터 소스)', async () => {
    const res = await call('GET', '/api/v1/orgs/nerv/projects');
    const items = res.body as Record<string, unknown>[];
    expect(items[0]?.['slug']).toBe('clemvion');
    expect(items[0]).toHaveProperty('active_sessions');
    expect(items[0]).toHaveProperty('pending_approvals');
  });

  it('프로젝트 상세는 게이트 정책을 싣는다 (S8 게이트 탭)', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion');
    expect(res.status).toBe(200);
    expect(res.body as Record<string, unknown>).toHaveProperty('gate_policy');
  });

  it('게이트 정책 편집은 admin 만 — API 와 UI 양쪽에서 막는다는 규칙의 API 쪽 절반', async () => {
    const denied = await call('PATCH', '/api/v1/projects/clemvion', {
      token: viewerToken,
      payload: { gate_policy: { spec_change: 'T3' } },
    });
    expect(denied.status).toBe(403);
    expect((denied.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.FORBIDDEN);

    const allowed = await call('PATCH', '/api/v1/projects/clemvion', {
      payload: { gate_policy: { spec_change: 'T3' } },
    });
    expect(allowed.status).toBe(200);
    expect((allowed.body as Record<string, unknown>)['gate_policy']).toEqual({ spec_change: 'T3' });
  });

  it('토큰 목록에 원문이 없다 — 발급 응답에서 한 번 보여준 뒤로는 어디에도 남지 않는다', async () => {
    const res = await call('GET', '/api/v1/me/tokens');
    const tokens = res.body as Record<string, unknown>[];
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(Object.keys(token)).not.toContain('token');
      expect(Object.keys(token)).not.toContain('token_hash');
      expect(token['prefix']).toMatch(/^nerv_/);
    }
  });

  it('PAT 로는 PAT 를 발급할 수 없다 — 스코프 상속의 사슬은 사람에서 시작한다 (D-08)', async () => {
    const res = await call('POST', '/api/v1/me/tokens', {
      payload: { project: 'clemvion', name: 'child', scopes: ['spec:read'] },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
  });
});

describe('Task 표면 (EP-TASK-01·03·04·05·09)', () => {
  it('생성은 언제나 backlog 이고, 4요소가 차면 서버가 ready 로 승격한다 (FR-05)', async () => {
    const created = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '위젯 임베드', priority: 'P1' },
    });
    expect(created.status).toBe(201);
    const key = (created.body as Record<string, unknown>)['key'] as string;
    expect((created.body as Record<string, unknown>)['status']).toBe('backlog');

    // 3요소만 — 아직 ready 가 아니다
    const partial = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: { goal_md: '목표', output_format_md: 'PR', tools_sources_md: '도구' },
    });
    expect((partial.body as Record<string, unknown>)['status']).toBe('backlog');

    const complete = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: { boundaries_md: '경계' },
    });
    expect((complete.body as Record<string, unknown>)['status']).toBe('ready');
  });

  it('의존이 남아 있으면 4요소가 차도 ready 가 아니다', async () => {
    const blocker = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '선행' },
    });
    const blocked = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: {
        title: '후행',
        goal_md: '목표',
        output_format_md: 'PR',
        tools_sources_md: '도구',
        boundaries_md: '경계',
      },
    });
    const key = (blocked.body as Record<string, unknown>)['key'] as string;
    const res = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: { depends_on: [(blocker.body as Record<string, unknown>)['key']] },
    });
    expect((res.body as Record<string, unknown>)['status']).toBe('backlog');
  });

  it('보드 목록은 위임 명세 완결 여부를 행마다 표시한다 (S4 칼럼)', async () => {
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '미완' } });
    const res = await call('GET', '/api/v1/projects/clemvion/tasks?status=backlog');
    const items = res.body as Record<string, unknown>[];
    expect(items[0]?.['delegation_complete']).toBe(false);
  });

  it('done 전이는 게이트를 통과해야 한다 — REST 도 같은 판정을 쓴다 (D-05)', async () => {
    const created = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: {
        title: '완료 대상',
        goal_md: '목표',
        output_format_md: 'PR',
        tools_sources_md: '도구',
        boundaries_md: '경계',
      },
    });
    const taskId = (created.body as Record<string, unknown>)['task_id'] as string;

    const denied = await call('POST', `/api/v1/projects/clemvion/tasks/${taskId}/transition`, {
      payload: { status: 'done' },
    });
    expect(denied.status).toBe(409);
    expect((denied.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'done_gate',
    });

    const ok = await call('POST', `/api/v1/projects/clemvion/tasks/${taskId}/transition`, {
      payload: {
        status: 'done',
        spec_impact: { none: true },
        evidence: [{ kind: 'pr', locator: 'https://pr/1' }],
      },
    });
    expect(ok.status).toBe(201);
    expect((ok.body as Record<string, unknown>)['status']).toBe('done');
  });
});

describe('세션 steer (EP-SES-04)', () => {
  it('stop 은 전달을 기다리지 않고 즉시 클레임을 회수한다', async () => {
    const sessionId = newId();
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
      [taskId, projectId, `TSK-${taskId.slice(0, 4)}`],
    );
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state, external_session_id)
       VALUES ($1,$2,$3,'claude-code','mac-07','active','S-b7e9')`,
      [sessionId, projectId, adminId],
    );
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, sessionId, adminId],
    );

    const res = await call('POST', `/api/v1/projects/clemvion/sessions/${sessionId}/steer`, {
      payload: { kind: 'stop', message: '중단하세요' },
    });
    // PAT 는 사람이 아니다 — steer 는 사람 전용이라 여기서 막힌다
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);

    // 서비스 경로로 사람이 눌렀을 때의 결과를 확인한다
    const { SessionService } = await import('../../src/modules/session/session.service.js');
    const stopped = await app
      .get(SessionService)
      .steer({ projectId, sessionId, kind: 'stop', message: '중단', userId: adminId });
    expect(stopped.reclaimed).toBe(1);

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]?.status).toBe('ready');
  });

  it('타임라인은 seq 순이고 사람의 개입이 같은 줄에 섞인다', async () => {
    const sessionId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'codex','linux-ci-01','active')`,
      [sessionId, projectId, adminId],
    );
    const { SessionService } = await import('../../src/modules/session/session.service.js');
    const sessions = app.get(SessionService);
    await sessions.appendActivity({
      sessionId,
      projectId,
      seq: 1n,
      type: 'action',
      title: '파일 수정',
    });
    await sessions.steer({
      projectId,
      sessionId,
      kind: 'steer',
      message: '이쪽으로',
      userId: adminId,
    });

    const res = await call('GET', `/api/v1/projects/clemvion/sessions/${sessionId}/activities`);
    const items = res.body as Record<string, unknown>[];
    expect(items.map((i) => i['type'])).toEqual(['action', 'elicitation']);

    // 지시는 한 번만 전달된다 — 두 번 주면 에이전트가 같은 지시를 두 번 따른다
    expect(await sessions.takePendingInstructions(sessionId)).toHaveLength(1);
    expect(await sessions.takePendingInstructions(sessionId)).toHaveLength(0);
  });
});

describe('승인함·알림·커버리지 표면', () => {
  it('전역 승인함은 프로젝트를 가로지르고 대기 시간을 싣는다 (EP-APR-01)', async () => {
    const { ApprovalService } = await import('../../src/modules/approval/approval.service.js');
    const specVersionId = await seedSpecVersion();
    await app.get(ApprovalService).request({
      projectId,
      subjectType: 'spec_version',
      subjectId: specVersionId,
      requestedByUserId: viewerId,
      assigneeUserId: adminId,
    });

    // PAT 는 사람이 아니다 — 전역 승인함은 세션 쿠키(사람)만 본다(D-08 · auth-session.spec.ts)
    const denied = await call('GET', '/api/v1/approvals');
    expect(denied.status).toBe(403);

    const { ApprovalService: Service } =
      await import('../../src/modules/approval/approval.service.js');
    const items = await app.get(Service).inboxGlobal({ userId: adminId });
    expect(items).toHaveLength(1);
    expect(items[0]?.['project_slug']).toBe('clemvion');
    expect(items[0]).toHaveProperty('waiting_seconds');
    expect(items[0]?.['self_requested']).toBe(false);
  });

  it('커버리지는 빈 약속과 증적 결손을 센다 (clemvion R-5 의 자동 검출)', async () => {
    const specVersionId = await seedSpecVersion();
    const { rows } = await pool.query<{ spec_id: string }>(
      `SELECT spec_id FROM spec_version WHERE id = $1`,
      [specVersionId],
    );
    const specId = rows[0]?.spec_id ?? '';
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority, impl_status,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-COV-1','문장','must','unimplemented',$4,$4),
              ($5,$2,$3,'REQ-COV-2','문장','must','implemented',$4,$4)`,
      [newId(), projectId, specId, specVersionId, newId()],
    );

    const res = await call('GET', '/api/v1/projects/clemvion/coverage');
    const totals = (res.body as Record<string, unknown>)['totals'] as Record<string, number>;
    expect(totals['total']).toBe(2);
    expect(totals['empty_promises']).toBe(1); // 책임지는 Task 가 없는 미구현
    expect(totals['evidence_missing']).toBe(1); // implemented 인데 증적 없음
  });

  it('알림은 남의 것을 읽음 처리할 수 없다', async () => {
    const notificationId = newId();
    // 알림은 event 참조다 — 먼저 사건이 있어야 알림이 있다(D-10)
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '알림용' } });
    await pool.query(
      `INSERT INTO notification (id, user_id, project_id, event_id, importance, state)
       SELECT $1, $2, $3, e.id, 'immediate', 'unread' FROM event e WHERE e.project_id = $3 LIMIT 1`,
      [notificationId, viewerId, projectId],
    );
    await call('POST', `/api/v1/me/notifications/${notificationId}/read`);
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM notification WHERE id = $1`,
      [notificationId],
    );
    expect(rows[0]?.state).toBe('unread');
  });

  it('이벤트 피드는 사람/에이전트를 구분해 싣는다 (FR-16 · D-08)', async () => {
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '이벤트용' } });
    const res = await call('GET', '/api/v1/projects/clemvion/events');
    const items = res.body as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('is_agent');
    expect(items[0]).toHaveProperty('actor_name');
  });
});

async function seedSpecVersion(): Promise<string> {
  const specId = newId();
  const versionId = newId();
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,'스펙')
     ON CONFLICT DO NOTHING`,
    [specId, projectId, `SPC-${specId.slice(0, 4)}`],
  );
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,1,'in_review','# 본문', decode('00','hex'), $3)`,
    [versionId, specId, adminId],
  );
  return versionId;
}

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  adminId = newId();
  viewerId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES
       ($1,'admin@example.com','관리자','active'), ($2,'viewer@example.com','뷰어','active')`,
    [adminId, viewerId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
       ($1,$2,$3,$4,'admin'), ($5,$2,$3,$6,'viewer')`,
    [newId(), orgId, projectId, adminId, newId(), viewerId],
  );
}
