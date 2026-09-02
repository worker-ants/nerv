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

/**
 * 지금 본문의 지문 — 편집 저장의 `base_hash` 다(api.md §1.4g).
 *
 * 테스트의 주제는 비교-교환이 아니라 그 위의 동작이므로, "읽고 그 지문으로 쓴다"를
 * 여기 한 줄로 감춘다. 동시성 자체는 spec-concurrency.spec.ts 가 본다.
 */
async function hashOf(specId: string): Promise<string> {
  // 키로도 UUID 로도 부른다 — 도구가 둘 다 받으므로 테스트도 그렇다(§1.4b)
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(v.content_hash, 'hex') AS h
       FROM spec_version v JOIN spec s ON s.id = v.spec_id
      WHERE (s.id::text = $1 OR s.key = $1)
      ORDER BY v.version_no DESC LIMIT 1`,
    [specId],
  );
  return rows[0]?.h ?? '';
}

describe('E09-S01 문서 축 — 가변 구간은 draft 하나뿐이다', () => {
  it('초안은 여러 번 고쳐도 같은 버전이다 — 저장마다 버전이 늘지 않는다', async () => {
    const { specId, versionId } = await newDraft();
    const again = await specs.draftUpsert({
      baseHash: await hashOf(specId),
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

  it('거절은 프로젝트 경계를 넘지 못한다 — 남의 in_review 를 되돌리지 않는다', async () => {
    const { specId, versionId } = await newDraft();
    await raiseTier(specId, versionId);
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });

    // 다른 프로젝트의 id 로 같은 버전을 거절해 본다 — 예전에는 UPDATE 가 spec 조인 없이
    // `spec_version.id` 만 보고 있어서 통과했다(그리고 이벤트는 남의 프로젝트에 남았다).
    await expect(
      specs.reject({
        projectId: newId(),
        specVersionId: versionId,
        reviewerUserId: reviewer,
        comment: '남의 문서',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]?.status).toBe('in_review');
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
      specs.draftUpsert({
        baseHash: await hashOf(specId),
        projectId,
        specId,
        bodyMd: '# 보완본',
        userId: planner,
      }),
    ).resolves.toBeDefined();
  });

  it('승인은 이전 approved 를 superseded 로 민다 — 스냅샷을 덮어쓰지 않는다', async () => {
    const first = await newDraft('SPC-SUP', '# v1');
    await specs.submitReview({ projectId, specVersionId: first.versionId, userId: planner });

    const second = await specs.draftUpsert({
      baseHash: await hashOf(first.specId),
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

// 2026-08-29 실측 — `nerv_spec_get` 은 키를, `nerv_spec_draft_upsert` 는 UUID 를 받았다.
// 같은 이름의 인자가 도구마다 다른 것을 뜻하면 에이전트는 실패로 배운다(세션 로그에서 확인).
// 게다가 get 은 **자기 출력을 자기 입력에 못 넣었다** — 응답의 spec_id 는 UUID 였다.
describe('참조는 키든 UUID 든 받는다 (§1.4b · 2026-08-29)', () => {
  it('get 은 키로도 UUID 로도 같은 스펙을 준다 — 자기 출력을 자기 입력에 넣을 수 있다', async () => {
    const { specId } = await newDraft('SPC-REF-001');

    const byKey = await specs.get({ projectId, specKey: 'SPC-REF-001' });
    const byUuid = await specs.get({ projectId, specKey: specId });

    expect(byKey['spec_id']).toBe(specId);
    expect(byUuid['spec_id']).toBe(specId);
    // 출력의 spec_id 를 그대로 다시 넣어도 된다는 것이 이 테스트의 요점이다
    expect(await specs.get({ projectId, specKey: String(byKey['spec_id']) })).toMatchObject({
      key: 'SPC-REF-001',
    });
  });

  it('draft upsert 는 키로 이어쓴다 — 예전에는 UUID 만 받았다', async () => {
    const { specId, versionId } = await newDraft('SPC-REF-002');

    const again = await specs.draftUpsert({
      baseHash: await hashOf('SPC-REF-002'),
      roles: ['planner'],
      projectId,
      specId: 'SPC-REF-002',
      bodyMd: '# 키로 이어쓰기',
      userId: planner,
    });

    expect(again['spec_id']).toBe(specId);
    expect(again['spec_version_id']).toBe(versionId);
    expect(again['created']).toBe(false);
  });

  it('없는 키는 못 찾았다고 말한다 — 조용히 새로 만들지 않는다', async () => {
    await expect(
      specs.draftUpsert({
        baseHash: await hashOf('SPC-NOPE-999'),
        roles: ['planner'],
        projectId,
        specId: 'SPC-NOPE-999',
        bodyMd: '# 없는 것',
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_found' } });
  });

  it('parent_id 도 키로 받는다 — 트리에서 본 값을 그대로 쓴다', async () => {
    const { specId: parent } = await newDraft('SPC-REF-PARENT');
    const child = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-REF-CHILD',
      title: '자식',
      type: 'feature',
      parentId: 'SPC-REF-PARENT',
      bodyMd: '# 자식',
      userId: planner,
    });

    const { rows } = await pool.query<{ parent_id: string }>(
      `SELECT parent_id FROM spec WHERE id = $1`,
      [child['spec_id']],
    );
    expect(rows[0]?.parent_id).toBe(parent);
  });
});

describe('E09-S01 초안 편집 리스 (D-04 문서 축 확장)', () => {
  it('같은 사용자는 표면을 옮겨도 자동 인계된다', async () => {
    const { specId } = await newDraft('SPC-LEASE');
    // 웹(세션 없음) → 터미널(세션 있음)
    await expect(
      specs.draftUpsert({
        baseHash: await hashOf(specId),
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
      specs.draftUpsert({
        baseHash: await hashOf(specId),
        projectId,
        specId,
        bodyMd: '# 남의 초안',
        userId: reviewer,
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.DRAFT_LEASED });
  });

  it('리스가 만료되면 다른 사용자가 이어쓸 수 있다 — 30분 TTL', async () => {
    const { specId, versionId } = await newDraft('SPC-LEASE3');
    await pool.query(
      `UPDATE spec_version SET edit_lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [versionId],
    );
    await expect(
      specs.draftUpsert({
        baseHash: await hashOf(specId),
        projectId,
        specId,
        bodyMd: '# 인계',
        userId: reviewer,
      }),
    ).resolves.toBeDefined();
  });

  it('계보는 시스템이 채운다 — 부른 쪽은 지문만 말한다 (2026-08-30 사람 결정)', async () => {
    const { specId, versionId } = await newDraft('SPC-BASE');
    // 승인해 그 버전을 닫으면 다음 저장이 **새 행**을 만든다 — 계보가 생기는 자리다
    await specs.submitReview({ projectId, specVersionId: versionId, userId: planner });
    const next = await specs.draftUpsert({
      baseHash: await hashOf(specId),
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 이어서 쓴다',
      userId: planner,
    });
    const { rows } = await pool.query<{ base_version_id: string | null }>(
      `SELECT base_version_id FROM spec_version WHERE id = $1`,
      [next['spec_version_id'] as string],
    );
    // 부른 쪽은 계보를 말하지 않았는데 서버가 직전 버전을 채웠다
    expect(rows[0]?.base_version_id).toBe(versionId);
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

// 2026-08-30 실측 — 임포터의 골격 배치는 디렉터리에서 area 노드를 만들고 본문 파일이 없으면
// 버전 행을 만들지 않는다. clemvion 의 `channel-web-chat`(자식 둘을 거느린 영역)이 그것이었다:
// 트리에는 보이는데 `nerv_spec_get` 은 "스펙을 찾을 수 없습니다" 라고 답했고, 이어 쓰려 하면
// **얻을 수 없는 지문**을 요구했다.
describe('버전이 없는 골격 노드도 문서다 (§1.4i)', () => {
  async function skeleton(key: string): Promise<string> {
    const specId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'area',$3,$3)`,
      [specId, projectId, key],
    );
    return specId;
  }

  it('get 은 "없다" 가 아니라 빈 본문의 노드를 준다', async () => {
    await skeleton('SPC-EMPTY');
    const r = await specs.get({ projectId, specKey: 'SPC-EMPTY' });
    expect(r['key']).toBe('SPC-EMPTY');
    expect(r['body_md']).toBe('');
    // 견줄 판이 없다는 것을 지문이 그대로 말한다 — 가짜 값을 지어내게 하지 않는다
    expect(r['content_hash']).toBeNull();
    expect(r['version_id']).toBeNull();
  });

  it('지킬 내용이 없으면 지문을 요구하지 않는다 — 그 자리는 필수를 흉내만 냈다', async () => {
    const specId = await skeleton('SPC-EMPTY2');
    const r = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 이제 본문이 생긴다',
      userId: planner,
    });
    // 골격 노드에 처음 본문이 붙는 것은 **새 버전 행**이다(스펙 행은 이미 있었다)
    expect(r['created']).toBe(true);
    expect(r['version_no']).toBe(1);
    // 한 번 본문이 생기면 그다음부터는 지문이 필수다
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId,
        bodyMd: '# 지문 없이 덮어쓴다',
        userId: planner,
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
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
      baseHash: await hashOf(first.specId),
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
  it('같은 버전을 두 번 제출해도 받은 요청 카드는 하나다', async () => {
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

  // 딥링크는 `NERV_PUBLIC_URL` 이 있으면 절대 URL, 없으면 상대 경로다(spec.service.webUrl).
  // 그런데 테스트는 상대 경로만 고정 기대값으로 두고 있었고, 개발 루프는 `.env` 를 쓰라고
  // 안내한다(codebase.md §5.1) — **문서대로 환경을 꾸민 사람에게만 빨간 테스트**였다.
  // CI 는 그 변수를 넣지 않아 통과했다. 이제 테스트가 환경을 스스로 고정하고 양쪽을 본다.
  async function webUrlWith(base: string | undefined, key: string): Promise<unknown> {
    const before = process.env['NERV_PUBLIC_URL'];
    if (base === undefined) delete process.env['NERV_PUBLIC_URL'];
    else process.env['NERV_PUBLIC_URL'] = base;
    try {
      const result = await specs.draftUpsert({
        roles: ['planner'],
        projectId,
        key,
        title: '딥링크',
        type: 'feature',
        bodyMd: '# 딥링크\n\n본문',
        userId: planner,
      });
      return result['web_url'];
    } finally {
      if (before === undefined) delete process.env['NERV_PUBLIC_URL'];
      else process.env['NERV_PUBLIC_URL'] = before;
    }
  }

  it('저장 응답에 문서 딥링크가 실린다 — 에이전트가 대화에 붙일 링크다', async () => {
    expect(await webUrlWith(undefined, 'SPC-LINK')).toBe('/p/clemvion/specs/SPC-LINK');
  });

  it('공개 주소가 설정돼 있으면 절대 URL 이다 — 대화에 붙여도 열린다', async () => {
    expect(await webUrlWith('https://nerv.example.com', 'SPC-LINK-ABS')).toBe(
      'https://nerv.example.com/p/clemvion/specs/SPC-LINK-ABS',
    );
    // 끝의 슬래시는 두 번 겹치지 않는다
    expect(await webUrlWith('https://nerv.example.com/', 'SPC-LINK-SLASH')).toBe(
      'https://nerv.example.com/p/clemvion/specs/SPC-LINK-SLASH',
    );
  });

  it('제출 응답의 딥링크는 승인 대기면 받은 요청을 가리킨다 — 다음 행동이 있는 곳으로 보낸다', async () => {
    const draft = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-LINK2',
      title: '딥링크2',
      type: 'feature',
      bodyMd: `# 딥링크2\n\n${'본문 문장. '.repeat(200)}`,
      userId: planner,
    });
    const before = process.env['NERV_PUBLIC_URL'];
    delete process.env['NERV_PUBLIC_URL'];
    try {
      const result = await specs.submitReview({
        projectId,
        specVersionId: draft['spec_version_id'] as string,
        userId: planner,
      });
      expect(result.web_url).toBe(
        result.status === 'in_review' ? '/inbox' : '/p/clemvion/specs/SPC-LINK2',
      );
    } finally {
      if (before !== undefined) process.env['NERV_PUBLIC_URL'] = before;
    }
  });
});
