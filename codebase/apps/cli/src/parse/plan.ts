import { t } from '../i18n.js';
// plan frontmatter → Task 매핑 (E11-S01 · importer.md §2.6)
//
// **소급 위조 금지**가 이 파일의 제1규칙이다. 임포터는 없는 것을 만들어내지 않는다:
//   · `ready` 로 적재하지 않는다 — 위임 명세 4요소를 소급 생성하지 않으므로 그 상태의
//     전제(지시가 완결됨)를 만족할 수 없다(FR-05 · REQ-IMP-009)
//   · `claim`·`agent_session` 을 만들지 않는다 — 둘은 실행의 기록이지 문서의 번역이 아니다
//   · 시각을 추정하지 않는다 — `started:` 가 없으면 임포트 시각 + warn 이다
//   · owner 를 추정하지 않는다 — 매핑 테이블에 없으면 unassigned 다(E11-S02)
//
// 이 규칙들이 없으면 임포트 직후의 보드가 "그럴듯하지만 아무도 책임지지 않는" 상태로 채워지고,
// 그 상태는 clemvion 이 이미 겪은 것이다(빈 약속 · 무장 해제된 가드).

export type PlanTaskStatus = 'backlog' | 'in_progress' | 'done';

export interface PlanTask {
  source_path: string;
  title: string;
  body_md: string;
  status: PlanTaskStatus;
  /** 매핑 실패는 null — 사람이 배정한다(수동 배정 큐) */
  assignee_user_id: string | null;
  owner_label: string | null;
  /** frontmatter 의 `worktree:` 원문. 매니페스트 보존용이고 상태 판정에만 쓴다 */
  worktree: string | null;
  started: string | null;
  priority: string | null;
  spec_impact: Record<string, unknown> | null;
  /**
   * 이 계획이 건드리는 스펙 파일 경로들(frontmatter `spec_impact`·`spec_area`·`spec`).
   * 임포터가 경로 → 스펙 키로 바꿔 **기준 SpecVersion** 을 잡는다(§2.6e).
   */
  spec_paths: string[];
  /**
   * 본문이 언급한 요구사항 ref. **하나뿐일 때만** 링크로 쓴다 — 여럿을 언급한 계획은
   * 그중 무엇을 구현한 것인지 문서가 말하지 않으므로, 고르는 순간 지어내는 것이 된다.
   */
  requirement_refs: string[];
  source_spec_key: string | null;
  warnings: string[];
}

export interface PlanClassification {
  kind: 'task' | 'reference';
  task: PlanTask | null;
  /** 참고 문서 분류 사유 — 리포트에 남긴다 */
  note: string | null;
}

/** Gate C 의 sentinel 어휘 4종 — 이 밖의 값은 스펙 경로로 해석한다(§2.6). */
// eslint-disable-next-line no-restricted-syntax -- 원본을 읽는 어휘 — 출력이 아니다(REQ-CB-022)
const NONE_SENTINELS = new Set(['none', '없음', 'n/a', 'na']);

export interface PlanMappingOptions {
  /** `(unstarted)` — 프로파일이 선언한다 */
  unstartedSentinel: string;
  /** owner 라벨 → 사용자 id. E11-S02 의 `--owner-map` */
  ownerMap?: Record<string, string>;
  /** started 가 없을 때 채울 시각 — 추정하지 않고 임포트 시각을 쓴다 */
  importedAt: string;
}

/**
 * 디렉터리 + worktree 로 상태를 정한다(§2.6 표).
 *   complete/                                → done
 *   in-progress/ + worktree: (unstarted)     → backlog
 *   in-progress/ + worktree 값 있음          → in_progress
 *   research/                                → Task 아님(참고 문서)
 */
export function classifyPlan(
  input: { path: string; frontmatter: Record<string, unknown>; body: string },
  options: PlanMappingOptions,
): PlanClassification {
  const segments = input.path.split('/');
  const warnings: string[] = [];

  if (segments.includes('research')) {
    // 클러스터 묶음 정보는 매니페스트에만 남기고 Task 간 관계는 만들지 않는다 — 관계 추정 금지
    return { kind: 'reference', task: null, note: t()('cli.reason.research_dir') };
  }

  const worktreeRaw = input.frontmatter['worktree'];
  const worktree = typeof worktreeRaw === 'string' && worktreeRaw !== '' ? worktreeRaw : null;

  let status: PlanTaskStatus;
  if (segments.includes('complete')) {
    status = 'done';
  } else if (worktree === null || worktree === options.unstartedSentinel) {
    status = 'backlog';
    if (worktree === null) warnings.push(t()('cli.reason.no_worktree'));
  } else {
    status = 'in_progress';
  }

  const startedRaw = input.frontmatter['started'];
  const started = typeof startedRaw === 'string' && startedRaw !== '' ? startedRaw : null;
  if (started === null) {
    // 시각 추정 금지 — 파일의 git 최초 커밋 시각으로 메우지 않는다(§2.6)
    warnings.push(t()('cli.reason.no_started'));
  }

  const ownerRaw = input.frontmatter['owner'];
  const ownerLabel = typeof ownerRaw === 'string' && ownerRaw !== '' ? ownerRaw.trim() : null;
  // **추정하지 않는다.** 복합 라벨(`planner/developer`)을 쪼개 첫 조각을 쓰면 편하지만,
  // `developer (다음 진입자)` 처럼 "사람이 아직 없다"는 뜻인 표기까지 특정인에게 배정된다.
  // owner 는 신원이 아니라 역할이므로(1부 §소유자가 신원이 아니다) 매핑은 사람이 준다 —
  // 복합 라벨도 `--owner-map` 에 그대로 키로 적으면 된다.
  const assignee = ownerLabel === null ? null : (options.ownerMap?.[ownerLabel] ?? null);
  if (ownerLabel !== null && assignee === null) {
    // owner 는 신원이 아니다 — 자유 텍스트를 계정으로 추정하지 않는다(§2.6)
    warnings.push(t()('cli.reason.owner_unmapped', { label: ownerLabel }));
  }

  const priorityRaw = input.frontmatter['priority'];
  const priority =
    typeof priorityRaw === 'string' && /^P[0-3]$/.test(priorityRaw.trim())
      ? priorityRaw.trim()
      : null;

  const specImpact = mapSpecImpact(input.frontmatter['spec_impact'], warnings);
  // 스펙 경로는 세 자리에 흩어져 있다(실측): `spec_impact` · `spec_area` · `spec`.
  // 셋을 합쳐 중복을 걷는다 — 어느 이름을 썼는지는 계획마다 다르다.
  const specPaths = [
    ...new Set(
      ['spec_impact', 'spec_area', 'spec']
        .flatMap((field) => asPathList(input.frontmatter[field]))
        .filter((path) => path.endsWith('.md')),
    ),
  ];
  const requirementRefs = [...new Set(input.body.match(REQUIREMENT_REF) ?? [])];

  return {
    kind: 'task',
    note: null,
    task: {
      source_path: input.path,
      title: titleOf(input.body) ?? fileStem(input.path),
      // 본문은 바이트 보존이다 — 체크박스 분해는 옵션이고 기본은 off(§2.6)
      body_md: input.body,
      status,
      assignee_user_id: assignee,
      owner_label: ownerLabel,
      worktree,
      started: started ?? options.importedAt,
      priority,
      spec_impact: specImpact,
      spec_paths: specPaths,
      requirement_refs: requirementRefs,
      source_spec_key: null,
      warnings,
    },
  };
}

/** spec_impact — sentinel 4종은 `{none: true}`, 나머지는 경로 목록으로 보존한다. */
export function mapSpecImpact(value: unknown, warnings: string[]): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;

  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  const cleaned = values.map((v) => v.trim()).filter((v) => v !== '');
  if (cleaned.length === 0) return null;

  if (cleaned.every((v) => NONE_SENTINELS.has(v.toLowerCase()))) return { none: true };

  const paths = cleaned.filter((v) => !NONE_SENTINELS.has(v.toLowerCase()));
  // 경로 → 스펙 UUID 해소는 매니페스트가 한다(적재 시점). 여기서는 원문을 보존한다.
  warnings.push(t()('cli.reason.spec_impact_paths', { count: paths.length }));
  return { paths };
}

function titleOf(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim() ?? null;
}

function fileStem(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.md$/, '');
}

/**
 * owner 매핑 테이블 로더 — `--owner-map` 이 가리키는 JSON.
 * 형식: `{ "developer": "user-uuid", "project-planner": "user-uuid" }`
 */
export function parseOwnerMap(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(t()('cli.err.owner_map_shape'));
  }
  const map: Record<string, string> = {};
  for (const [label, id] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof id !== 'string' || id === '') {
      throw new Error(t()('cli.err.owner_map_value', { label }));
    }
    map[label] = id;
  }
  return map;
}

/**
 * 요구사항 ref 모양 — 스펙 쪽 추출기와 **같은 규약**이다(`[A-Z]+-[A-Z]+-\d+`).
 * 여기서 다른 모양을 쓰면 계획이 가리키는 ref 와 스펙이 발급한 ref 가 갈린다.
 */
const REQUIREMENT_REF = /\b[A-Z][A-Z]+-[A-Z][A-Z]+-\d+\b/g;

/** frontmatter 값 하나 → 경로 목록. 문자열 하나든 배열이든 같은 것으로 읽는다. */
function asPathList(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim());
}
