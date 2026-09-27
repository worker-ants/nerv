// 보기 기준 — 문서마다 **어느 버전을 읽는가**(2026-09-27 사람 결정 · REQ-API-193~196)
//
// 세 가지 답이 있다. `approved`(기본 — 최신 승인본, 없으면 초안) · `latest`(번호가 가장 큰 버전 —
// 승인본 위의 초안과 검토 중 포함) · 기준선(그 세트가 묶어 둔 버전). 트리 · 그래프 · 문서 한 건 ·
// 검색이 **같은 판정**을 쓰도록 여기 한 곳에 둔다(D-05). 표면마다 따로 고르면 목록에서 본 v4 가
// 검색에서는 v3 로 나온다.

import { sql, type SQL } from 'drizzle-orm';
import { msg, NERV_ERROR, SPEC_VIEW_BASES, type SpecViewBasis } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertVocab } from '../../common/query-vocab.js';
import type { NervDb } from '../../common/database.module.js';

/**
 * 보기 기준을 해석한다. 비었으면 `approved` 다.
 *
 * **기준선 · 버전 번호와 함께 오면 거절한다.** 셋은 모두 "어느 버전인가" 에 대한 답이라, 함께 받으면
 * 어느 쪽이 이겼는지를 매번 물어야 한다(`error.spec.version_xor_baseline` 과 같은 규율). 기본값을
 * 명시한 `basis=approved` 도 같다 — 기준선과 함께 보낸 쪽은 둘 중 무엇을 원했는지 알 수 없다.
 */
export function resolveBasis(input: {
  basis?: string | null;
  baseline?: string | null;
  versionNo?: number | null;
  task?: string | null;
}): SpecViewBasis {
  const selector = resolveSelector(input);
  return selector.kind === 'latest' ? 'latest' : 'approved';
}

/**
 * **무엇으로 읽는가** — 선택자는 넷이고 하나만 준다(REQ-API-196 · 203).
 *
 * `basis`(승인본 · 최신) · `version`(REST 의 `v`) · `baseline` · `task`(작업의 기준 — 2026-09-27
 * 사람 결정 M7). 넷은 모두 "어느 버전을 읽는가" 에 대한 답이라 둘을 함께 받으면 어느 쪽이 이겼는지
 * 매번 물어야 한다. 예전에는 버전과 기준선의 배타를 표면(컨트롤러 · 도구)이 각자 검사했다 — 판정은
 * 여기 한 곳이다(D-05).
 */
export type SpecSelector =
  | { kind: 'approved' }
  | { kind: 'latest' }
  | { kind: 'version'; versionNo: number }
  | { kind: 'baseline'; name: string }
  | { kind: 'task'; task: string };

export function resolveSelector(input: {
  basis?: string | null;
  baseline?: string | null;
  versionNo?: number | null;
  task?: string | null;
}): SpecSelector {
  const basis =
    input.basis == null || input.basis === ''
      ? null
      : (assertVocab([input.basis], SPEC_VIEW_BASES, 'basis')[0] as SpecViewBasis);
  const baseline = input.baseline == null || input.baseline === '' ? null : input.baseline;
  const task = input.task == null || input.task === '' ? null : input.task;
  const versionNo = input.versionNo ?? null;
  // 예전부터 있던 한 쌍은 예전 오류 그대로다 — 부르는 쪽이 이미 그 모양을 안다
  if (versionNo !== null && baseline !== null && basis === null && task === null) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.version_xor_baseline'), {
      kind: 'invalid_input',
      field: 'baseline',
    });
  }
  const given = [
    ...(basis !== null ? ['basis'] : []),
    ...(versionNo !== null ? ['version'] : []),
    ...(baseline !== null ? ['baseline'] : []),
    ...(task !== null ? ['task'] : []),
  ];
  if (given.length > 1) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.basis_exclusive'), {
      kind: 'invalid_input',
      field: basis !== null ? 'basis' : 'task',
      conflict: given,
    });
  }
  if (task !== null) return { kind: 'task', task };
  if (baseline !== null) return { kind: 'baseline', name: baseline };
  if (versionNo !== null) return { kind: 'version', versionNo };
  return basis === 'latest' ? { kind: 'latest' } : { kind: 'approved' };
}

/** 작업이 가리키는 기준 — 출처 문서와 그 버전, 기준선(REQ-API-203) */
export interface TaskBasis extends Record<string, unknown> {
  task_id: string;
  task_key: string;
  source_spec_id: string | null;
  source_version_id: string | null;
  source_version_no: number | null;
  baseline_id: string | null;
  baseline: string | null;
}

/** 작업을 키 또는 UUID 로 찾아 그 기준을 읽는다. 없는 작업은 거절이다(빈 결과가 아니다) */
export async function taskBasisOf(db: NervDb, projectId: string, ref: string): Promise<TaskBasis> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const { rows } = await db.execute<TaskBasis>(sql`
    SELECT t.id AS task_id, t.key AS task_key, sv.spec_id AS source_spec_id,
           t.source_spec_version_id AS source_version_id, sv.version_no AS source_version_no,
           t.baseline_id, bl.name AS baseline
      FROM task t
 LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
 LEFT JOIN spec_baseline bl ON bl.id = t.baseline_id
     WHERE t.project_id = ${projectId}
       AND ${uuid ? sql`t.id = ${ref}::uuid` : sql`t.key = ${ref}`}
  `);
  const found = rows[0];
  if (found === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
      kind: 'not_found',
      field: 'task',
      task: ref,
    });
  }
  return found;
}

/** 그 이름의 기준선 id — 없는 이름은 기본값으로 떨어뜨리지 않고 거절한다(REQ-API-082 의 규율) */
export async function baselineIdOf(db: NervDb, projectId: string, name: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM spec_baseline WHERE project_id = ${projectId} AND name = ${name}
  `);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.baseline_not_found'), {
      kind: 'invalid_input',
      field: 'baseline',
      unknown: [name],
    });
  }
  return id;
}

/** 문서 `s` 의 가장 새 버전(번호가 가장 큰 것) — `(spec_id, version_no)` 유일 색인을 탄다 */
export const LATEST_VERSION_ID = sql`(SELECT l.id FROM spec_version l
                                       WHERE l.spec_id = s.id ORDER BY l.version_no DESC LIMIT 1)`;

/**
 * 문서 `s` 가 이 기준으로 읽는 버전의 id(SQL 식)와, 그 기준에 드는 문서만 남기는 조건.
 *
 * - `approved` — `s.current_version_id`(최신 승인본, 없으면 초안 — 3.3 데이터 모델의 정의)
 * - `latest` — 번호가 가장 큰 버전
 * - 기준선 — 그 세트가 묶어 둔 버전이고, **세트에 없는 문서는 빠진다**(REQ-API-098)
 */
export function versionOfSpec(
  basis: SpecViewBasis,
  baselineId: string | null,
): { versionId: SQL; member: SQL } {
  if (baselineId !== null) {
    return {
      versionId: sql`(SELECT i.spec_version_id FROM spec_baseline_item i
                       WHERE i.baseline_id = ${baselineId} AND i.spec_id = s.id)`,
      member: sql` AND EXISTS (SELECT 1 FROM spec_baseline_item i
                                WHERE i.baseline_id = ${baselineId} AND i.spec_id = s.id)`,
    };
  }
  return {
    versionId: basis === 'latest' ? LATEST_VERSION_ID : sql`s.current_version_id`,
    member: sql``,
  };
}

/**
 * 기준과 상관없이 줄마다 함께 주는 세 값 — 가장 새 버전의 번호 · 상태와 최신 승인본 번호.
 *
 * 승인본으로 읽는 목록이 "이 문서 위에 v4 초안이 있다" 를 표시하려면 이 값이 있어야 한다
 * (REQ-API-194 · 화면 REQ-WEB-249). 문서 `s` 를 가리키는 질의 안에서 쓴다.
 */
export const VERSION_SUMMARY_COLUMNS = sql`
  (SELECT l.version_no FROM spec_version l
    WHERE l.spec_id = s.id ORDER BY l.version_no DESC LIMIT 1) AS latest_version_no,
  (SELECT l.status::text FROM spec_version l
    WHERE l.spec_id = s.id ORDER BY l.version_no DESC LIMIT 1) AS latest_status,
  (SELECT max(a.version_no) FROM spec_version a
    WHERE a.spec_id = s.id AND a.status = 'approved')::int AS approved_version_no`;
