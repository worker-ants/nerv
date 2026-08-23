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
    const specId = String(
      ((made.body['result'] as { structuredContent?: Record<string, unknown> }).structuredContent ??
        {})['spec_id'],
    );

    // 같은 값이면 통과한다 — 멱등 재호출이 여기서 걸리면 안 된다
    const same = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: { spec_id: specId, title: '원래 제목', body_md: '# 원래 제목\n\n고친 본문' },
    });
    expect((same.body['result'] as { isError?: boolean }).isError ?? false).toBe(false);

    // 다른 값이면 거부한다. 조용히 무시하면 부른 쪽은 옮겨졌다고 믿는다
    const changed = await rpc('tools/call', {
      name: 'nerv_spec_draft_upsert',
      arguments: { spec_id: specId, title: '바뀐 제목', body_md: '# 바뀐 제목\n\n본문' },
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

  it('세션 없이 클레임하면 막고 bootstrap 을 가리킨다 — 모델이 스스로 고칠 수 있게', async () => {
    const result = await callTool('nerv_task_claim', { task_id: newId() });
    expect(result).toMatchObject({ ok: false, code: NERV_ERROR.PRECONDITION });
    expect(result['details']).toMatchObject({ kind: 'session_required' });
    expect(result['next_actions']).toEqual(['nerv_bootstrap']);
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
