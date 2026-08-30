// E03 — MCP 게이트웨이 + PAT + P0 도구 8종.
//
//   WHEN Claude Code 또는 Codex 클라이언트가 접속하면,
//   THE SYSTEM SHALL resources·prompts·elicitation 없이 tools 만으로 카탈로그를 노출한다
//   WHEN 세션이 nerv_bootstrap 을 첫 도구 호출로 실행하면,
//   THE SYSTEM SHALL session_id·규약 요약·활성 클레임·게이트 정책을 반환한다
//   WHEN 같은 session_id 로 재호출하면, THE SYSTEM SHALL 동일 스냅샷을 반환한다(멱등)
//
// 실제 HTTP 로 돈다 — 가드 순서(Origin → 인증)·스코프 검사·구조화 에러가 배선된 상태로만
// 의미가 있기 때문이다. Phase 0 성공 기준 0-8(tools-only 완주)의 재현이기도 하다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let token: string;
let readOnlyToken: string;
let reviewToken: string;
let qaToken: string;
let qaUserId: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_mcp');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  // 앱은 DATABASE_URL 을 보고 커넥션을 만든다 — 이 스위트 전용 DB 를 가리킨다
  process.env['DATABASE_URL'] = db.url;
  // 실제 Valkey 를 쓴다 — 게이트웨이 경로를 있는 그대로 태우기 위해서다(compose 의 valkey).
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = app.get(AuthService);
  token = (
    await auth.issueToken({
      projectId,
      userId,
      name: 'e2e',
      // `spec:draft` 를 넣는 이유: 에이전트가 스펙을 쓰는 것이 이 표면의 절반이다
      scopes: ['spec:read', 'spec:draft', 'task:claim', 'task:update', 'agent-session:launch'],
    })
  ).token;
  readOnlyToken = (await auth.issueToken({ projectId, userId, name: 'ro', scopes: ['spec:read'] }))
    .token;
  // 리뷰 도구(P2)용. **`review:resolve` 는 일부러 넣지 않는다** — 이 세션의 주체는
  // developer 이고 그 역할에는 처분 권한이 없다(ROLE_SCOPES). 토큰이 역할보다 넓을 수
  // 없다는 것을 도구 경로에서도 보려는 것이다.
  reviewToken = (
    await auth.issueToken({
      projectId,
      userId,
      name: 'review',
      scopes: ['spec:read', 'review:submit', 'review:resolve'],
    })
  ).token;
  // 처분까지 가려면 역할이 그것을 허용해야 한다 — qa 가 리뷰의 주인이다(ROLE_SCOPES)
  qaToken = (
    await auth.issueToken({
      projectId,
      userId: qaUserId,
      name: 'qa',
      scopes: ['spec:read', 'review:submit', 'review:resolve'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  opts: { token?: string | null; revision?: string | null; lang?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const bearer = opts.token === undefined ? token : opts.token;
  if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`;
  const revision = opts.revision === undefined ? '2026-07-28' : opts.revision;
  if (revision !== null) headers['mcp-protocol-version'] = revision;
  if (opts.lang !== undefined) headers['accept-language'] = opts.lang;

  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers,
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  opts: { token?: string | null } = {},
): Promise<Record<string, unknown>> {
  const { body } = await rpc('tools/call', { name, arguments: args }, opts);
  const result = body['result'] as { structuredContent: Record<string, unknown> };
  return result.structuredContent;
}

describe('E03-S01 게이트웨이 — tools-first (성공 기준 0-8)', () => {
  it('initialize 가 tools 만 선언한다 — resources·prompts 는 없다', async () => {
    const { body } = await rpc('initialize');
    const result = body['result'] as Record<string, unknown>;
    expect(Object.keys(result['capabilities'] as object)).toEqual(['tools']);
    expect(result['serverInfo']).toMatchObject({ name: 'nerv' });
    // instructions 는 도구 검색 힌트다 — 2KB 에서 잘리므로 짧아야 한다
    expect(String(result['instructions']).length).toBeLessThan(2048);
  });

  it('tools/list 가 18종을 노출한다 — MVP 16(P0 8 + P1 8) + 리뷰 2(P2)', async () => {
    const { body } = await rpc('tools/list');
    const tools = (body['result'] as { tools: { name: string; inputSchema: unknown }[] }).tools;
    // **MVP 는 여전히 16종이다.** 카탈로그가 18인 것은 리뷰 수집(FR-09)이 Phase 2 에서
    // 들어왔기 때문이다(2026-08-23 — scope.md §5 착수 기록). 두 수를 섞지 않는다.
    expect(tools).toHaveLength(18);
    expect(tools.map((t) => t.name)).toContain('nerv_bootstrap');
    expect(tools.map((t) => t.name)).toContain('nerv_spec_relate');
    expect(tools.map((t) => t.name)).toContain('nerv_review_submit');
    expect(tools.map((t) => t.name)).toContain('nerv_finding_resolve');
    for (const tool of tools) expect(tool.inputSchema).toBeTruthy();
  });

  it('에이전트가 스펙을 **새로** 만든다 — 도구가 메타를 받아야 가능하다', async () => {
    // 도구 스키마에 key·title·type 이 없어 **새 스펙을 시작할 수 없었다**(실측 2026-08-23).
    // 이어쓰기만 되는 도구는 "스펙을 에이전트가 쓴다"의 절반이다.
    const { body } = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: {
        key: 'SPC-AGENT-NEW',
        title: '에이전트가 만든 규약',
        // 이 세션의 주체는 developer 다 — 만들 수 있는 것은 convention·adr 이다
        // (EP-SPEC-07 의 ○). 역할이 타입을 가른다는 것이 여기서도 보인다.
        type: 'convention',
        body_md: '# 에이전트가 만든 스펙\n\n본문',
      },
    });
    const result = body['result'] as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
      content?: { text?: string }[];
    };
    // 실패하면 **무엇 때문인지** 보이게 한다 — isError 만 보면 원인이 남지 않는다
    expect(result.content?.[0]?.text ?? '').toContain('"ok":true');
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent?.['spec_id']).toBeTruthy();
  });

  it('기존 스펙에 다른 메타가 오면 409 다 — 이동·개명은 EP-SPEC-15 소관 (REQ-API-021)', async () => {
    const made = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: {
        key: 'SPC-AGENT-META',
        title: '원래 제목',
        type: 'convention',
        body_md: '# 원래 제목\n\n본문',
      },
    });
    const madeOut = ((made.body['result'] as { structuredContent?: Record<string, unknown> })
      .structuredContent ?? {}) as Record<string, unknown>;
    const specId = String(madeOut['spec_id']);
    // 편집에는 **읽은 내용의 지문**이 필요하다 — 저장 응답이 다음 지문을 준다(§1.4g)
    let hash = String(madeOut['content_hash']);

    // 같은 값이면 통과한다 — 멱등 재호출이 여기서 걸리면 안 된다
    const same = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: {
        spec_id: specId,
        title: '원래 제목',
        body_md: '# 원래 제목\n\n고친 본문',
        base_hash: hash,
      },
    });
    expect((same.body['result'] as { isError?: boolean }).isError ?? false).toBe(false);
    hash = String(
      ((same.body['result'] as { structuredContent?: Record<string, unknown> }).structuredContent ??
        {})['content_hash'],
    );

    // 다른 값이면 거부한다. 조용히 무시하면 부른 쪽은 옮겨졌다고 믿는다
    const changed = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: {
        spec_id: specId,
        title: '바뀐 제목',
        body_md: '# 바뀐 제목\n\n본문',
        base_hash: hash,
      },
    });
    const err = changed.body['result'] as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    expect(err.isError).toBe(true);
    expect((err.structuredContent?.['details'] as Record<string, unknown>)?.['kind']).toBe(
      'meta_change_not_allowed',
    );
  });

  it('역할이 만들 수 있는 타입을 가른다 — developer 는 feature 를 못 만든다', async () => {
    // 스코프(`spec:draft`)는 "초안을 쓸 수 있는가"이고 타입 제한은 "무엇을 시작할 수
    // 있는가"다. 다른 물음이라 따로 판정한다(EP-SPEC-07 의 ● / ○).
    const { body } = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: { key: 'SPC-NOPE', title: '기능', type: 'feature', body_md: '# 기능\n\n본문' },
    });
    const result = body['result'] as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    expect(result.isError).toBe(true);
    expect((result.structuredContent?.['details'] as Record<string, unknown>)?.['kind']).toBe(
      'spec_type_not_allowed',
    );
  });

  it('인자 설명도 요청 로케일을 탄다 (REQ-CB-024)', async () => {
    // 도구 설명만 번역하고 인자를 한국어로 두면 영어 클라이언트가 반쪽짜리 스키마를 받는다.
    const ko = await rpc('tools/list', {}, { lang: 'ko' });
    const en = await rpc('tools/list', {}, { lang: 'en' });
    const argOf = (body: Record<string, unknown>, tool: string, arg: string): string => {
      const tools = (
        body['result'] as { tools: { name: string; inputSchema: Record<string, unknown> }[] }
      ).tools;
      const schema = tools.find((x) => x.name === tool)?.inputSchema ?? {};
      const props = (schema['properties'] ?? {}) as Record<string, { description?: string }>;
      return props[arg]?.description ?? '';
    };
    const k = argOf(ko.body, 'nerv_bootstrap', 'hostname');
    const e = argOf(en.body, 'nerv_bootstrap', 'hostname');
    expect(k).not.toBe(e);
    expect(k).toContain('머신');
    expect(e).toContain('machine');
    // **키가 그대로 새어 나가지 않는다** — 번역기는 모르는 키를 키 그대로 돌려준다
    expect(k).not.toContain('mcp.arg');
  });

  it('리비전을 병행 서빙한다 — 구 클라이언트도 협상된다 (D-11)', async () => {
    for (const revision of ['2026-07-28', '2025-11-25', '2025-03-26']) {
      const { body } = await rpc('initialize', {}, { revision });
      expect((body['result'] as Record<string, unknown>)['protocolVersion']).toBe(revision);
    }
    // 헤더가 없으면 구 클라이언트로 본다 — 400 을 내면 그쪽이 통째로 막힌다
    const { body } = await rpc('initialize', {}, { revision: null });
    expect((body['result'] as Record<string, unknown>)['protocolVersion']).toBe('2025-03-26');
  });

  it('모르는 리비전은 거부한다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}`, 'mcp-protocol-version': '1999-01-01' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('자격증명이 없으면 401 — 도구 목록도 보이지 않는다', async () => {
    const { status } = await rpc('tools/list', {}, { token: null });
    expect(status).toBe(401);
  });

  it('타 오리진은 403 — 인증보다 먼저 막힌다 (REQ-CB-013)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { origin: 'https://evil.example.com' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });
});

describe('E03-S03 P0 도구 — nerv_bootstrap', () => {
  it('첫 호출이 세션을 만들고 컨텍스트 팩을 준다', async () => {
    const result = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-07',
      branch: 'fix/loader-cache',
      external_session_id: 'S-b7e9',
    });

    expect(result['ok']).toBe(true);
    expect(result['session_id']).toEqual(expect.any(String));
    expect(result['resumed']).toBe(false);
    expect(result['project']).toMatchObject({ slug: 'clemvion', key: 'CLV' });
    expect(result['active_claims']).toEqual([]);
    // 규약 스펙을 실어 준다 — 세션이 규약을 모른 채 시작하지 않게
    expect((result['conventions'] as unknown[]).length).toBeGreaterThan(0);
    expect(result['constants']).toMatchObject({ heartbeat_interval_seconds: 60 });

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_session WHERE external_session_id='S-b7e9'`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('같은 external_session_id 재호출은 동일 스냅샷이다 — 멱등', async () => {
    const first = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-07',
      external_session_id: 'S-idem',
    });
    const second = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-07',
      external_session_id: 'S-idem',
    });

    expect(second['session_id']).toBe(first['session_id']);
    expect(second['resumed']).toBe(true);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_session WHERE external_session_id='S-idem'`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('session.started 이벤트를 남긴다 (FR-16 감사)', async () => {
    await callTool('nerv_bootstrap', {
      agent_type: 'codex',
      hostname: 'linux-ci-01',
      external_session_id: 'S-evt',
    });
    const { rows } = await pool.query<{ n: number; is_agent: boolean }>(
      `SELECT count(*)::int AS n, bool_and(is_agent) AS is_agent FROM event WHERE type='session.started'`,
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
    expect(rows[0]?.is_agent).toBe(true);
  });
});

describe('E03-S03 P0 도구 — 작업 흐름', () => {
  it('bootstrap → task_next → claim → heartbeat 를 완주한다 (0-8 tools-only)', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-02',
      external_session_id: 'S-flow',
    });
    const sessionId = boot['session_id'] as string;

    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-flow','흐름','ready','목표','PR','nerv_spec_get','경계')`,
      [taskId, projectId],
    );

    const next = await callTool('nerv_task_next', { session_id: sessionId });
    const candidates = next['candidates'] as { id: string }[];
    expect(candidates.map((c) => c.id)).toContain(taskId);
    expect(next['next_actions']).toEqual(['nerv_task_claim']);

    const claimed = await callTool('nerv_task_claim', {
      session_id: sessionId,
      task_id: taskId,
      scope: { spec_ids: [], file_globs: ['codebase/x/**'] },
    });
    expect(claimed['ok']).toBe(true);
    expect(claimed['lease_expires_at']).toEqual(expect.any(String));

    const beat = await callTool('nerv_task_heartbeat', {
      session_id: sessionId,
      claim_id: claimed['claim_id'],
    });
    expect(beat['lease_expires_at']).toEqual(expect.any(String));
    expect(beat['pending']).toEqual([]);

    // bootstrap 재호출이 활성 클레임을 실어 준다 — 재연결한 세션이 자기 상태를 되찾는다
    const rebooted = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-02',
      external_session_id: 'S-flow',
    });
    expect((rebooted['active_claims'] as { task_key: string }[])[0]).toMatchObject({
      task_key: 'TSK-flow',
    });

    const released = await callTool('nerv_task_release', {
      session_id: sessionId,
      claim_id: claimed['claim_id'],
      reason: 'abandon',
    });
    expect(released['taskStatus']).toBe('ready');
  });

  /** 이 프로젝트의 살아 있는 세션을 비운다 — 추정의 입력을 통제하기 위해 */
  async function clearSessions(): Promise<void> {
    await pool.query(`UPDATE agent_session SET state = 'stale' WHERE project_id = $1`, [projectId]);
  }

  it('세션이 하나도 없으면 막고 bootstrap 을 가리킨다 — 모델이 스스로 고칠 수 있게', async () => {
    await clearSessions();
    const result = await callTool('nerv_task_claim', { task_id: newId() });
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.PRECONDITION });
    expect(result['details']).toMatchObject({ kind: 'session_required' });
    expect(result['next_actions']).toEqual(['nerv_bootstrap']);
  });
});

// ── 세션 추정 (2026-08-29 — 토이 프로젝트 실측 보고) ─────────────────────────────
//
// 카탈로그(3.4 §2.3)는 `nerv_bootstrap` 외의 도구에 `session_id` 를 적지 않는다. 서버가
// 안다는 뜻인데 **그 절반이 없었다** — 세션을 요구하는 도구는 스키마대로 부르면 언제나
// `session_required` 였고, bootstrap 이 방금 성공했어도 그랬다.
//
// L2 가 이것을 잡지 못한 이유가 이 파일에 있다: 여기 호출들은 전부 `session_id` 를 실어
// 보냈다 — **테스트가 계약에 없는 인자를 알고 있었다.**

// ── 입력 검증 (2026-08-30 — 조용한 실패를 막는다) ────────────────────────────
//
// 스키마가 `required` 를 적어도 아무도 읽지 않으면 그것은 계약이 아니라 문서다. 그리고
// 핸들러는 없는 값을 `?? ''` 로 받으므로, 이름을 잘못 적은 호출이 **거부되는 대신 빈 값으로
// 성공한다** — 본문 저장에서는 그것이 곧 문서를 지우는 일이다.

describe('E03-S01 입력은 호출 전에 본다', () => {
  it('필수 인자가 없으면 무엇이 없는지 이름으로 말한다', async () => {
    const result = await callTool('nerv_spec_get', {});
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.PRECONDITION });
    expect(result['details']).toMatchObject({ kind: 'invalid_input', missing: ['spec_id'] });
  });

  it('타입이 다르면 그 항목을 말한다 — 스키마가 문서로만 남지 않게', async () => {
    const result = await callTool('nerv_spec_get', { spec_id: 42 });
    expect(result['details']).toMatchObject({ kind: 'invalid_input', wrong_type: ['spec_id'] });
  });

  it('본문은 두 이름으로 받는다 — 카탈로그는 body_markdown, 이 도구는 body_md 였다', async () => {
    const made = await callTool('nerv_spec_draft_upsert', {
      key: 'SPC-BODYNAME',
      title: '이름 둘',
      // 이 스위트의 주체는 developer 다 — 그 역할이 만들 수 있는 종류로 쓴다(EP-SPEC-07)
      type: 'convention',
      body_markdown: '# 카탈로그 이름으로 부른다',
    });
    expect(made).toMatchObject({ ok: true });

    const read = await callTool('nerv_spec_get', { spec_id: 'SPC-BODYNAME' });
    expect(String(read['body_md'])).toContain('카탈로그 이름으로 부른다');
  });

  it('본문 이름을 아예 빠뜨리면 거부한다 — 빈 문자열로 성공하지 않는다', async () => {
    const result = await callTool('nerv_spec_draft_upsert', {
      key: 'SPC-NOBODY',
      title: '본문 없음',
      type: 'convention',
    });
    expect(result['details']).toMatchObject({ kind: 'invalid_input', missing: ['body_markdown'] });
  });

  it('빈 본문으로 기존 초안을 덮어쓰지 못한다 — 초안은 이전 본문을 남기지 않는다', async () => {
    await callTool('nerv_spec_draft_upsert', {
      key: 'SPC-WIPE',
      title: '지워질 뻔한 문서',
      type: 'convention',
      body_markdown: '# 중요한 본문\n\n여러 줄',
    });
    const read = await callTool('nerv_spec_get', { spec_id: 'SPC-WIPE' });
    const wiped = await callTool('nerv_spec_draft_upsert', {
      spec_id: 'SPC-WIPE',
      body_markdown: '   ',
      base_hash: read['content_hash'],
    });
    expect(wiped['details']).toMatchObject({ kind: 'empty_body' });

    const after = await callTool('nerv_spec_get', { spec_id: 'SPC-WIPE' });
    expect(String(after['body_md'])).toContain('중요한 본문');
  });
});

describe('E03-S03 세션 추정 — 스키마대로 부르면 된다', () => {
  async function clearSessions(): Promise<void> {
    await pool.query(`UPDATE agent_session SET state = 'stale' WHERE project_id = $1`, [projectId]);
  }

  const boot = (external: string, hostname: string): Promise<Record<string, unknown>> =>
    callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname,
      external_session_id: external,
    });

  it('bootstrap 뒤에는 session_id 없이도 세션 도구가 돈다', async () => {
    await clearSessions();
    await boot('S-infer', 'mac-infer');

    const question = await callTool('nerv_question_create', {
      question: '이 판단이 맞습니까',
      urgency: 'normal',
    });
    expect(question['ok']).toBe(true);
    expect(question['question_id']).toEqual(expect.any(String));
  });

  it('살아 있는 세션이 둘이면 고르지 않고 후보를 준다 — 오귀속은 잘못된 충돌 판정이 된다', async () => {
    await clearSessions();
    await boot('S-two-a', 'mac-a');
    await boot('S-two-b', 'mac-b');

    const result = await callTool('nerv_question_create', {
      question: '누구의 질문인가',
      urgency: 'normal',
    });
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.PRECONDITION });
    const details = result['details'] as { kind: string; sessions: { hostname: string }[] };
    expect(details.kind).toBe('session_ambiguous');
    expect(details.sessions.map((x) => x.hostname).sort()).toEqual(['mac-a', 'mac-b']);
    // bootstrap 을 권하면 세션이 하나 더 생겨 모호함이 깊어진다
    expect(result['next_actions']).toEqual([]);
  });

  it('모호하면 session_id 로 고른다 — 그리고 남의 세션은 받지 않는다', async () => {
    await clearSessions();
    const mine = (await boot('S-mine', 'mac-mine'))['session_id'] as string;
    await boot('S-other-live', 'mac-other-live'); // 모호하게 만든다

    const ok = await callTool('nerv_question_create', {
      question: '이 세션의 질문',
      urgency: 'normal',
      session_id: mine,
    });
    expect(ok['ok']).toBe(true);

    // 같은 프로젝트의 **남의** 세션 — 존재만 보면 여기에 일을 붙일 수 있었다
    const stranger = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state, last_heartbeat_at)
       VALUES ($1, $2, $3, 'claude-code', 'someone-else', 'active', now())`,
      [stranger, projectId, qaUserId],
    );
    const refused = await callTool('nerv_question_create', {
      question: '남의 세션에 붙는가',
      urgency: 'normal',
      session_id: stranger,
    });
    expect(refused).toMatchObject({ ok: false, code: NERV_ERROR.PRECONDITION });
    expect(refused['details']).toMatchObject({ kind: 'not_found' });
  });

  it('stale 로 쓸려 간 세션은 bootstrap 재개가 되살린다 — resumed 는 살아났다는 뜻이다', async () => {
    await clearSessions();
    await boot('S-revive', 'mac-revive');
    await clearSessions(); // 무활동 30분이 지난 것과 같은 상태

    const again = await boot('S-revive', 'mac-revive');
    expect(again['resumed']).toBe(true);

    // 되살아나지 않으면 추정이 그 세션을 못 찾아 bootstrap 과 실패를 무한히 오간다
    const question = await callTool('nerv_question_create', {
      question: '되살아난 세션의 질문',
      urgency: 'normal',
    });
    expect(question['ok']).toBe(true);
  });

  it('도구 호출은 생존의 증거다 — 하트비트를 안 쳐도 세션이 늙지 않는다', async () => {
    await clearSessions();
    const id = (await boot('S-touch', 'mac-touch'))['session_id'] as string;
    await pool.query(
      `UPDATE agent_session SET last_heartbeat_at = now() - interval '20 minutes' WHERE id = $1`,
      [id],
    );

    await callTool('nerv_spec_tree', {});

    const { rows } = await pool.query<{ age: string }>(
      `SELECT extract(epoch from now() - last_heartbeat_at)::int::text AS age
         FROM agent_session WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]?.age)).toBeLessThan(60);
  });
});

describe('P2 리뷰 도구 2종 — 카탈로그에 들어온 표면 (FR-09, 2026-08-23)', () => {
  it('리뷰를 제출하면 세션·발견이 레코드로 남는다 — 파일 커밋 대신', async () => {
    const result = await callTool(
      'nerv_review_submit',
      {
        branch: 'feat/mcp-review',
        base_sha: 'base111',
        head_sha: 'head222',
        changeset: ['src/gateway.ts'],
        kind: 'code',
        reviewer: { role: 'security', risk: 'high' },
        summary: '게이트웨이 인증 경로를 봤다.',
        findings: [
          { severity: 'critical', title: '토큰이 로그에 남는다', file: 'src/gateway.ts', line: 12 },
        ],
      },
      { token: reviewToken },
    );
    expect(result['ok']).not.toBe(false);
    expect(result['round_no']).toBe(1);
    expect(result['findings_new']).toHaveLength(1);
    // 열린 critical 이 있으면 BLOCK 이고, 다음 행동은 처분이다(§2.1 원칙 5)
    expect(result['block']).toBe(true);
    expect(result['next_actions']).toEqual(['nerv_finding_resolve']);
  });

  it('critical 하향은 승인 큐로 보낸다 — 자기 리뷰의 심각도를 스스로 낮추지 못한다(A3)', async () => {
    const submitted = await callTool(
      'nerv_review_submit',
      {
        branch: 'feat/mcp-review',
        base_sha: 'base111',
        head_sha: 'head333',
        changeset: ['src/gateway.ts'],
        reviewer: { role: 'security' },
        findings: [{ severity: 'critical', title: '리스 만료 검사가 없다', file: 'src/lease.ts' }],
      },
      { token: reviewToken },
    );
    const findingId = (submitted['findings_new'] as string[])[0];

    const denied = await callTool(
      'nerv_finding_resolve',
      { finding_id: findingId, resolution: 'wont_fix', rationale: '다음 스프린트' },
      { token: qaToken },
    );
    expect(denied).toMatchObject({ ok: false, code: NERV_ERROR.APPROVAL_REQUIRED });
    expect(denied['details']).toMatchObject({ kind: 'critical_downgrade' });
    expect(denied['details']).toHaveProperty('approval_id');
  });

  it('토큰은 역할보다 넓을 수 없다 — developer 에게는 `review:resolve` 가 없다', async () => {
    // 토큰에는 실어 발급했지만(위 setup) 유효 권한은 역할 ∩ 토큰이다(api.md §1.3).
    // 그 교집합이 도구 경로에서도 같은 판정을 내는지 본다.
    const result = await callTool(
      'nerv_finding_resolve',
      { finding_id: newId(), resolution: 'fixed', rationale: '고쳤다', commit_sha: 'abc' },
      { token: reviewToken },
    );
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.FORBIDDEN });
    expect(result['details']).toMatchObject({ kind: 'missing_scope', required: 'review:resolve' });
  });
});

describe('E03-S04 에러 규약 — 구조화 결과', () => {
  it('스코프가 부족하면 호출 전에 막고 NERV_FORBIDDEN 을 구조화 결과로 준다', async () => {
    const result = await callTool(
      'nerv_task_claim',
      { task_id: newId() },
      { token: readOnlyToken },
    );
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.FORBIDDEN });
    expect(result['details']).toMatchObject({ kind: 'missing_scope', required: 'task:claim' });
  });

  it('실패는 프로토콜 에러가 아니라 도구 결과다 — 모델이 읽고 다음 행동을 고른다', async () => {
    const { body } = await rpc('tools/call', {
      name: 'nerv_task_claim',
      arguments: { task_id: newId(), session_id: null },
    });
    // JSON-RPC 레벨은 성공이고, 실패는 result 안에 실린다
    expect(body['error']).toBeUndefined();
    const result = body['result'] as {
      isError: boolean;
      structuredContent: Record<string, unknown>;
    };
    expect(result.isError).toBe(true);
    expect(Object.keys(result.structuredContent).sort()).toEqual([
      'code',
      'details',
      'message',
      'next_actions',
      'ok',
      'retry_after_s',
    ]);
  });

  it('겹침 차단은 next_actions 를 실어 준다 — 별도 폴링 루프를 만들 필요가 없다', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-07',
      external_session_id: 'S-conflict-a',
    });
    const boot2 = await callTool('nerv_bootstrap', {
      agent_type: 'codex',
      hostname: 'linux-ci-01',
      external_session_id: 'S-conflict-b',
    });

    const specId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-X','X')`,
      [specId, projectId],
    );
    const t1 = newId();
    const t2 = newId();
    for (const [id, key] of [
      [t1, 'TSK-c1'],
      [t2, 'TSK-c2'],
    ] as const) {
      await pool.query(
        `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
         VALUES ($1,$2,$3,$3,'ready','목표','PR','도구','경계')`,
        [id, projectId, key],
      );
    }

    await callTool('nerv_task_claim', {
      session_id: boot['session_id'],
      task_id: t1,
      scope: { spec_ids: [specId], file_globs: [] },
    });
    const blocked = await callTool('nerv_task_claim', {
      session_id: boot2['session_id'],
      task_id: t2,
      scope: { spec_ids: [specId], file_globs: [] },
    });

    expect(blocked).toMatchObject({ ok: false, code: NERV_ERROR.CONFLICT_SCOPE });
    expect(blocked['next_actions']).toEqual(['nerv_task_next', 'nerv_question_create']);
    // 상대 세션의 사용자·hostname 이 그대로 실린다
    const overlaps = (blocked['details'] as { overlaps: Record<string, unknown>[] }).overlaps;
    expect(overlaps[0]).toMatchObject({ hostname: 'mac-07' });
  });

  it('모르는 도구도 구조화 결과로 돌려준다', async () => {
    const result = await callTool('nerv_does_not_exist');
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.PRECONDITION });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'hana@example.com','하나','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, userId],
  );
  qaUserId = newId();
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'qa@example.com','규아','active')`,
    [qaUserId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'qa')`,
    [newId(), orgId, projectId, qaUserId],
  );
  // 규약 스펙 — bootstrap 컨텍스트 팩에 실린다
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'convention','conv-commit','커밋 규약')`,
    [newId(), projectId],
  );
}
