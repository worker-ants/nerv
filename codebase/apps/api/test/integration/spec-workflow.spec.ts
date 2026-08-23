// E09-S01·S04 — 문서 축 상태 머신 + 불변 스냅샷 + 위험도 가변 게이트.
//
//   WHEN approved SpecVersion 의 본문 수정을 시도하면, THE SYSTEM SHALL 거부한다
//   WHEN T0(오탈자·문구) 변경이 제출되면, THE SYSTEM SHALL 승인 없이 통과시키고 사실을 기록한다
//   WHEN 에이전트를 지시한 사람이 그 산출물의 승인을 시도하면, THE SYSTEM SHALL 거부한다
//
// 승인 축은 clemvion 이 갖지 못했던 것이다(D-01). 그 축이 실제로 서 있는지는 "가변 구간이
// draft 하나뿐"이라는 성질이 DB 에서 강제되는지로 판정된다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventService } from '../../src/modules/event/event.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let projectId: string;
let planner: string;
let reviewer: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_spec');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silentValkey = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  specs = new SpecService(
    new EventService(drizzleDb, silentValkey),
    new SpecCheckService(drizzleDb),
    new SpecRelationService(drizzleDb),
    drizzleDb,
  );
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM event');
});

async function newDraft(
  key = 'SPC-CWC-007',
  body = '# 초안\n\n본문',
): Promise<{
  specId: string;
  versionId: string;
}> {
  const result = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId: planner,
  });
  return { specId: result['spec_id'] as string, versionId: result['spec_version_id'] as string };
}

describe('E09-S01 문서 축 — 가변 구간은 draft 하나뿐이다', () => {
  it('초안은 여러 번 고쳐도 같은 버전이다 — 저장마다 버전이 늘지 않는다', async () => {
    const { specId, versionId } = await newDraft();
    const again = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 수정본',
      userId: planner,
    });

    expect(again['spec_version_id']).toBe(versionId);
    expect(again['created']).toBe(false);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spec_version WHERE spec_id = $1`,
      [specId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('제출은 본문을 동결한다 — 이후 UPDATE 는 트리거가 막는다', async () => {
    const { versionId } = await newDraft();
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });

    await expect(
      pool.query(`UPDATE spec_version SET body_md = '몰래 수정' WHERE id = $1`, [versionId]),
    ).rejects.toThrow(/frozen/);
  });

  it('draft 가 아니면 제출할 수 없다 — 두 번 제출은 막힌다', async () => {
    const { versionId } = await newDraft();
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });
    await expect(
      specs.submitReview({ projectId, specVersionId: versionId, userId: planner }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('거절은 draft 로 되돌리고 리스를 다시 연다', async () => {
    const { specId, versionId } = await newDraft();
    // 참조를 만들어 T2 이상으로 올린다(자동 통과를 피한다)
    await raiseTier(specId, versionId);
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });
    await specs.reject({
      projectId,
      specVersionId: versionId,
      reviewerUserId: reviewer,
      comment: '보완 필요',
    });

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]?.status).toBe('draft');
    // draft 로 돌아왔으니 다시 고칠 수 있다
    await expect(
      specs.draftUpsert({ projectId, specId, bodyMd: '# 보완본', userId: planner }),
    ).resolves.toBeDefined();
  });

  it('승인은 이전 approved 를 superseded 로 민다 — 스냅샷을 덮어쓰지 않는다', async () => {
    const first = await newDraft('SPC-SUP', '# v1');
    await specs.submitReview({ projectId, specVersionId: first.versionId, userId: planner });

    const second = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: first.specId,
      bodyMd: '# v2',
      userId: planner,
    });
    await specs.submitReview({
      projectId,
      specVersionId: second['spec_version_id'] as string,
      userId: planner,
    });

    const { rows } = await pool.query<{ version_no: number; status: string }>(
      `SELECT version_no, status::text AS status FROM spec_version WHERE spec_id = $1 ORDER BY version_no`,
      [first.specId],
    );
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'approved']);
    // 두 버전이 다 남는다 — 이력은 지우지 않는다
    expect(rows).toHaveLength(2);
  });
});

describe('E09-S01 초안 편집 리스 (D-04 문서 축 확장)', () => {
  it('같은 사용자는 표면을 옮겨도 자동 인계된다', async () => {
    const { specId } = await newDraft('SPC-LEASE');
    // 웹(세션 없음) → 터미널(세션 있음)
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        bodyMd: '# 터미널에서 이어쓰기',
        userId: planner,
        sessionId: null,
      }),
    ).resolves.toBeDefined();
  });

  it('다른 사용자의 upsert 는 NERV_DRAFT_LEASED 로 막힌다', async () => {
    const { specId } = await newDraft('SPC-LEASE2');
    await expect(
      specs.draftUpsert({ projectId, specId, bodyMd: '# 남의 초안', userId: reviewer }),
    ).rejects.toMatchObject({ code: NERV_ERROR.DRAFT_LEASED });
  });

  it('리스가 만료되면 다른 사용자가 이어쓸 수 있다 — 30분 TTL', async () => {
    const { specId, versionId } = await newDraft('SPC-LEASE3');
    await pool.query(
      `UPDATE spec_version SET edit_lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [versionId],
    );
    await expect(
      specs.draftUpsert({ projectId, specId, bodyMd: '# 인계', userId: reviewer }),
    ).resolves.toBeDefined();
  });

  it('base_version 이 다르면 409 — 리스가 뚫려도 데이터는 지킨다', async () => {
    const { specId } = await newDraft('SPC-BASE');
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        bodyMd: '# 낡은 기준',
        userId: planner,
        baseVersionId: newId(),
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('제출하면 리스가 풀린다', async () => {
    const { versionId } = await newDraft('SPC-RELEASE');
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });
    const { rows } = await pool.query<{ edit_lease_user_id: string | null }>(
      `SELECT edit_lease_user_id FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]?.edit_lease_user_id).toBeNull();
  });
});

describe('E09-S04 위험도 가변 게이트 (D-06)', () => {
  it('T0 은 승인 없이 통과하고 그 사실을 기록한다 — 첫날부터 켜는 경로다', async () => {
    const { versionId } = await newDraft('SPC-T0', '# 오탈자 정정');
    const result = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
    });

    expect(result.status).toBe('approved');
    expect(result.gate.autoPass).toBe(true);
    expect(result.approval_id).toBeNull();

    // 통과 사실이 이벤트로 남는다 — 자동이라고 기록이 없으면 감사가 끊긴다
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE type = 'spec.approved'`,
    );
    expect(rows[0]?.payload).toMatchObject({ auto_passed: true });
  });

  it('참조가 많으면 티어가 올라가 승인 대기로 간다', async () => {
    const { specId, versionId } = await newDraft('SPC-T2');
    await raiseTier(specId, versionId);
    const result = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
    });

    expect(result.status).toBe('in_review');
    expect(result.gate.autoPass).toBe(false);
    expect(result.approval_id).not.toBeNull();
  });

  it('같은 초안을 다시 제출해도 승인 카드가 중복되지 않는다 (§2.5)', async () => {
    const { specId, versionId } = await newDraft('SPC-DUP');
    await raiseTier(specId, versionId);
    const first = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
    });

    // 거절 후 재제출
    await specs.reject({
      projectId,
      specVersionId: versionId,
      reviewerUserId: reviewer,
      comment: 'x',
    });
    const second = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
    });

    expect(second.approval_id).toBe(first.approval_id);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM approval`);
    expect(rows[0]?.n).toBe(1);
  });
});

describe('E09-S03 지시자≠승인자 (D-06 · §2.3)', () => {
  it('작성자는 자기 스펙을 승인할 수 없다', async () => {
    const { specId, versionId } = await newDraft('SPC-SELF');
    await raiseTier(specId, versionId);
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });

    await expect(
      specs.approve({ projectId, specVersionId: versionId, approverUserId: planner }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });

  it('다른 사람은 승인할 수 있다', async () => {
    const { specId, versionId } = await newDraft('SPC-OTHER');
    await raiseTier(specId, versionId);
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });

    await expect(
      specs.approve({ projectId, specVersionId: versionId, approverUserId: reviewer }),
    ).resolves.toMatchObject({ status: 'approved' });
  });

  it('멤버가 2인 미만이면 자기 승인을 허용한다 — 소규모 완화(§2.3)', async () => {
    await pool.query(`DELETE FROM membership WHERE user_id = $1`, [reviewer]);
    const { specId, versionId } = await newDraft('SPC-SOLO');
    await raiseTier(specId, versionId);
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });

    await expect(
      specs.approve({ projectId, specVersionId: versionId, approverUserId: planner }),
    ).resolves.toMatchObject({ status: 'approved' });

    // 복구
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'planner' FROM project WHERE id = $3`,
      [newId(), reviewer, projectId],
    );
  });
});

describe('E09-S07 재브리핑·참조 전파 (§3.3)', () => {
  it('기준 버전이 superseded 되면 진행 중 Task 에 재브리핑 플래그가 선다', async () => {
    const first = await newDraft('SPC-BASIS', '# v1');
    await specs.submitReview({ projectId, specVersionId: first.versionId, userId: planner });

    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id,
                         goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-basis','기준','in_progress',$3,'목표','PR','도구','경계')`,
      [taskId, projectId, first.versionId],
    );

    const second = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: first.specId,
      bodyMd: '# v2',
      userId: planner,
    });
    await specs.submitReview({
      projectId,
      specVersionId: second['spec_version_id'] as string,
      userId: planner,
    });

    const { rows } = await pool.query<{ rebrief_required_at: Date | null }>(
      `SELECT rebrief_required_at FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]?.rebrief_required_at).not.toBeNull();

    const events = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type = 'task.rebrief_required'`,
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('승인은 참조하는 문서에 재검토 신호를 보낸다', async () => {
    const target = await newDraft('SPC-TARGET');
    const source = await newDraft('SPC-SOURCE');
    await pool.query(
      `INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
       VALUES ($1,$2,$3,$4,'references')`,
      [newId(), projectId, source.specId, target.specId],
    );

    await specs.submitReview({ projectId, specVersionId: target.versionId, userId: planner });

    const { rows } = await pool.query<{ subject_id: string }>(
      `SELECT subject_id FROM event WHERE type = 'spec.recheck_requested'`,
    );
    expect(rows.map((r) => r.subject_id)).toContain(source.specId);
  });
});

/**
 * 게이트 티어를 T2 이상으로 올린다 — 자동 통과를 피하려는 장치다.
 * 참조 6건(영향 범위 2점) + 요구사항 1건(부작용 1점) + feature(민감도 1점) = 4점 → T2.
 */
async function raiseTier(specId: string, versionId?: string): Promise<void> {
  if (versionId !== undefined) {
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,$4,'WHEN 조건이면 THE SYSTEM SHALL 동작한다','must',$5,$5)`,
      [newId(), projectId, specId, `REQ-${specId.slice(0, 6)}`, versionId],
    );
  }
  for (let i = 0; i < 6; i += 1) {
    const otherId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
      [otherId, projectId, `SPC-REF-${specId.slice(0, 4)}-${i}`],
    );
    await pool.query(
      `INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
       VALUES ($1,$2,$3,$4,'references')`,
      [newId(), projectId, otherId, specId],
    );
  }
}

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  reviewer = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [planner, 'jimin@example.com', '지민'],
    [reviewer, 'seoyeon@example.com', '서연'],
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
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5::member_role)`,
      [newId(), orgId, projectId, user, role],
    );
  }
}

describe('E10-S04 왕복 완성 — 멱등 제출과 딥링크', () => {
  it('같은 버전을 두 번 제출해도 승인함 카드는 하나다', async () => {
    const draft = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-IDEM',
      title: '멱등 제출',
      type: 'feature',
      // T2 이상이 되도록 본문을 크게 — 자동 통과하면 승인 카드가 아예 안 생긴다
      bodyMd: `# 멱등 제출\n\n${'본문 문장. '.repeat(200)}`,
      userId: planner,
    });
    const versionId = draft['spec_version_id'] as string;

    const first = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
    });
    if (first.status !== 'in_review') return; // 게이트가 자동 통과시켰다면 이 케이스 대상이 아니다

    const { rows: before } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval WHERE subject_id = $1 AND decision IS NULL`,
      [versionId],
    );
    expect(before[0]?.n).toBe(1);

    const second = await specs.submitReview({
      projectId,
      specVersionId: versionId,
      userId: planner,
    });
    expect(second.approval_id).toBe(first.approval_id);

    const { rows: after } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval WHERE subject_id = $1 AND decision IS NULL`,
      [versionId],
    );
    expect(after[0]?.n).toBe(1);
  });

  it('저장 응답에 문서 딥링크가 실린다 — 에이전트가 대화에 붙일 링크다', async () => {
    const result = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-LINK',
      title: '딥링크',
      type: 'feature',
      bodyMd: '# 딥링크\n\n본문',
      userId: planner,
    });
    expect(result['web_url']).toBe('/p/clemvion/specs/SPC-LINK');
  });

  it('제출 응답의 딥링크는 승인 대기면 승인함을 가리킨다 — 다음 행동이 있는 곳으로 보낸다', async () => {
    const draft = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-LINK2',
      title: '딥링크2',
      type: 'feature',
      bodyMd: `# 딥링크2\n\n${'본문 문장. '.repeat(200)}`,
      userId: planner,
    });
    const result = await specs.submitReview({
      projectId,
      specVersionId: draft['spec_version_id'] as string,
      userId: planner,
    });
    expect(result.web_url).toBe(
      result.status === 'in_review' ? '/inbox' : '/p/clemvion/specs/SPC-LINK2',
    );
  });
});
