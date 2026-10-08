// 본문 축소 — 초안 저장 · 사전 검토 · 결재 요청 (api.md REQ-API-270 · 271 · REQ-WEB-297 · 298)
//
// clemvion 에서 두 번 실측된 사고를 재현한다. ① 2026-10-05 용어 사전 v4 — 편집 스크립트가 파일을 비운 뒤 읽어
// 34.7KB 본문이 484바이트 꼬리 조각("빈 줄 둘 + 새 소절")으로 저장되고 검토 요청 · 승인까지 지나갔다. ② 2026-10-08
// 계정 · 워크스페이스 v4 — 생성 도중 끊긴 도구 호출이 86KB 본문의 앞 40줄만 담은 채 실행됐다. 서버는 둘 다 경고 없이
// 받았다. 본문은 합성한다(모양만 실측 그대로다 — 그 프로젝트의 글은 여기 두지 않는다).

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let checks: SpecCheckService;
let approvals: ApprovalService;
let projectId: string;
let planner: string;
let reviewer: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_shrink');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  checks = new SpecCheckService(drizzleDb);
  specs = new SpecService(
    events,
    checks,
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    new AttachmentService(null as never, drizzleDb),
    drizzleDb,
  );
  approvals = new ApprovalService(events, specs, new AuthService(drizzleDb), drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM approval');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM requirement_version');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
});

/** 문서 제목 하나 + 절 `sections` 개 · 절마다 문단 하나와 요구사항 `reqsPer` 줄 — 한 절이 1.3KB 남짓이다 */
function specBody(sections: number, reqsPer = 0): string {
  const lines: string[] = ['> 구현 상태: 구현됨', '', '# 문서', ''];
  let n = 0;
  for (let s = 1; s <= sections; s += 1) {
    lines.push(`## ${s}. 절 ${s}`, '', `이 절은 ${s}번째 규칙을 적는다. `.repeat(30), '');
    for (let r = 0; r < reqsPer; r += 1) {
      n += 1;
      const ref = `REQ-WSPACE-${String(n).padStart(3, '0')}`;
      lines.push(`- ${ref} WHEN 조건 ${ref} 이 맞으면 THE SYSTEM SHALL 그 일을 한다.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 용어 사전 v4 에 남은 꼬리 조각 — 빈 줄 둘로 시작하는 소절 하나 */
const FRAGMENT =
  '\n\n### 상태값 표의 건강도 행을 둘로 나눴다 (2026-10-05)\n\n' +
  '「발송·채널 건강도」 한 행을 「발송 건강도」 · 「채널 건강도」 두 행으로 나눴다. 사전에 없는 합성어였다.\n';

async function hashOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(content_hash, 'hex') AS h FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.h;
}

async function bodyOf(versionId: string): Promise<string> {
  const { rows } = await pool.query<{ b: string }>(
    `SELECT body_md AS b FROM spec_version WHERE id = $1`,
    [versionId],
  );
  return rows[0]!.b;
}

/** 문서를 만들고 승인본으로 둔다 — 승인 절차는 이 파일의 주제가 아니다 */
async function approved(key: string, body: string, type = 'convention'): Promise<string> {
  const created = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type,
    bodyMd: body,
    userId: planner,
  });
  const versionId = created['spec_version_id'] as string;
  await pool.query(
    `UPDATE spec_version
        SET status = 'approved', approved_at = now(), approved_by_user_id = $2,
            edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
      WHERE id = $1`,
    [versionId, planner],
  );
  await pool.query(
    `UPDATE spec SET current_version_id = $1 WHERE id = (SELECT spec_id FROM spec_version WHERE id = $1)`,
    [versionId],
  );
  return versionId;
}

/** 승인본 위에 새 초안을 연다 — 지문은 승인본의 것이다 */
async function newDraft(
  key: string,
  approvedVersionId: string,
  body: string,
  allowShrink?: boolean,
): Promise<Record<string, unknown>> {
  return specs.draftUpsert({
    projectId,
    specId: key,
    bodyMd: body,
    baseHash: await hashOf(approvedVersionId),
    userId: planner,
    ...(allowShrink === true ? { allowShrink: true } : {}),
  });
}

async function save(
  key: string,
  versionId: string,
  body: string,
  allowShrink?: boolean,
): Promise<Record<string, unknown>> {
  return specs.draftUpsert({
    projectId,
    specId: key,
    bodyMd: body,
    baseHash: await hashOf(versionId),
    userId: planner,
    ...(allowShrink === true ? { allowShrink: true } : {}),
  });
}

/** 거절의 봉투 — 코드와 details */
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

describe('REQ-API-270 크게 줄이는 저장은 밝힌 것만 받는다', () => {
  it('용어 사전 v4 — 34KB 초안을 꼬리 조각으로 덮는 저장을 거절하고, 초안은 그대로 남는다', async () => {
    const v3 = await approved('CLV-GLOSSARY', specBody(26));
    const full = specBody(26).replace(
      '## 3. 절 3',
      '## 3. 절 3\n\n| 발송 건강도 |\n| 채널 건강도 |',
    );
    const created = await newDraft('CLV-GLOSSARY', v3, full);
    const v4 = created['spec_version_id'] as string;

    const refused = await rejection(save('CLV-GLOSSARY', v4, FRAGMENT));
    expect(refused.code).toBe(NERV_ERROR.PRECONDITION);
    expect(refused.details).toMatchObject({
      kind: 'body_shrunk',
      allow_with: 'allow_shrink',
      body_change: { shrunk: ['bytes', 'headings'], after: { headings: 1 } },
      // 다시 읽을 곳을 함께 준다 — 의도하지 않았으면 전체 본문으로 다시 보낸다
      reread: { tool: 'nerv_spec_get', args: { spec_id: 'CLV-GLOSSARY', version: 2 } },
    });
    expect(await bodyOf(v4)).toBe(full);
  });

  it('계정 · 워크스페이스 v4 — 앞 40줄만 담긴 저장(줄 가운데서 끊김)을 거절한다', async () => {
    const v3 = await approved('CLV-ACCT-WS', specBody(46, 2), 'feature');
    const full = specBody(46, 2);
    const created = await newDraft('CLV-ACCT-WS', v3, `${full}\n추가 한 줄.\n`);
    const v4 = created['spec_version_id'] as string;
    const cut = full.split('\n').slice(0, 40).join('\n').slice(0, -12);

    const refused = await rejection(save('CLV-ACCT-WS', v4, cut));
    expect(refused.details).toMatchObject({
      kind: 'body_shrunk',
      body_change: { shrunk: ['bytes', 'headings', 'requirements'] },
    });
    const change = refused.details['body_change'] as { requirements_kept: number };
    expect(change.requirements_kept).toBeLessThan(92 / 2);
  });

  it('새 초안을 여는 저장도 같다 — 직전 버전과 견준다', async () => {
    const v3 = await approved('CLV-OPEN', specBody(20));
    const refused = await rejection(newDraft('CLV-OPEN', v3, FRAGMENT));
    expect(refused.details).toMatchObject({ kind: 'body_shrunk' });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM spec_version sv JOIN spec s ON s.id = sv.spec_id WHERE s.key = 'CLV-OPEN'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('allow_shrink 를 준 저장은 받고, 확인 기록과 이벤트를 남긴다', async () => {
    const v1 = await approved('CLV-SPLIT', specBody(30));
    const created = await newDraft('CLV-SPLIT', v1, specBody(30));
    const v2 = created['spec_version_id'] as string;

    const saved = await save('CLV-SPLIT', v2, specBody(4), true);
    expect(saved['body_change']).toMatchObject({ shrunk: ['bytes', 'headings'] });
    const { rows } = await pool.query(
      `SELECT shrink_ack_at IS NOT NULL AS acked, shrink_ack_user_id FROM spec_version WHERE id = $1`,
      [v2],
    );
    expect(rows[0]).toMatchObject({ acked: true, shrink_ack_user_id: planner });
    const { rows: ev } = await pool.query(
      `SELECT payload FROM event WHERE type = $1 AND subject_id = $2`,
      [NERV_EVENT.SPEC_DRAFT_UPDATED, v2],
    );
    expect(ev[0].payload).toMatchObject({ shrink_allowed: true });
  });

  it('줄이지 않는 저장에 붙인 allow_shrink 는 확인을 남기지 않는다 — 습관처럼 붙인 인자가 미리 면제하지 않게', async () => {
    const v1 = await approved('CLV-HABIT', specBody(10));
    const created = await newDraft('CLV-HABIT', v1, specBody(10), true);
    const { rows } = await pool.query(`SELECT shrink_ack_at FROM spec_version WHERE id = $1`, [
      created['spec_version_id'],
    ]);
    expect(rows[0].shrink_ack_at).toBeNull();
  });

  it(`덮어쓸 본문이 작으면 보지 않는다 — 자리표시 본문은 통째로 다시 쓴다`, async () => {
    const v1 = await approved('CLV-AREA', '# 영역\n\n## 하위 문서\n\n- 하나\n- 둘\n', 'area');
    const created = await newDraft('CLV-AREA', v1, '# 영역\n');
    expect(created['created']).toBe(true);
  });
});

describe('REQ-API-271 사전 검토는 직전 버전과 견준다', () => {
  it('여러 번에 나눠 줄인 초안 — 저장은 모두 받지만 사전 검토가 block 으로 잡고 검토 요청이 막힌다', async () => {
    const v1 = await approved('CLV-GRADUAL', specBody(30));
    const created = await newDraft('CLV-GRADUAL', v1, specBody(30));
    const v2 = created['spec_version_id'] as string;
    // 한 번에 30% 남짓씩 — 덮어쓴 본문과 견주면 매번 절반 위다
    for (const sections of [21, 15, 11, 8]) await save('CLV-GRADUAL', v2, specBody(sections));

    const result = await checks.check({ projectId, specVersionId: v2 });
    const found = result.findings.filter((f) => f.checker === 'base-continuity');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'block' });
    expect(found[0]!.message).toContain('직전 버전 v1');
    expect(result.body_change).toMatchObject({ base_version_no: 1, acknowledged: false });

    const blocked = await rejection(
      specs.submitReview({ projectId, specVersionId: v2, userId: planner }),
    );
    expect(blocked.details).toMatchObject({ kind: 'precheck_blocked' });

    // 의도한 삭제면 같은 본문을 allow_shrink 로 다시 저장해 확인을 남긴다 → warning
    await save('CLV-GRADUAL', v2, specBody(8), true);
    const after = await checks.check({ projectId, specVersionId: v2 });
    expect(after.findings.find((f) => f.checker === 'base-continuity')).toMatchObject({
      severity: 'warning',
    });
    expect(after.body_change).toMatchObject({ acknowledged: true });
  });

  it('지금 초안보다 줄인 확인은 기록이 되지 않는다 — 직전 버전보다 줄었을 때만 남는다(코드 검토 지적)', async () => {
    // 10절 직전 버전 위에서 30절로 키운 초안을 12절로 줄인다 — 지금 초안보다는 크게 줄었지만 직전 버전보다는 아니다
    const v1 = await approved('CLV-GROWN', specBody(10));
    const created = await newDraft('CLV-GROWN', v1, specBody(30));
    const v2 = created['spec_version_id'] as string;
    await save('CLV-GROWN', v2, specBody(12), true);
    const { rows } = await pool.query(`SELECT shrink_ack_at FROM spec_version WHERE id = $1`, [v2]);
    expect(rows[0].shrink_ack_at).toBeNull();
    // 이벤트에는 확인 인자로 지나간 축소가 남는다 — 누가 언제 지웠는지의 기록이다
    const { rows: ev } = await pool.query(
      `SELECT payload FROM event WHERE type = $1 AND subject_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [NERV_EVENT.SPEC_DRAFT_UPDATED, v2],
    );
    expect(ev[0].payload).toMatchObject({ shrink_allowed: true });

    // 그 뒤 확인 없이 나눠 줄이면(매번 절반 위) 저장은 지나가도 사전 검토가 block 이다 — warning 으로 내려가지 않는다
    for (const sections of [7, 4]) await save('CLV-GROWN', v2, specBody(sections));
    const result = await checks.check({ projectId, specVersionId: v2 });
    expect(result.findings.find((f) => f.checker === 'base-continuity')).toMatchObject({
      severity: 'block',
    });
  });

  it('검사기 여섯이 모두 돌고, 줄지 않은 초안에도 직전 버전과 견준 크기를 준다', async () => {
    const v1 = await approved('CLV-PLAIN', specBody(8));
    const created = await newDraft('CLV-PLAIN', v1, `${specBody(8)}\n한 줄 더.\n`);
    const result = await checks.check({
      projectId,
      specVersionId: created['spec_version_id'] as string,
    });
    expect(Object.keys(result.checkers)).toContain('base-continuity');
    expect(result.findings.filter((f) => f.checker === 'base-continuity')).toEqual([]);
    expect(result.body_change).toMatchObject({ base_version_no: 1, shrunk: [] });
  });

  it('첫 버전에는 견줄 버전이 없다', async () => {
    const created = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'CLV-FIRST',
      title: 'CLV-FIRST',
      type: 'feature',
      bodyMd: specBody(3),
      userId: planner,
    });
    const result = await checks.check({
      projectId,
      specVersionId: created['spec_version_id'] as string,
    });
    expect(result.body_change).toBeNull();
  });
});

describe('REQ-API-273 축소 신호 — 크게 줄어든 버전은 사람이 한 번 본다 (2026-10-09 사람 결정)', () => {
  it('요구사항 없는 design 문서(T0)를 확인하고 크게 줄이면 T2 로 결재 대기에 간다', async () => {
    const v1 = await approved('CLV-DSN-CUT', specBody(30), 'design');
    const created = await newDraft('CLV-DSN-CUT', v1, specBody(30));
    const v2 = created['spec_version_id'] as string;
    await save('CLV-DSN-CUT', v2, specBody(4), true);

    const submitted = await specs.submitReview({ projectId, specVersionId: v2, userId: planner });
    expect(submitted.status).toBe('in_review');
    expect(submitted.gate).toMatchObject({ tier: 'T2', score: 1, signals: ['body_shrunk'] });
    const { rows } = await pool.query(
      `SELECT payload FROM event WHERE type = $1 AND subject_id = $2`,
      [NERV_EVENT.SPEC_SUBMITTED, v2],
    );
    expect(rows[0].payload).toMatchObject({ gate_tier: 'T2', gate_signals: ['body_shrunk'] });
  });

  it('줄지 않은 같은 문서는 그대로 T0 이라 사람 없이 통과한다 — 신호가 아무 데나 서지 않는다', async () => {
    const v1 = await approved('CLV-DSN-EDIT', specBody(30), 'design');
    const created = await newDraft('CLV-DSN-EDIT', v1, `${specBody(30)}\n한 줄 더.\n`);
    const submitted = await specs.submitReview({
      projectId,
      specVersionId: created['spec_version_id'] as string,
      userId: planner,
    });
    expect(submitted.status).toBe('approved');
    expect(submitted.gate).toMatchObject({ tier: 'T0', signals: [] });
  });
});

describe('REQ-WEB-298 결재 요청이 직전 버전과 견준 크기를 남긴다', () => {
  it('확인하고 크게 줄인 초안의 결재 카드에 body_change 가 온다', async () => {
    const v1 = await approved('CLV-CARD', specBody(30));
    const created = await newDraft('CLV-CARD', v1, specBody(30));
    const v2 = created['spec_version_id'] as string;
    await save('CLV-CARD', v2, specBody(4), true);

    const submitted = await specs.submitReview({ projectId, specVersionId: v2, userId: planner });
    expect(submitted.status).toBe('in_review');

    const { items } = await approvals.inbox({
      projectId,
      userId: reviewer,
      actor: { userId: reviewer, isAgent: false },
    });
    const card = items.find((c) => c['spec_key'] === 'CLV-CARD');
    expect(card?.['body_change']).toMatchObject({
      base_version_no: 1,
      acknowledged: true,
      shrunk: ['bytes', 'headings'],
      before: { headings: 31 },
      after: { headings: 5 },
    });
  });

  it('스펙 목록의 결재 대기(EP-SPEC-26)도 같은 값을 준다 — 일괄 결정의 확인 목록이 읽는다', async () => {
    const v1 = await approved('CLV-PENDING', specBody(30));
    const created = await newDraft('CLV-PENDING', v1, specBody(30));
    const v2 = created['spec_version_id'] as string;
    await save('CLV-PENDING', v2, specBody(4), true);
    await specs.submitReview({ projectId, specVersionId: v2, userId: planner });

    const { items } = await approvals.pendingSpecApprovals({
      projectId,
      userId: reviewer,
      actor: { userId: reviewer, isAgent: false },
    });
    expect(items.find((r) => r['spec_key'] === 'CLV-PENDING')?.['body_change']).toMatchObject({
      shrunk: ['bytes', 'headings'],
      acknowledged: true,
    });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [planner, 'jimin@example.com', '지민'],
    [reviewer, 'sora@example.com', '소라'],
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
  for (const user of [planner, reviewer]) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), orgId, projectId, user],
    );
  }
}
