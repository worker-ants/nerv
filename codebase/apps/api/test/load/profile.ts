// 부하 시험의 모양과 판정 기준 — 정본: docs/04-mvp/codebase.md §4.3a · 4.8 백로그 E21-S04
//
// **수치는 2026-10-17 사람 결정(D6)이다.** 근거가 있는 것은 동시 세션 50 하나다 — 하트비트 계산이
// 그 수로 부하를 셌다(3.2 아키텍처 §5.4). 나머지(프로젝트 30 · WS 200 · 세션당 훅 30/분 · 30분)는
// "프로젝트 수십 · 동시 세션 수십"(NFR-04)을 숫자로 옮긴 추정이고, 사람이 그대로 정했다.
//
// 판정 기준 셋 가운데 둘은 정본의 인용이다 — 보드 반영 5초(NFR-02)와 게이트 판정 p95 300ms(성공 기준
// 2-7). 셋째인 커버리지 질의 p95 1초는 "페이지 로드를 막지 않는다" 를 잴 수 있게 옮긴 새 수치이고
// 같은 날 사람이 정했다.

/** 판정 기준(ms). 모두 p95 다. */
export const LOAD_THRESHOLDS = {
  /** 상태 전이 요청을 보낸 때부터 그 프로젝트를 보는 모든 소켓이 받을 때까지 — NFR-02 */
  boardMs: 5_000,
  /** EP-REV-08 응답 시간 — 성공 기준 2-7 */
  gateMs: 300,
  /** EP-COV-01 응답 시간 — 2026-10-17 사람 결정 D6 */
  coverageMs: 1_000,
} as const;

export interface LoadProfile {
  /** 대상 NERV 의 공개 주소(웹과 API 가 한 오리진) — 예: `pnpm e2e:env` 의 NERV_E2E_BASE_URL */
  url: string;
  /** 준비를 맡을 사람 계정 — 조직을 만들고 그 admin 이 된다 */
  email: string;
  password: string;
  projects: number;
  sessions: number;
  sockets: number;
  /** 세션당 분당 PostToolUse 훅 수 — 한도는 RATE_LIMIT_INGEST_PER_MIN */
  hooksPerMin: number;
  /** 부하를 거는 시간(초) */
  durationSec: number;
  /** 클레임 한 바퀴(잡기 → 하트비트 → 리뷰 제출 → 판정 → 놓기)의 길이(초) */
  cycleSec: number;
  /** 대시보드를 여는 사람 수 — 각자 `viewEverySec` 마다 한 프로젝트의 커버리지 화면을 연다 */
  viewers: number;
  viewEverySec: number;
  /** CI 가 프로젝트마다 게이트 판정을 부르는 주기(초) */
  ciEverySec: number;
  specsPerProject: number;
  requirementsPerSpec: number;
  /** 프로젝트마다 `ready` 로 만들어 둘 작업 수 — 세션 수의 배수로 잡는다 */
  tasksPerSession: number;
  /** 끝나고 만든 것을 정리하는가(토큰 폐기 · 세션 종료 · 프로젝트 보관) */
  cleanup: boolean;
  /** 결과 JSON 을 쓸 경로 */
  report: string;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 은 양의 정수여야 합니다 — 받은 값: ${raw}`);
  }
  return value;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} 이 필요합니다 — 사용법은 docs/04-mvp/codebase.md §4.3a (예: NERV_LOAD_URL=$NERV_E2E_BASE_URL)`,
    );
  }
  return value;
}

/** 환경변수에서 읽는다. 기본값이 D6 의 수치다. */
export function loadProfile(env: NodeJS.ProcessEnv = process.env): LoadProfile {
  const projects = intEnv(env, 'NERV_LOAD_PROJECTS', 30);
  const sessions = intEnv(env, 'NERV_LOAD_SESSIONS', 50);
  if (sessions < projects) {
    // 세션이 없는 프로젝트는 보드가 움직이지 않아 반영 지연을 잴 수 없다
    throw new Error(
      `NERV_LOAD_SESSIONS(${sessions}) 는 NERV_LOAD_PROJECTS(${projects}) 이상이어야 합니다`,
    );
  }
  return {
    url: required(env, 'NERV_LOAD_URL').replace(/\/+$/, ''),
    email: required(env, 'NERV_LOAD_EMAIL'),
    password: required(env, 'NERV_LOAD_PASSWORD'),
    projects,
    sessions,
    sockets: intEnv(env, 'NERV_LOAD_SOCKETS', 200),
    hooksPerMin: intEnv(env, 'NERV_LOAD_HOOKS_PER_MIN', 30),
    durationSec: intEnv(env, 'NERV_LOAD_MINUTES', 30) * 60,
    cycleSec: intEnv(env, 'NERV_LOAD_CYCLE_SEC', 60),
    viewers: intEnv(env, 'NERV_LOAD_VIEWERS', 10),
    viewEverySec: intEnv(env, 'NERV_LOAD_VIEW_EVERY_SEC', 15),
    ciEverySec: intEnv(env, 'NERV_LOAD_CI_EVERY_SEC', 10),
    specsPerProject: intEnv(env, 'NERV_LOAD_SPECS', 12),
    requirementsPerSpec: intEnv(env, 'NERV_LOAD_REQUIREMENTS', 8),
    tasksPerSession: intEnv(env, 'NERV_LOAD_TASKS_PER_SESSION', 3),
    cleanup: env['NERV_LOAD_KEEP'] !== '1',
    report:
      env['NERV_LOAD_REPORT'] ??
      `load-report/${new Date().toISOString().replaceAll(':', '-')}.json`,
  };
}
