// 되돌리기 — 옛 버전의 본문으로 새 초안을 만든다 (api.md REQ-API-308 · EP-SPEC-30 · 2026-10-15 사람 결정)
//
// 승인본을 직접 되돌리지 않는다. 서버가 옛 버전의 본문을 바이트 그대로 복사해 **새 초안**을 만들고, 그 초안은 보통
// 게이트(제출 → 판정 → 결재)를 지난다. 여기서 보는 것: 정확한 복사와 기록 · 검토 중이면 409 · 열린 초안이 있으면
// 거절 · 권한(viewer 거절) · 크게 줄어든 본문도 받되 제출하면 축소 신호 · 제출 · 승인 이벤트에 되살린 버전 번호.

import { createHash } from 'node:crypto';
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let specs: SpecService;
let checks: SpecCheckService;
let approvals: ApprovalService;
let projectId: string;
let planner: string;
let reviewer: string;
let viewer: string;
let plannerToken: string;
let viewerToken: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_revert');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  specs = app.get(SpecService);
  checks = app.get(SpecCheckService);
  approvals = app.get(ApprovalService);

  const auth = app.get(AuthService);
  plannerToken = (
    await auth.issueToken({
      projectId,
      userId: planner,
      name: 'planner-pat',
      scopes: ['spec:read', 'spec:draft'],
    })
  ).token;
  viewerToken = (
    await auth.issueToken({ projectId, userId: viewer, name: 'viewer-pat', scopes: ['spec:read'] })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM approval');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM requirement_version');
  await pool.query('DELETE FROM requirement');
  // 변경 요청이 초안을 감싼다(2026-10-16) — 버전과 서로를 가리키므로 먼저 푼다
  await pool.query('UPDATE spec_version SET change_request_id = NULL');
  await pool.query('DELETE FROM change_request');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
});

/** 절 `sections` 개짜리 본문 — 한 절이 1.3KB 남짓이다 */
function specBody(sections: number, tail = ''): string {
  const lines: string[] = ['# 문서', ''];
  for (let s = 1; s <= sections; s += 1) {
    lines.push(`## ${s}. 절 ${s}`, '', `이 절은 ${s}번째 규칙을 적는다. `.repeat(30), '');
  }
  return lines.join('\n') + tail;
}

async function hashOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

async function row(versionId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT version_no, status::text AS status, body_md, encode(content_hash, 'hex') AS hash,
            reverted_to_version_no, base_version_id, change_summary_md,
            shrink_ack_at IS NOT NULL AS acked, shrink_ack_user_id
       FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0] as Record<string, unknown>;
}

/** 버전을 승인본으로 둔다 — 앞선 승인본은 대체됨으로 민다. 승인 절차는 이 파일의 주제가 아니다 */
async function approve(versionId: string): Promise<void> {
  await pool.query(
    `UPDATE spec_version SET status = 'superseded'
      WHERE status = 'approved' AND spec_id = (SELECT spec_id FROM spec_version WHERE id = $1)`,
    [versionId],
  );
  await pool.query(
    `UPDATE spec_version
        SET status = 'approved', approved_at = now(), approved_by_user_id = $2,
            edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
      WHERE id = $1`,
    [versionId, reviewer],
  );
  await pool.query(
    `UPDATE spec SET current_version_id = $1 WHERE id = (SELECT spec_id FROM spec_version WHERE id = $1)`,
    [versionId],
  );
}

/** 승인본 버전 `bodies.length` 개짜리 문서 — 버전 id 를 차례로 돌려준다 */
async function history(key: string, bodies: string[], type = 'design'): Promise<string[]> {
  const ids: string[] = [];
  for (const body of bodies) {
    const saved =
      ids.length === 0
        ? await specs.draftUpsert({
            roles: ['planner'],
            projectId,
            key,
            title: key,
            type,
            bodyMd: body,
            userId: planner,
          })
        : await specs.draftUpsert({
            projectId,
            specId: key,
            bodyMd: body,
            baseHash: await hashOf(ids[ids.length - 1]!),
            userId: planner,
            allowShrink: true,
          });
    const id = saved['spec_version_id'] as string;
    await approve(id);
    ids.push(id);
  }
  return ids;
}

async function rejection(
  call: Promise<unknown>,
): Promise<{ code: string; details: Record<string, unknown> }> {
  try {
    await call;
  } catch (error) {
    const e = error as { code: string; details: Record<string, unknown> };
    return { code: e.code, details: e.details };
  }
  throw new Error('거절되지 않았다');
}

async function payloadOf(type: string, subjectId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT payload FROM event WHERE type = $1 AND subject_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
    [type, subjectId],
  );
  return (rows[0]?.payload ?? {}) as Record<string, unknown>;
}

describe('REQ-API-308 되돌리기 — 옛 버전의 본문을 그대로 복사한 새 초안', () => {
  it('바이트 그대로 복사하고, 되살린 버전 · 계보 · 기본 요약을 버전과 이벤트에 남긴다', async () => {
    // 끝의 공백 · 빈 줄 · 줄바꿈 종류까지 같아야 한다 — 다시 쓴 본문이 아니라 복사다
    const v1Body = '# 문서\r\n\r\n첫 버전의 문장.  \n\n- 항목\t하나\n\n\n';
    const [v1, v2] = await history('RV-COPY', [v1Body, '# 문서\n\n둘째 버전의 문장.\n']);

    const result = await specs.revertToVersion({
      projectId,
      specId: 'RV-COPY',
      versionNo: 1,
      baseHash: await hashOf(v2!),
      userId: planner,
    });
    expect(result).toMatchObject({ version_no: 3, created: true, reverted_to_version_no: 1 });
    const v3 = result['spec_version_id'] as string;
    const created = await row(v3);
    expect(created['body_md']).toBe(v1Body);
    expect(created['hash']).toBe(await hashOf(v1!));
    expect(created['hash']).toBe(createHash('sha256').update(v1Body, 'utf8').digest('hex'));
    expect(created).toMatchObject({
      status: 'draft',
      reverted_to_version_no: 1,
      // 계보는 되돌림이 덮는 최신 버전이다 — 사전 검토 · 축소 신호가 그것과 견준다
      base_version_id: v2,
      change_summary_md: 'v1 본문으로 되돌림',
    });
    expect(await payloadOf(NERV_EVENT.SPEC_DRAFT_CREATED, v3)).toMatchObject({
      reverted_to_version_no: 1,
      change_summary: 'v1 본문으로 되돌림',
    });
    // 버전 목록이 "v1 본문으로 되돌림" 을 보일 수 있게 준다
    const list = await specs.versions({ projectId, specKey: 'RV-COPY' });
    expect(list.find((v) => v['version_no'] === 3)).toMatchObject({ reverted_to_version_no: 1 });
  });

  it('요약을 주면 그것을 쓴다', async () => {
    const [, v2] = await history('RV-SUMMARY', ['# 하나\n', '# 둘\n']);
    const result = await specs.revertToVersion({
      projectId,
      specId: 'RV-SUMMARY',
      versionNo: 1,
      baseHash: await hashOf(v2!),
      changeSummary: '둘째 버전의 표기 실험을 되돌린다',
      userId: planner,
    });
    expect((await row(result['spec_version_id'] as string))['change_summary_md']).toBe(
      '둘째 버전의 표기 실험을 되돌린다',
    );
  });

  it('검토 중인 버전이 있으면 초안 저장과 같은 409 in_review_pending 이다', async () => {
    const [, v2] = await history('RV-REVIEW', ['# 하나\n', '# 둘\n']);
    const draft = await specs.draftUpsert({
      projectId,
      specId: 'RV-REVIEW',
      bodyMd: '# 셋\n',
      baseHash: await hashOf(v2!),
      userId: planner,
    });
    await pool.query(
      `UPDATE spec_version SET status = 'in_review', submitted_at = now(),
                        edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
                      WHERE id = $1`,
      [draft['spec_version_id']],
    );

    const refused = await rejection(
      specs.revertToVersion({
        projectId,
        specId: 'RV-REVIEW',
        versionNo: 1,
        baseHash: await hashOf(v2!),
        userId: planner,
      }),
    );
    expect(refused.code).toBe(NERV_ERROR.PRECONDITION);
    expect(refused.details).toMatchObject({ kind: 'in_review_pending', version_no: 3 });
  });

  it('열린 초안이 있으면 덮지 않고 거절한다 — 그 초안의 번호를 준다', async () => {
    const [, v2] = await history('RV-OPEN', ['# 하나\n', '# 둘\n']);
    const draft = await specs.draftUpsert({
      projectId,
      specId: 'RV-OPEN',
      bodyMd: '# 남이 쓰는 초안\n',
      baseHash: await hashOf(v2!),
      userId: reviewer,
    });

    const refused = await rejection(
      specs.revertToVersion({
        projectId,
        specId: 'RV-OPEN',
        versionNo: 1,
        baseHash: await hashOf(v2!),
        userId: planner,
      }),
    );
    expect(refused.details).toMatchObject({
      kind: 'open_draft_exists',
      version_no: 3,
      spec_version_id: draft['spec_version_id'],
    });
    expect(String(refused.details['web_url'])).toContain('RV-OPEN');
    // 초안은 그대로이고 버전도 늘지 않았다
    expect((await row(draft['spec_version_id'] as string))['body_md']).toBe('# 남이 쓰는 초안\n');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM spec_version sv JOIN spec s ON s.id = sv.spec_id WHERE s.key = 'RV-OPEN'`,
    );
    expect(rows[0].n).toBe(3);
  });

  it('지금 최신과 본문이 같으면 되돌릴 것이 없다 · 없는 버전은 not_found 다', async () => {
    const [, v2] = await history('RV-SAME', [
      '# 같은 본문\n',
      '# 다른 본문\n',
      '# 같은 본문\n',
    ]).then((ids) => [ids[0], ids[2]]);
    const same = await rejection(
      specs.revertToVersion({
        projectId,
        specId: 'RV-SAME',
        versionNo: 1,
        baseHash: await hashOf(v2!),
        userId: planner,
      }),
    );
    expect(same.details).toMatchObject({
      kind: 'revert_no_change',
      version_no: 1,
      latest_version_no: 3,
    });
    const missing = await rejection(
      specs.revertToVersion({
        projectId,
        specId: 'RV-SAME',
        versionNo: 9,
        baseHash: await hashOf(v2!),
        userId: planner,
      }),
    );
    expect(missing.details).toMatchObject({ kind: 'not_found', field: 'revert_to_version' });
  });

  it('지문은 지금 최신 버전의 것이어야 한다 — 없으면 base_hash_required, 낡았으면 stale_body', async () => {
    const [v1, v2] = await history('RV-HASH', ['# 하나\n', '# 둘\n']);
    const naked = await rejection(
      specs.revertToVersion({ projectId, specId: 'RV-HASH', versionNo: 1, userId: planner }),
    );
    expect(naked.details).toMatchObject({ kind: 'base_hash_required', current_version_no: 2 });
    const stale = await rejection(
      specs.revertToVersion({
        projectId,
        specId: 'RV-HASH',
        versionNo: 1,
        baseHash: await hashOf(v1!),
        userId: planner,
      }),
    );
    expect(stale.details).toMatchObject({
      kind: 'stale_body',
      reread: { tool: 'nerv_spec_get', args: { spec_id: 'RV-HASH', version: 2 } },
    });
    expect(await hashOf(v2!)).toBeTruthy();
  });

  it('크게 줄어든 본문도 allow_shrink 없이 받고 확인을 남긴다 — 사전 검토는 warning, 제출하면 축소 신호로 T2 다', async () => {
    const [, v2] = await history('RV-SHRINK', [
      '# 문서\n\n## 1. 짧은 절\n\n한 문장.\n',
      specBody(30),
    ]);
    const result = await specs.revertToVersion({
      projectId,
      specId: 'RV-SHRINK',
      versionNo: 1,
      baseHash: await hashOf(v2!),
      userId: planner,
    });
    expect(result['body_change']).toMatchObject({ shrunk: ['bytes', 'headings'] });
    const v3 = result['spec_version_id'] as string;
    expect(await row(v3)).toMatchObject({ acked: true, shrink_ack_user_id: planner });
    expect(await payloadOf(NERV_EVENT.SPEC_DRAFT_CREATED, v3)).toMatchObject({
      shrink_allowed: true,
    });

    const check = await checks.check({ projectId, specVersionId: v3 });
    expect(check.findings.find((f) => f.checker === 'base-continuity')).toMatchObject({
      severity: 'warning',
    });

    // design 문서(요구사항 없음)는 축으로는 T0 이다 — 축소 신호가 바닥을 T2 로 올린다(REQ-API-273)
    const submitted = await specs.submitReview({ projectId, specVersionId: v3, userId: planner });
    expect(submitted.status).toBe('in_review');
    expect(submitted.gate).toMatchObject({ tier: 'T2', signals: ['body_shrunk'] });
    expect(await payloadOf(NERV_EVENT.SPEC_SUBMITTED, v3)).toMatchObject({
      gate_tier: 'T2',
      reverted_to_version_no: 1,
    });

    // 결재가 승인하면 승인 이벤트도 같은 값을 남긴다
    const approvalId = submitted.approval_id as string;
    await approvals.decide({
      actor: { userId: reviewer, isAgent: false },
      projectId,
      approvalId,
      userId: reviewer,
      decision: 'approve',
    });
    expect((await row(v3))['status']).toBe('approved');
    expect(await payloadOf(NERV_EVENT.SPEC_APPROVED, v3)).toMatchObject({
      gate_tier: 'T2',
      reverted_to_version_no: 1,
    });
  });

  it('자동 통과(T0)도 승인 이벤트에 되살린 버전을 남긴다 · 되돌리지 않은 버전에는 그 칸이 없다', async () => {
    const [, v2] = await history('RV-AUTO', [specBody(3), specBody(3, '\n한 줄 더.\n')]);
    const result = await specs.revertToVersion({
      projectId,
      specId: 'RV-AUTO',
      versionNo: 1,
      baseHash: await hashOf(v2!),
      userId: planner,
    });
    const v3 = result['spec_version_id'] as string;
    const submitted = await specs.submitReview({ projectId, specVersionId: v3, userId: planner });
    expect(submitted.status).toBe('approved');
    expect(await payloadOf(NERV_EVENT.SPEC_APPROVED, v3)).toMatchObject({
      auto_passed: true,
      reverted_to_version_no: 1,
    });

    // 보통 초안의 제출에는 칸이 없다
    const plain = await specs.draftUpsert({
      projectId,
      specId: 'RV-AUTO',
      bodyMd: specBody(3, '\n또 한 줄.\n'),
      baseHash: await hashOf(v3),
      userId: planner,
    });
    await specs.submitReview({
      projectId,
      specVersionId: plain['spec_version_id'] as string,
      userId: planner,
    });
    expect(
      await payloadOf(NERV_EVENT.SPEC_SUBMITTED, plain['spec_version_id'] as string),
    ).not.toHaveProperty('reverted_to_version_no');
  });
});

describe('EP-SPEC-30 · nerv_spec_draft_upsert(revert_to_version) — 두 표면이 같은 자리를 부른다', () => {
  async function call(
    url: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload,
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function tool(
    args: Record<string, unknown>,
    token = plannerToken,
  ): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': '2026-07-28',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'nerv_spec_draft_upsert', arguments: args },
      },
    });
    const body = res.json() as { result: { structuredContent: Record<string, unknown> } };
    return body.result.structuredContent;
  }

  it('viewer 는 되돌리지 못한다 — 권한은 초안 저장과 같은 spec:draft 다', async () => {
    const [, v2] = await history('RV-ROLE', ['# 하나\n', '# 둘\n']);
    const denied = await call(
      '/api/v1/projects/clemvion/specs/RV-ROLE/versions/1/revert',
      viewerToken,
      {
        base_hash: await hashOf(v2!),
      },
    );
    expect(denied.status).toBe(403);
    expect(denied.body['code']).toBe(NERV_ERROR.FORBIDDEN);

    const made = await call(
      '/api/v1/projects/clemvion/specs/RV-ROLE/versions/1/revert',
      plannerToken,
      {
        base_hash: await hashOf(v2!),
      },
    );
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ version_no: 3, reverted_to_version_no: 1 });
  });

  it('MCP 는 revert_to_version 으로 같은 일을 하고, 본문을 함께 주면 거절한다', async () => {
    const [, v2] = await history('RV-MCP', ['# 하나\n', '# 둘\n']);
    const withBody = await tool({
      spec_id: 'RV-MCP',
      revert_to_version: 1,
      base_hash: await hashOf(v2!),
      body_markdown: '# 섞어 보낸 본문\n',
    });
    expect(withBody).toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'invalid_input', not_allowed: ['body_markdown'] },
    });

    const made = await tool({
      spec_id: 'RV-MCP',
      revert_to_version: 1,
      base_hash: await hashOf(v2!),
    });
    expect(made).toMatchObject({ version_no: 3, created: true, reverted_to_version_no: 1 });
    expect((await row(made['spec_version_id'] as string))['body_md']).toBe('# 하나\n');
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  viewer = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [planner, 'jimin@example.com', '지민'],
    [reviewer, 'sora@example.com', '소라'],
    [viewer, 'view@example.com', '보기만'],
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
    [planner, 'planner'],
    [reviewer, 'planner'],
    [viewer, 'viewer'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), orgId, projectId, user, role],
    );
  }
}
