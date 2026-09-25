// 작업 보드의 뷰 상태 — **주소에 있다**(screens.md §2.5 · REQ-WEB-213)
//
// 보드가 레이아웃 라우트(`routes/p.$proj/tasks.tsx`)로 올라가면서 이 검사도 그리로 갔다 — 작업 상세
// (`…/tasks/$task`)가 보드 위 시트로 열리므로 **두 주소가 같은 보드 상태를 나눠 든다**. 시트를 닫아도
// 걸어 둔 필터가 그대로인 이유가 이것이다.

/**
 * 보드의 필터는 **주소에 있다**(screens.md:164 — `?spec=` `?assignee=` `?ai=1`).
 *
 * 2026-09-06 까지 넷 다 컴포넌트 state 였다: **"이 스펙의 작업만" 을 링크로 건넬 수
 * 없었고** 새로고침 한 번에 필터가 풀렸다. 서버는 `spec`·`assignee` 를 처음부터 받고
 * 있었으므로(`task.controller.ts`) 빠져 있던 것은 화면이 그것을 주소에서 읽는 일뿐이다.
 *
 * `?ai=1`(에이전트가 도는 작업만)은 **아직 없다** — 서버에 그 필터가 없어서, 화면에서
 * 흉내 내면 한 페이지 안의 카드만 걸러 "없음" 을 사실처럼 보이게 한다.
 */
export interface TaskBoardSearch {
  spec?: string;
  assignee?: string;
  ai?: true;
  /** 기본이 켜짐이라 **끈 상태만** 주소에 남는다(`?backlog=0`) */
  backlog?: false;
  archived?: true;
  /** S3 의 "이 버전에서 파생" — 주소가 폼의 초기값이다(REQ-WEB-147) */
  from_version?: string;
  from_spec?: string;
  from_version_no?: string;
  requirement?: string;
}

/**
 * 켬·끔 표식 — **주소는 문자열이 아니라 JSON 으로 읽힌다.** TanStack 의 기본 파서는 `?backlog=0` 을
 * 숫자 `0` 으로, `?ai=1` 을 숫자 `1` 로 준다. 문자열 `'0'`·`'1'` 만 받던 동안 손으로 적은(또는 문서가
 * 적은) `?backlog=0` 은 조용히 무시됐다 — 보드의 토글은 `false`·`true` 를 쓰므로 아무도 몰랐다
 * (2026-09-24 · P08c 에서 발견).
 */
const isOn = (value: unknown): boolean => value === true || value === 1 || value === '1';
const isOff = (value: unknown): boolean => value === false || value === 0 || value === '0';

export function validateBoardSearch(search: Record<string, unknown>): TaskBoardSearch {
  return {
    ...(typeof search['spec'] === 'string' && search['spec'] !== ''
      ? { spec: search['spec'] }
      : {}),
    ...(typeof search['assignee'] === 'string' && search['assignee'] !== ''
      ? { assignee: search['assignee'] }
      : {}),
    ...(isOn(search['ai']) ? { ai: true as const } : {}),
    ...(isOff(search['backlog']) ? { backlog: false as const } : {}),
    ...(isOn(search['archived']) ? { archived: true as const } : {}),
    ...(typeof search['from_version'] === 'string' && search['from_version'] !== ''
      ? { from_version: search['from_version'] }
      : {}),
    ...(typeof search['from_spec'] === 'string' && search['from_spec'] !== ''
      ? { from_spec: search['from_spec'] }
      : {}),
    ...(typeof search['from_version_no'] === 'string' && search['from_version_no'] !== ''
      ? { from_version_no: search['from_version_no'] }
      : {}),
    ...(typeof search['requirement'] === 'string' && search['requirement'] !== ''
      ? { requirement: search['requirement'] }
      : {}),
  };
}

/**
 * 보드의 **필터만** — 카드에서 작업 상세(시트)를 열 때 주소가 싣는 것이다. 파생 폼의 인자
 * (`from_*` · `requirement`)는 싣지 않는다: 그것까지 실으면 시트 뒤의 보드가 폼을 다시 연다.
 */
export function boardFilters(search: TaskBoardSearch): TaskBoardSearch {
  return {
    ...(search.spec === undefined ? {} : { spec: search.spec }),
    ...(search.assignee === undefined ? {} : { assignee: search.assignee }),
    ...(search.ai === true ? { ai: true as const } : {}),
    ...(search.backlog === false ? { backlog: false as const } : {}),
    ...(search.archived === true ? { archived: true as const } : {}),
  };
}
