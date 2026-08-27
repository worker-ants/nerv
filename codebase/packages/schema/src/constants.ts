// 도메인 상수 전표 — 정본: docs/04-mvp/codebase.md §3.2
//
// 이 파일 밖에서의 하드코딩은 lint 로 금지한다(REQ-CB-006).
// 각 값의 근거 정본은 주석의 문서 링크다 — 여기서 새 값을 만들지 않는다.

/**
 * 클레임 리스 TTL — 30분.
 * Task 클레임 리스와 초안 편집 리스가 **같은 상수**를 쓴다(D-04 문서 축 확장).
 * 정본: docs/03-proposal/agent-integration.md §2.7
 */
export const LEASE_TTL_SECONDS = 1800;

/**
 * 하트비트 주기 — 60초.
 * `nerv_task_heartbeat` 의 응답은 서버→세션 역채널을 겸한다.
 * 정본: docs/03-proposal/agent-integration.md §2.3
 */
export const HEARTBEAT_INTERVAL_SECONDS = 60;

/**
 * 세션 stale 임계 — 30분(리스 TTL 과 같은 값).
 * 무활동 초과 시 `stale` 자동 전이 + 클레임 자동 회수(D-13).
 * 정본: docs/03-proposal/agent-integration.md §5.2
 */
export const SESSION_STALE_SECONDS = 1800;

/**
 * 리뷰 프롬프트 blob 보존 — 30일.
 * MVP 범위가 아니다(Phase 2 리뷰 수집 FR-09 부터 적용) — 참고용 상수.
 * 정본: docs/03-proposal/architecture.md §2.5
 */
export const REVIEW_PROMPT_BLOB_TTL_DAYS = 30;

/**
 * Valkey pub/sub 방송 채널.
 * EventService 가 도메인 트랜잭션 커밋 후 이 채널로 PUBLISH 하고,
 * 파드마다 SUBSCRIBE 해서 자기 WS 소켓·SSE 스트림에만 emit 한다(REQ-CB-004).
 * 정본: docs/04-mvp/database.md §3
 */
export const EVENTS_CHANNEL = 'nerv_events';

/**
 * 워커 단일 실행 보장용 advisory lock 키(프로젝트 전역 단일 키).
 * 값은 ASCII 'nerv' 를 int32 로 읽은 것(0x6E657276) — 문서가 "bigint 리터럴 1개"만
 * 규정하므로(§3.2) 구현이 정한 값이다. replica 1 은 배포 규칙이고 이 lock 이 최종 방어선이다.
 * 정본: docs/04-mvp/codebase.md §6.3 (REQ-CB-011)
 */
export const WORKER_ADVISORY_LOCK_KEY = 1852796534n;

/**
 * 쿼터 — PAT 토큰당 분당 요청 수. `/api/v1` + `/mcp` 공용 풀.
 * 정본: docs/04-mvp/api.md §1.8
 */
/**
 * 요청 본문 상한 — 임포트 배치가 정한다.
 *
 * Fastify 기본값은 1 MiB 인데, 임포터의 **문서 기본 배치**(50건 — importer.md §3.1)는
 * 실제 스펙 저장소에서 그것을 넘는다: clemvion 은 평균 34 KB/건 · 최대 298 KB/건이라
 * 50건이 약 1.7 MB 다(실측 2026-08-23). 서버가 자기 문서가 선언한 배치를 못 받으면
 * 그 기본값은 쓸 수 없는 값이다.
 *
 * 16 MiB 는 최악(50 × 300 KB)에 여유를 둔 값이다. 더 큰 이관은 `--batch-size` 로 줄인다.
 */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

export const RATE_LIMIT_PAT_PER_MIN = 300;

/** 쿼터 — 웹 세션 사용자당 분당 요청 수(`/api/v1`). 정본: docs/04-mvp/api.md §1.8 */
export const RATE_LIMIT_WEB_PER_MIN = 600;

/** 쿼터 — 세션당 분당 `/ingest/hooks/*` 요청 수. 정본: docs/04-mvp/api.md §1.8 */
export const RATE_LIMIT_INGEST_PER_MIN = 120;

/**
 * 인증 표면(`/api/auth/*`) 한도 — **IP 당** 분당 요청 수.
 *
 * 다른 쿼터와 주체가 다르다: 로그인 전에는 토큰도 세션도 없으므로 IP 로 센다. 목적도 다르다 —
 * 다른 셋은 과부하 방어이고 이것은 **무차별 대입 방어**다. 사람의 로그인 속도로는 닿지 않고
 * (오타 몇 번 + 재시도), 자동화된 시도에는 금세 걸리는 값을 고른다.
 *
 * 이 값을 명시하는 이유: better-auth 의 내장 기본값에 맡기면 한도가 코드 어디에도 없고
 * 사용자는 영문 "Too many requests" 를 보게 된다(실측).
 */
export const RATE_LIMIT_AUTH_PER_MIN = 30;

/**
 * 로그인 시도 한도 — IP 당 분당. 인증 표면 전체(30)보다 좁다.
 *
 * 값의 근거는 두 방향의 실패 비용이다. 너무 높으면 무차별 대입이 현실적이 되고, 너무 낮으면
 * 오타 몇 번에 사람이 잠긴다(비밀번호 관리자 자동완성 실패 → 재시도 2~3회는 흔하다).
 * 10회는 사람의 실수를 넉넉히 덮고 자동화에는 곧 걸린다.
 *
 * 인증 스택의 기본값(10초당 3회)에 맡기지 않는 이유: 값이 문서에도 코드에도 없고,
 * 사람이 세 번 만에 잠기며, 응답 문구가 우리 것이 아니다(실측).
 */
export const RATE_LIMIT_SIGN_IN_PER_MIN = 10;

/**
 * WS 연결 거절을 알리는 이벤트 이름.
 *
 * socket.io 의 `connect_error` 를 **서버가 emit 할 수 없다** — 예약된 이름이라 예외를 던지고,
 * 그 예외가 연결 핸들러에서 나면 프로세스가 죽는다(실측: 미인증 브라우저 하나가 API 를
 * 크래시 루프에 빠뜨렸다). 거절 사유는 이 이름으로 보내고 곧바로 끊는다.
 */
export const WS_ERROR_EVENT = 'nerv:error';

/**
 * 커서 페이지네이션 기본·최대 (api.md §1.6). 오프셋 방식은 제공하지 않는다.
 *
 * 상수로 두는 이유는 두 곳이 같은 값을 봐야 하기 때문이다 — 서버가 자르는 값과 화면이
 * "더 있다"를 판단하는 값이 다르면 마지막 페이지에서 어긋난다(REQ-CB-006).
 */
export const PAGE_LIMIT_DEFAULT = 30;
export const PAGE_LIMIT_MAX = 100;

/**
 * S4 작업 보드의 `done` 레인이 기본으로 보여 주는 기간 — screens.md §2.5 의 `done(7d)`.
 *
 * **끝난 일은 시간이 지나면 배경이 된다.** clemvion 실측에서 Task 487건 중 done 이 419건
 * (86%)이었고, 보드가 전량을 한 응답으로 받아 229 KB 였다(2026-08-23). 레인이 아니라
 * **창**인 이유는 그 너머를 못 보게 하려는 게 아니라 기본을 정하려는 것이다 —
 * `include_archived` 로 창을 전체로 넓힌다.
 *
 * 별도 상태값(`archived`)을 만들지 않은 것은 의도다: 종단 상태가 늘면 "왜 끝났는가"
 * (done 인가 blocked 인가)를 잃고 전이 규칙 표 전체가 바뀐다. `done_at` 에서 파생하면
 * 마이그레이션도 잡도 필요 없고 언제나 정확하다.
 */
export const TASK_DONE_WINDOW_DAYS = 7;

/**
 * 개발 시드가 심는 조직 slug — `dev-seed.sql` 과 시드 안전장치가 **같은 값을 봐야 한다**.
 *
 * 실측(2026-08-24): 시드의 조직을 `nerv` → `default` 로 바꾸자 안전장치가 자기 시드의
 * 조직을 "남의 조직"으로 보고 재적재를 거부했다. 값이 두 곳에 있으면 한쪽만 바뀐다.
 * SQL 은 TS 를 import 할 수 없으므로 이 상수를 정본으로 두고 **테스트가 둘을 대조한다**.
 */
export const SEED_ORG_SLUG = 'default';

/**
 * 초대 링크의 수명(일) — 조직 초대(api.md §2.1b · 사람 결정 2026-08-27).
 *
 * 짧게 잡는 이유는 **되찾는 길이 있기 때문**이다: 만료되면 admin 이 다시 만든다.
 * 링크는 메신저·메일을 타고 흐르고 그 흔적은 오래 남는다 — 오래 사는 링크는 오래
 * 사는 열쇠다.
 */
export const INVITATION_TTL_DAYS = 7;
