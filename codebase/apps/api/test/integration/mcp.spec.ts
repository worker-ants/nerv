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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_SCOPES, NERV_ERROR, REST_ONLY_SCOPES, newId } from '@nerv/schema';
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

  it('tools/list 가 23종을 노출한다 — MVP 20(P0 8 + P1 12) + 리뷰 2(P2) + 첨부 읽기 1', async () => {
    const { body } = await rpc('tools/list');
    const tools = (body['result'] as { tools: { name: string; inputSchema: unknown }[] }).tools;
    // 카탈로그가 20인 것은 리뷰 수집(FR-09)이 Phase 2 에서 위에 얹혔기 때문이다 —
    // 두 수를 섞지 않는다. MVP 는 20 이다 — 2026-08-30 에 16 → 19(Task 를 만들고·읽고·훑는
    // 셋), 2026-09-01 에 20(`nerv_spec_attach` — 시안을 문서에 매다는 길이 없었다).
    expect(tools).toHaveLength(23);
    expect(tools.map((t) => t.name)).toContain('nerv_bootstrap');
    expect(tools.map((t) => t.name)).toContain('nerv_spec_relate');
    expect(tools.map((t) => t.name)).toContain('nerv_task_get');
    expect(tools.map((t) => t.name)).toContain('nerv_task_create');
    expect(tools.map((t) => t.name)).toContain('nerv_task_list');
    expect(tools.map((t) => t.name)).toContain('nerv_spec_attach');
    expect(tools.map((t) => t.name)).toContain('nerv_review_submit');
    expect(tools.map((t) => t.name)).toContain('nerv_finding_resolve');
    for (const tool of tools) expect(tool.inputSchema).toBeTruthy();
  });

  /**
   * "스코프는 도구 표의 '필요 권한' 열과 1:1" 은 **사실이 아니었다**(2026-09-04 실측).
   *
   * 도구 23종이 쓰는 스코프는 일곱이고 셋(`spec:meta`·`spec:evidence`·`import:write`)은
   * 도구가 없는 REST 축이다. 문서가 그 말을 오래 달고 있었으므로 여기서 사실을 못박는다 —
   * 다음에 어긋나면 문장이 아니라 이 테스트가 먼저 말한다.
   */
  it('REST 전용 스코프에는 도구가 없다 — 어휘가 도구 표와 1:1 이 아니다', async () => {
    const { body } = await rpc('tools/list');
    const tools = (
      body['result'] as { name: string; _meta?: Record<string, unknown> }[] & {
        tools: { _meta?: Record<string, unknown> }[];
      }
    ).tools;
    const used = new Set(tools.map((t) => String(t._meta?.['nerv/scope'])));

    for (const scope of REST_ONLY_SCOPES) expect(used.has(scope)).toBe(false);
    // 남은 일곱이 도구 22종을 덮는다 — 어휘 10 에서 REST 축 3 을 뺀 수와 정확히 같다
    expect(used.size).toBe(AGENT_SCOPES.length - REST_ONLY_SCOPES.length);
    for (const scope of used) expect(AGENT_SCOPES as readonly string[]).toContain(scope);
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

  /**
   * 카탈로그가 적고 있던 인자들이 실제로 어딘가에 남는가(REQ-API-081).
   *
   * 이 넷은 오랫동안 **받는 척만** 했다 — 스키마에 없거나(그래서 조용히 버려지거나) 저장할
   * 열이 없었다. 에이전트는 노트를 남겼다고 믿고 다음 사람은 빈 Task 를 집었다.
   */
  it('progress · stats · state_note 가 실제로 남는다', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-note',
      external_session_id: 'S-note',
    });
    const sessionId = boot['session_id'] as string;

    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-note','노트','ready','목표','PR','nerv_spec_get','경계')`,
      [taskId, projectId],
    );
    const claimed = await callTool('nerv_task_claim', {
      session_id: sessionId,
      task_id: taskId,
      scope: { spec_ids: [], file_globs: ['codebase/note/**'] },
    });

    await callTool('nerv_task_heartbeat', {
      session_id: sessionId,
      claim_id: claimed['claim_id'],
      progress: '로더 캐시 헤더를 고치는 중',
      stats: { added: 12, removed: 3, files: 2 },
    });

    // 세션 카드의 +N −M — 열은 처음부터 있었고 읽는 화면도 있었는데 쓰는 곳이 없었다
    const { rows: session } = await pool.query<{ a: number; r: number; f: number }>(
      `SELECT diff_added AS a, diff_removed AS r, diff_files AS f FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    expect(session[0]).toMatchObject({ a: 12, r: 3, f: 2 });

    const { rows: progress } = await pool.query<{ progress_note: string }>(
      `SELECT progress_note FROM claim WHERE id = $1`,
      [claimed['claim_id']],
    );
    expect(progress[0]?.progress_note).toBe('로더 캐시 헤더를 고치는 중');

    const released = await callTool('nerv_task_release', {
      session_id: sessionId,
      claim_id: claimed['claim_id'],
      reason: 'handoff',
      state_note: '리스 헤더까지 고쳤고 캐시 무효화가 남았다',
    });
    expect(released['state_note']).toBe('리스 헤더까지 고쳤고 캐시 무효화가 남았다');

    // **다음 사람이 후보 목록에서 그것을 본다** — 타임라인에만 있으면 찾지 못한다
    const next = await callTool('nerv_task_next', { session_id: sessionId });
    const mine = (next['candidates'] as Record<string, unknown>[]).find((c) => c['id'] === taskId);
    expect(mine?.['handoff_note']).toBe('리스 헤더까지 고쳤고 캐시 무효화가 남았다');
  });

  it('후보가 기준 문서를 열 수 있게 한다 — spec_key · version_no', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-basis',
      external_session_id: 'S-basis',
    });
    const basis = await makeSpecVersion('SPC-BASIS', 'approved', 4);
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md, source_spec_version_id)
       VALUES ($1,$2,'TSK-basis','기준','ready','목표','PR','nerv_spec_get','경계',$3)`,
      [taskId, projectId, basis.id],
    );

    const next = await callTool('nerv_task_next', { session_id: boot['session_id'] });
    const mine = (next['candidates'] as Record<string, unknown>[]).find((c) => c['id'] === taskId);
    // id 만으로는 nerv_spec_get 을 부를 수 없다 — 스킬 6단계가 요구하는 것은 키와 판 번호다
    expect(mine).toMatchObject({ spec_key: basis.key, version_no: 4 });
  });

  it('nerv_spec_get 이 include 를 받는다 — 코멘트와 파생 Task', async () => {
    const target = await makeSpecVersion('SPC-INCLUDE', 'approved', 1);
    await pool.query(
      `INSERT INTO spec_comment (id, project_id, spec_id, spec_version_id, anchor, author_user_id, body_md, status)
       VALUES ($1,$2,$3,$4,'1-개요',$5,'여기 한 줄이 모호합니다','open')`,
      [newId(), projectId, target.specId, target.id, userId],
    );
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id)
       VALUES ($1,$2,'TSK-derived','파생','backlog',$3)`,
      [taskId, projectId, target.id],
    );

    const plain = await callTool('nerv_spec_get', { spec_id: target.key });
    expect(plain['comments']).toBeUndefined();
    expect(plain['tasks']).toBeUndefined();

    const rich = await callTool('nerv_spec_get', {
      spec_id: target.key,
      include: ['comments', 'tasks'],
    });
    expect((rich['comments'] as unknown[]).length).toBeGreaterThan(0);
    expect((rich['tasks'] as { key: string }[]).map((t) => t.key)).toContain('TSK-derived');
    // 받는 척만 하던 인자가 아니라는 것 — 무시 목록에 오르지 않는다
    expect(rich['ignored_args']).toBeUndefined();
  });

  /** 스펙 한 벌을 만든다 — 시드에는 버전 있는 스펙이 없다(도구가 만든다). */
  async function makeSpecVersion(
    key: string,
    status: 'draft' | 'approved',
    versionNo: number,
  ): Promise<{ id: string; specId: string; key: string }> {
    const specId = newId();
    const versionId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$4)`,
      [specId, projectId, key, key],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,$3,$4::spec_version_status,'# 본문', sha256('본문'::bytea), $5)`,
      [versionId, specId, versionNo, status, userId],
    );
    await pool.query(`UPDATE spec SET current_version_id = $1 WHERE id = $2`, [versionId, specId]);
    return { id: versionId, specId, key };
  }

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

/**
 * 훅 세션 채택 — 기본 설치의 첫 클레임이 막히던 자리(2026-09-03).
 *
 * SessionStart 훅이 세션 A 를 만들고, 스킬의 `nerv_bootstrap` 이 하네스 id 를 모른 채
 * 세션 B 를 만들면 살아 있는 세션이 둘이 되어 `nerv_task_claim` 이 `session_ambiguous` 로
 * 거부됐다. **실측(2026-09-03): 실사용 세션 34개가 만든 클레임이 0건.** 그래서 서버가
 * 알아보는 쪽이 됐다 — 스킬이 `session_id` 를 싣는 길은 하네스가 그 값을 모델에 주지
 * 않아서 막혀 있다.
 */
/**
 * 유령 인자 — 스킬이 보내고 도구가 받지 않는 것들(REQ-API-080).
 *
 * 실측 2026-09-03: 스킬 5종이 지시하는 인자 열한 종(`state_note`·`stats`·`include`·
 * `repo{}`·`role`·`capabilities`·`branch`·`worktree`·`resolved_in_version_id`·`note`·
 * `reviewer_hint`)이 성공 응답과 함께 사라지고 있었다. 거부하지 않되 **말은 한다.**
 */
describe('E03-S03 모르는 인자 — 성공해도 버렸다고 말한다', () => {
  it('도구가 받지 않는 인자를 응답이 되돌려준다', async () => {
    const result = await callTool('nerv_spec_tree', { unknown_arg: 1, include: ['comments'] });
    expect(result['ok']).toBe(true);
    expect(result['ignored_args']).toEqual(expect.arrayContaining(['unknown_arg', 'include']));
  });

  it('정상 호출에는 그 필드가 없다 — 늘 붙는 경고는 아무도 읽지 않는다', async () => {
    const result = await callTool('nerv_spec_tree', {});
    expect(result['ok']).toBe(true);
    expect(result['ignored_args']).toBeUndefined();
  });

  it('봉투 인자는 유령이 아니다 — session_id 는 게이트웨이가 읽는다', async () => {
    await pool.query(`UPDATE agent_session SET state = 'stale' WHERE project_id = $1`, [projectId]);
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-envelope',
      external_session_id: 'S-envelope',
    });
    const result = await callTool('nerv_spec_tree', { session_id: boot['session_id'] });
    expect(result['ignored_args']).toBeUndefined();
  });
});

/**
 * 걸러 주는 인자 — 스키마에 있고 핸들러에는 없던 넷(REQ-API-090).
 *
 * 실측 2026-09-05(sudoku · 실사용 보고): `root`·`depth`·`around`·`hops` 를 무엇으로 줘도
 * 프로젝트 전체 18개가 그대로 왔다. **없는 문서를 `root` 로 줘도 `ok:true` 였다** — 그리고
 * 스킬은 그 인자를 `root_spec_id` 라는 없는 이름으로 적고 있어서, 옳은 이름을 쓴 세션과
 * 틀린 이름을 쓴 세션의 응답이 **같았다.** 어긋남을 알아챌 자리가 어디에도 없었다.
 */
/**
 * 유령 인자를 **기계가 잡는다**(REQ-API-091 · AGENTS.md 규약 6).
 *
 * 스킬이 지시하는 인자가 도구 스키마에 실재하는가 — 이 저장소가 네 번 겪은 실패다.
 * 2026-09-05 실사용 보고가 둘을 더 찾았다: `nerv_spec_search`(`query`)는 실제로는 `q` 고
 * `nerv_spec_tree`(`root_spec_id`)는 실제로는 `root` 였다. 앞의 것은 시끄럽게 실패해
 * 세션이 스스로 회복했지만, 뒤의 것은 **서버가 `root` 마저 무시하고 있어서** 틀린 이름을
 * 쓴 세션과 옳은 이름을 쓴 세션의 응답이 같았다 — 둘이 서로를 가렸다.
 *
 * 사람의 눈으로 대조하는 일을 여기 옮긴다. 손으로 하는 교차 검사는 하기로 정해 두어도
 * 하지 않는 날이 오고, 그날은 아무 소리도 나지 않는다.
 */
describe('E03-S03 스킬이 부르는 인자가 도구에 실재하는가', () => {
  /** `` `nerv_x`(`a`, `b=값`) `` 표기에서 인자 이름만 줍는다 — 값(`=`·`:` 뒤)은 버린다 */
  const CALL = /`(nerv_[a-z_]+)`\(([^)]*)\)/g;
  const TOKEN = /`([^`]+)`/g;

  it('스킬 6종의 도구 호출 표기를 tools/list 스키마와 대조한다', async () => {
    const { body } = await rpc('tools/list');
    const tools = (
      body['result'] as { tools: { name: string; inputSchema: Record<string, unknown> }[] }
    ).tools;
    const known = new Map<string, Set<string>>();
    for (const tool of tools) {
      const properties = (tool.inputSchema['properties'] ?? {}) as Record<
        string,
        { enum?: unknown[] }
      >;
      const names = new Set(Object.keys(properties));
      // **값도 이름처럼 보인다** — `nerv_finding_resolve`(`dismissed`) 의 `dismissed` 는
      // 인자가 아니라 `resolution` 의 값이다. 어휘에 있는 값은 유령이 아니다.
      for (const property of Object.values(properties)) {
        for (const value of property.enum ?? []) if (typeof value === 'string') names.add(value);
      }
      // 봉투 인자는 표면이 읽는다(tool-input.ts ENVELOPE_ARGS)
      names.add('session_id').add('idempotency_key');
      known.set(tool.name, names);
    }

    const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugin/skills');
    const ghosts: string[] = [];
    let checked = 0;
    for (const skill of readdirSync(skillsDir)) {
      const body_ = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
      for (const call of body_.matchAll(CALL)) {
        const tool = call[1] ?? '';
        const schema = known.get(tool);
        if (schema === undefined) {
          ghosts.push(`${skill}: ${tool} 이라는 도구가 없다`);
          continue;
        }
        for (const token of (call[2] ?? '').matchAll(TOKEN)) {
          const name = (token[1] ?? '').split(/[=:]/)[0]?.trim() ?? '';
          if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
          checked += 1;
          if (!schema.has(name)) ghosts.push(`${skill}: ${tool}(${name})`);
        }
      }
    }
    // 정규식이 아무것도 못 줍고 통과하는 일이 없게 — 빈 검사는 검사가 아니다
    expect(checked).toBeGreaterThan(40);
    expect(ghosts).toEqual([]);
  });
});

describe('E03-S03 nerv_spec_tree — 걸러 달라고 한 것은 걸러서 준다', () => {
  const keys = (result: Record<string, unknown>): string[] =>
    (result['nodes'] as { key: string }[]).map((node) => node.key);

  let rootId = '';
  let branchId = '';
  let leafId = '';
  let siblingId = '';

  beforeAll(async () => {
    const make = async (key: string, parent: string | null): Promise<string> => {
      const id = newId();
      await pool.query(
        `INSERT INTO spec (id, project_id, type, key, title, parent_id)
         VALUES ($1,$2,'feature',$3,$4,$5)`,
        [id, projectId, key, key, parent],
      );
      return id;
    };
    // TRE-1-ROOT ─ TRE-2-BRANCH ─ TRE-3-LEAF
    //            └ TRE-2-SIB
    rootId = await make('TRE-1-ROOT', null);
    branchId = await make('TRE-2-BRANCH', rootId);
    siblingId = await make('TRE-2-SIB', rootId);
    leafId = await make('TRE-3-LEAF', branchId);
    await pool.query(
      `INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
       VALUES ($1,$2,$3,$4,'depends_on')`,
      [newId(), projectId, branchId, siblingId],
    );
  });

  it('root 는 그 문서와 그 아래만 준다 — 안정 키로', async () => {
    const result = await callTool('nerv_spec_tree', { root: 'TRE-2-BRANCH' });
    expect(keys(result)).toEqual(['TRE-2-BRANCH', 'TRE-3-LEAF']);
  });

  it('root 는 UUID 로도 같다 — 참조는 둘 다 받는다(§1.4b)', async () => {
    const byId = await callTool('nerv_spec_tree', { root: branchId });
    expect(keys(byId)).toEqual(['TRE-2-BRANCH', 'TRE-3-LEAF']);
  });

  it('root + depth:0 은 그 하나다', async () => {
    const result = await callTool('nerv_spec_tree', { root: 'TRE-1-ROOT', depth: 0 });
    expect(keys(result)).toEqual(['TRE-1-ROOT']);
  });

  it('root + depth:1 은 그 자식까지 — 손자는 빠진다', async () => {
    const result = await callTool('nerv_spec_tree', { root: 'TRE-1-ROOT', depth: 1 });
    expect(keys(result)).toEqual(['TRE-1-ROOT', 'TRE-2-BRANCH', 'TRE-2-SIB']);
  });

  it('없는 문서를 root 로 주면 not_found 다 — 전체 트리를 주지 않는다', async () => {
    const result = await callTool('nerv_spec_tree', { root: 'TRE-NOPE-XXX' });
    expect(result['ok']).toBe(false);
    expect(result['code']).toBe(NERV_ERROR.PRECONDITION);
    expect(result['details']).toMatchObject({ kind: 'not_found', field: 'root' });
  });

  it('걸러진 트리는 전체보다 작다 — 같으면 걸러지지 않은 것이다', async () => {
    const all = await callTool('nerv_spec_tree', {});
    const scoped = await callTool('nerv_spec_tree', { root: 'TRE-1-ROOT' });
    expect(keys(all).length).toBeGreaterThan(keys(scoped).length);
    expect(keys(scoped)).toHaveLength(4);
  });

  it('around 는 관계 이웃이다 — hops:0 이면 중심 하나', async () => {
    const centre = await callTool('nerv_spec_tree', { around: 'TRE-2-BRANCH', hops: 0 });
    expect(keys(centre)).toEqual(['TRE-2-BRANCH']);
    const near = await callTool('nerv_spec_tree', { around: 'TRE-2-BRANCH', hops: 1 });
    expect(keys(near)).toEqual(['TRE-2-BRANCH', 'TRE-2-SIB']);
  });

  it('around 는 UUID 도 받고, 없는 중심은 not_found 다', async () => {
    expect(keys(await callTool('nerv_spec_tree', { around: leafId, hops: 0 }))).toEqual([
      'TRE-3-LEAF',
    ]);
    const missing = await callTool('nerv_spec_tree', { around: 'TRE-NOPE-XXX' });
    expect(missing['ok']).toBe(false);
    expect(missing['details']).toMatchObject({ kind: 'not_found', field: 'around' });
  });

  it('관계를 청하지 않았으면 간선은 싣지 않는다 — 청하면 좁혀진 간선이 온다', async () => {
    const plain = await callTool('nerv_spec_tree', { around: 'TRE-2-BRANCH', hops: 1 });
    expect(plain['edges']).toBeUndefined();
    const withEdges = await callTool('nerv_spec_tree', {
      around: 'TRE-2-BRANCH',
      hops: 1,
      include_relations: true,
    });
    expect(withEdges['edges']).toEqual([
      { from_id: branchId, to_id: siblingId, kind: 'depends_on' },
    ]);
  });

  it('include_relations 는 root 와 함께 좁혀진다 — 노드 밖 간선은 남지 않는다', async () => {
    const result = await callTool('nerv_spec_tree', {
      root: 'TRE-2-BRANCH',
      include_relations: true,
    });
    expect(keys(result)).toEqual(['TRE-2-BRANCH', 'TRE-3-LEAF']);
    // TRE-2-SIB 이 밖에 있으므로 그 간선은 빠진다
    expect(result['edges']).toEqual([]);
  });

  it('hops 만 주면 거절한다 — 아무 일도 안 하고 성공하는 것이 ① 그 자체다', async () => {
    const result = await callTool('nerv_spec_tree', { hops: 2 });
    expect(result['ok']).toBe(false);
    expect(result['details']).toMatchObject({ kind: 'invalid_input', requires: ['around'] });
  });

  it('스키마가 적어 둔 범위대로 거절한다 — maximum:3 이 장식이 아니게', async () => {
    const result = await callTool('nerv_spec_tree', { around: 'TRE-2-BRANCH', hops: 9 });
    expect(result['ok']).toBe(false);
    expect(result['details']).toMatchObject({ field: 'hops', allowed: { minimum: 0, maximum: 3 } });
  });

  it('계층과 관계는 다른 축이다 — around 와 root 를 섞으면 거절한다', async () => {
    const result = await callTool('nerv_spec_tree', { around: 'TRE-2-BRANCH', root: 'TRE-1-ROOT' });
    expect(result['ok']).toBe(false);
    expect(result['details']).toMatchObject({ conflict: ['around', 'root'] });
  });

  it('스키마 밖의 이름은 여전히 유령이라고 말한다 — root_spec_id 가 그것이었다', async () => {
    const result = await callTool('nerv_spec_tree', { root_spec_id: 'TRE-1-ROOT' });
    expect(result['ok']).toBe(true);
    expect(result['ignored_args']).toEqual(['root_spec_id']);
  });
});

describe('E03-S03 훅 세션 채택 — 두 평면이 한 세션을 쓴다', () => {
  async function clearSessions(): Promise<void> {
    await pool.query(`UPDATE agent_session SET state = 'stale' WHERE project_id = $1`, [projectId]);
  }

  async function sessionStartHook(
    external: string,
    hostname: string,
    cwd: string,
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/hooks/session',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-nerv-host': hostname,
        'x-nerv-agent': 'claude-code',
      },
      payload: { session_id: external, cwd },
    });
    return String((res.json() as Record<string, unknown>)['session_id']);
  }

  it('bootstrap 이 훅 세션을 채택한다 — 세션은 하나로 남는다', async () => {
    await clearSessions();
    const hookSession = await sessionStartHook('S-hook-adopt', 'mac-adopt', '/work/clemvion');

    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-adopt',
      cwd: '/work/clemvion',
      branch: 'fix/adopt',
    });

    expect(boot['session_id']).toBe(hookSession);
    expect(boot['resumed']).toBe(true);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_session
        WHERE project_id = $1 AND state IN ('pending','active','awaiting_input')`,
      [projectId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('채택한 세션에 신원을 채운다 — 훅 페이로드에는 branch·worktree·model 이 없다', async () => {
    await clearSessions();
    const hookSession = await sessionStartHook('S-hook-identity', 'mac-id', '/work/clemvion');

    await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-id',
      cwd: '/work/clemvion',
      branch: 'feat/identity',
      worktree_path: '/work/clemvion',
      model: 'claude-opus-5',
    });

    const { rows } = await pool.query<{
      branch: string | null;
      worktree_path: string | null;
      model: string | null;
    }>(`SELECT branch, worktree_path, model FROM agent_session WHERE id = $1`, [hookSession]);
    expect(rows[0]).toMatchObject({
      branch: 'feat/identity',
      worktree_path: '/work/clemvion',
      model: 'claude-opus-5',
    });
  });

  it('채택 뒤 첫 클레임이 막히지 않는다 — 이 스위트가 지키려는 것', async () => {
    await clearSessions();
    await sessionStartHook('S-hook-claim', 'mac-claim', '/work/clemvion');
    await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-claim',
      cwd: '/work/clemvion',
    });

    const question = await callTool('nerv_question_create', {
      question: '채택된 세션의 질문',
      urgency: 'normal',
    });
    expect(question['ok']).toBe(true);
  });

  // 실측 2026-09-03: 같은 사람·같은 cwd 에서 겹친 실사용 쌍 14건 중 10건에서 **나중에
  // 등록된 세션은 활동이 0인 유령**이었다(나중 세션이 유일한 활동 주체인 경우는 0건).
  // 등록 시각만 보면 그 유령을 고른다 — 일한 흔적이 1순위여야 하는 이유다.
  it('활동이 있는 세션을 고른다 — 나중에 등록된 빈 세션이 아니라', async () => {
    await clearSessions();
    const worker = await sessionStartHook('S-worker', 'mac-pick', '/work/clemvion');
    // 앞선 세션이 도구를 쓴다(훅 평면의 활동)
    await pool.query(
      `INSERT INTO activity (id, session_id, project_id, seq, type, title, created_at)
       VALUES ($1,$2,$3,1,'action','Read(spec)', now())`,
      [newId(), worker, projectId],
    );
    // 그 뒤 유령이 등록된다 — 활동은 하나도 없다
    const phantom = await sessionStartHook('S-phantom', 'mac-pick', '/work/clemvion');
    expect(phantom).not.toBe(worker);

    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-pick',
      cwd: '/work/clemvion',
    });
    expect(boot['session_id']).toBe(worker);
  });

  it('cwd 를 말하지 않으면 채택하지 않는다 — hostname 만으로 고르는 가지는 닫혀 있다', async () => {
    await clearSessions();
    await sessionStartHook('S-nocwd', 'mac-nocwd', '/work/clemvion');

    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-nocwd',
    });
    expect(boot['resumed']).toBe(false);
  });

  it('다른 호스트·다른 cwd 는 채택하지 않는다 — 남의 세션을 삼키면 오귀속이다', async () => {
    await clearSessions();
    await sessionStartHook('S-hook-other', 'mac-one', '/work/clemvion');

    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-two',
      cwd: '/work/clemvion',
    });
    expect(boot['resumed']).toBe(false);

    const elsewhere = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-one',
      cwd: '/work/other-repo',
    });
    expect(elsewhere['resumed']).toBe(false);
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

  // 2026-08-30 사람 보고 — "에이전트가 task 조작을 하지 못한다". 핸들러는 `evidence`·
  // `blocked_reason`·`spec_impact` 를 **처음부터 읽고 있었는데 스키마에 없었다**.
  // 도구는 스키마를 읽으므로, 적히지 않은 입력은 애초에 실리지 않는다 —
  // done 게이트가 증적을 요구하는데 증적을 실을 길이 없던 것이 그 결과다.
  it('done 은 증적을 싣는다 — 스키마에 없던 입력이 계약이 된다', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-09',
      external_session_id: 'S-evidence',
    });
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-evi','증적','in_progress','목표','PR','nerv_spec_get','경계')`,
      [taskId, projectId],
    );

    const done = await callTool('nerv_task_update', {
      session_id: boot['session_id'],
      task_id: taskId,
      status: 'done',
      evidence: [
        { kind: 'commit', locator: 'a1b2c3d' },
        { kind: 'test', locator: 'spec-concurrency.spec.ts' },
      ],
      spec_impact: { none: true },
    });
    expect(done['status']).toBe('done');
    const { rows } = await pool.query<{ kind: string; locator: string }>(
      `SELECT kind::text AS kind, locator FROM evidence WHERE task_id = $1 ORDER BY kind`,
      [taskId],
    );
    expect(rows.map((r) => `${r.kind}:${r.locator}`)).toEqual([
      'commit:a1b2c3d',
      'test:spec-concurrency.spec.ts',
    ]);
  });

  // 2026-08-30 사람 결정 — MCP 표면이 REST 의 **부분집합**이었다: 만들기·읽기가 없었다.
  it('만들고 읽는다 — 에이전트가 자기 일 밖의 건을 남길 수 있다', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-11',
      external_session_id: 'S-create',
    });
    const made = await callTool('nerv_task_create', {
      session_id: boot['session_id'],
      title: '리스 해제 경로에 테스트가 없다',
      goal_md: '해제 경로 L2 를 세운다',
      output_format_md: 'PR',
      tools_sources_md: 'nerv_spec_get',
      boundaries_md: '스키마는 건드리지 않는다',
      priority: 'P1',
    });
    // 만들자마자 누가 집어 가지 않는다 — 4요소가 차야 서버가 ready 로 올린다(D-09)
    expect(made['status']).toBe('backlog');
    expect(made['key']).toEqual(expect.any(String));

    // 키로도 UUID 로도 읽는다(§1.4b) — 옆 도구들과 같은 규칙이다
    const byKey = await callTool('nerv_task_get', {
      session_id: boot['session_id'],
      task_id: made['key'],
    });
    const byId = await callTool('nerv_task_get', {
      session_id: boot['session_id'],
      task_id: made['task_id'],
    });
    expect(byKey['title']).toBe('리스 해제 경로에 테스트가 없다');
    expect(byId['id']).toBe(made['task_id']);
    expect(byKey['goal_md']).toBe('해제 경로 L2 를 세운다');
  });

  // 2026-08-30 사람 요청 — "이 프로젝트에 지금 무엇이 도는가" 를 물을 길이 없었다.
  it('훑는다 — 상태로 거르고, 스펙은 키로도 가리킨다', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-12',
      external_session_id: 'S-list',
    });
    const specId = newId();
    const versionId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-LISTED','목록')`,
      [specId, projectId],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'approved','# 본문', digest('x','sha256'), $3)`,
      [versionId, specId, userId],
    );
    for (const [key, status] of [
      ['TSK-l1', 'ready'],
      ['TSK-l2', 'in_progress'],
    ]) {
      await pool.query(
        `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id,
                           goal_md, output_format_md, tools_sources_md, boundaries_md)
         VALUES ($1,$2,$3,$3,$4::task_status,$5,'목표','PR','도구','경계')`,
        [newId(), projectId, key, status, versionId],
      );
    }

    const all = await callTool('nerv_task_list', { session_id: boot['session_id'] });
    const keys = (all['items'] as { key: string }[]).map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['TSK-l1', 'TSK-l2']));

    // 상태로 거른다 — 쉼표 목록이다(REST 질의와 같은 모양)
    const running = await callTool('nerv_task_list', {
      session_id: boot['session_id'],
      status: 'in_progress',
    });
    expect((running['items'] as { key: string }[]).map((t) => t.key)).toEqual(['TSK-l2']);

    // **스펙은 키로도 가리킨다**(§1.4b) — 예전에는 UUID 만 받아 키를 넣으면 조용히 0건이었다
    const bySpec = await callTool('nerv_task_list', {
      session_id: boot['session_id'],
      spec: 'SPC-LISTED',
    });
    expect((bySpec['items'] as unknown[]).length).toBe(2);
  });

  it('상태 이름은 열거가 지킨다 — 지어낸 이름은 호출 전에 막힌다', async () => {
    const boot = await callTool('nerv_bootstrap', {
      agent_type: 'claude-code',
      hostname: 'mac-10',
      external_session_id: 'S-badstatus',
    });
    const out = await callTool('nerv_task_update', {
      session_id: boot['session_id'],
      task_id: newId(),
      status: 'completed',
    });
    expect(out).toMatchObject({
      ok: false,
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'invalid_input', not_allowed: ['status'] },
    });
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

describe('응답 상태 코드 — 200 이다 (bin/nerv-outbox 가 읽는다)', () => {
  it('tools/call 성공은 200 · 도구 실패도 200 + isError 다', async () => {
    // Nest 기본값(201)이면 아웃박스 flush 가 "성공도 4xx 도 아니다" 로 읽고 큐를 멈춘다 —
    // 서버가 정상일수록 큐가 비지 않는 상태가 됐다(2026-09-02).
    const ok = await rpc('tools/call', {
      name: 'nerv_spec_tree',
      arguments: { project: 'clemvion' },
    });
    expect(ok.status).toBe(200);

    const bad = await rpc('tools/call', {
      name: 'nerv_spec_get',
      arguments: {},
    });
    expect(bad.status).toBe(200);
    expect((bad.body['result'] as Record<string, unknown>)['isError']).toBe(true);
  });
});
