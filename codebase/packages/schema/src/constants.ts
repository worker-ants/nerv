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
export const RATE_LIMIT_PAT_PER_MIN = 300;

/** 쿼터 — 웹 세션 사용자당 분당 요청 수(`/api/v1`). 정본: docs/04-mvp/api.md §1.8 */
export const RATE_LIMIT_WEB_PER_MIN = 600;

/** 쿼터 — 세션당 분당 `/ingest/hooks/*` 요청 수. 정본: docs/04-mvp/api.md §1.8 */
export const RATE_LIMIT_INGEST_PER_MIN = 120;

/**
 * WS 연결 거절을 알리는 이벤트 이름.
 *
 * socket.io 의 `connect_error` 를 **서버가 emit 할 수 없다** — 예약된 이름이라 예외를 던지고,
 * 그 예외가 연결 핸들러에서 나면 프로세스가 죽는다(실측: 미인증 브라우저 하나가 API 를
 * 크래시 루프에 빠뜨렸다). 거절 사유는 이 이름으로 보내고 곧바로 끊는다.
 */
export const WS_ERROR_EVENT = 'nerv:error';
