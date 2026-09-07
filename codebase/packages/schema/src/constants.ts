// 도메인 상수 전표 — 정본: docs/04-mvp/codebase.md §3.2
//
// 이 파일 밖에서의 하드코딩은 lint 로 금지한다(REQ-CB-006).
// 각 값의 근거 정본은 주석의 문서 링크다 — 여기서 새 값을 만들지 않는다.

import { en } from './i18n/en.js';
import { ko } from './i18n/ko.js';

/**
 * 클레임 리스 TTL — 30분.
 * Task 클레임 리스와 초안 편집 리스가 **같은 상수**를 쓴다(D-04 문서 축 확장).
 * 정본: docs/03-proposal/agent-integration.md §2.7
 */
export const LEASE_TTL_SECONDS = 1800;

/**
 * 첨부 파일당 상한 — 10MB(2026-09-01 사람 결정).
 * 스펙당 **합계는 제한하지 않는다** — 시안이 쌓이는 것은 문서가 자라는 것이다.
 * 정본: docs/04-mvp/api.md §2.10
 */
/**
 * **플랜 승인 게이트가 서는 파생 Task 수**(G2 · D-06 ② — spec-workflow §5 표).
 *
 * "파생 Task 4건 이상이거나 T3 티어 스펙에서 나온 대형 작업은 착수 전 플랜 승인을 받는다."
 * 수를 여기 두는 것은 게이트가 서는 자리와 그 수를 아는 곳이 갈라지지 않게 하기 위해서다.
 */
export const PLAN_APPROVAL_SIBLINGS = 4;

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * `nerv_spec_attachment_read` 가 한 번에 실어 주는 텍스트 상한(REQ-API-089).
 *
 * 업로드 상한(10MB)과 **다른 축이다.** 저장은 디스크의 문제이고 이쪽은 **세션의 컨텍스트
 * 예산**이다 — 2단계 업로드를 만든 이유가 바로 그것이었다(응답에 파일을 싣지 않는다).
 * 32KiB 는 대략 8천 토큰이라 한 턴이 감당할 만하고, 그보다 큰 것은 잘라내되 **잘랐다고
 * 말한다**. 통째로 필요하면 응답의 `url` 로 받아 파일로 다루는 편이 언제나 낫다.
 * 정본: docs/04-mvp/api.md §2.10
 */
export const ATTACHMENT_READ_MAX_BYTES = 32 * 1024;

/**
 * 하트비트 주기 — 60초.
 * `nerv_task_heartbeat` 의 응답은 서버→세션 역채널을 겸한다.
 * 정본: docs/03-proposal/agent-integration.md §2.3
 */
export const HEARTBEAT_INTERVAL_SECONDS = 60;

/**
 * 편집 리스를 쥔 **세션이 죽었다고 보는 유예** — 하트비트 3주기(180초).
 *
 * 리스 TTL(30분)과 세션 stale 임계(30분)가 같아서, 크래시한 에이전트의 리스는 30분간
 * 살아 있었다 — 그동안 사람은 자기 문서에서 막힌다. 하트비트는 60초마다 오고 있었는데
 * 리스가 그 신호를 안 봤다(2026-08-30 — 사람 결정). 3회 놓친 세션은 죽은 것으로 본다.
 *
 * **세션이 없는 표면(웹)에는 적용하지 않는다** — 하트비트가 없으니 오검출만 낸다.
 */
export const LEASE_HEARTBEAT_GRACE_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 3;

/**
 * 세션 stale 임계 — 30분(리스 TTL 과 같은 값).
 * 무활동 초과 시 `stale` 자동 전이 + 클레임 자동 회수(D-13).
 * 정본: docs/03-proposal/agent-integration.md §5.2
 */
export const SESSION_STALE_SECONDS = 1800;

/**
 * 월 파티션을 **몇 달 앞까지 미리 만들어 둘 것인가**(database.md §2.14).
 *
 * 0000 은 당월과 다음 달만 만든다. 그 뒤를 이어 만드는 주체가 없으면 마이그레이션 달
 * +2 부터 `event`·`activity` INSERT 가 "no partition of relation … found for row" 로
 * 실패하고, 이벤트는 도메인 트랜잭션 안에서 쓰이므로(REQ-CB-004) **모든 상태 전이가
 * 함께 롤백된다** — 승인도 클레임도 되지 않는 서버가 된다.
 *
 * 3개월인 이유: 워커가 하루 한 번 도는데 한 달치만 앞서면 워커가 며칠만 멈춰도 경계에
 * 닿는다. 12개월은 빈 파티션을 필요 이상으로 만든다. 마이그레이션 직후에는 잡을 한 번
 * 돌려 이 창을 채운다(apps/api/src/migrate.ts).
 */
export const PARTITION_MONTHS_AHEAD = 3;

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

/**
 * 연결당 join 가능한 project 룸 상한 — WS(api.md §3.2)·SSE(§3.5) 공통.
 *
 * 여기 있는 이유는 **사본이 셋이 될 뻔했기 때문이다**: 웹의 ws.ts 와 API 의 fanout.service.ts 가
 * 각각 8 을 들고 있었고 SSE 상한이 세 번째였다. 세 사본이 어긋나면 클라이언트는 9번째 룸을
 * 시도하고 서버는 거절하는데, 그 거절이 버그처럼 보인다.
 */
export const MAX_PROJECT_ROOMS = 8;

/**
 * 사용자당 동시 SSE 연결 상한(api.md §3.5). WS 의 룸 상한과 **같은 값**이다 — 한 사람이
 * 한 번에 지켜볼 수 있는 프로젝트 수라는 같은 물음의 답이라서.
 *
 * 세는 단위는 파드다. 열려 있는 소켓은 파드의 자원이고, 이 상한이 막으려는 것도 그
 * 자원의 고갈이다 — 클러스터 전역으로 세는 것이 오히려 물음과 어긋난다.
 */
export const MAX_SSE_PER_USER = MAX_PROJECT_ROOMS;

/**
 * 멱등 키 보존 시간 — 정본: docs/04-mvp/api.md §1.5.
 *
 * 24시간이 재시도의 현실적 상한이다. 그보다 오래 남은 키를 재생하는 것은 재시도가 아니라
 * 사고다 — 어제의 응답을 오늘의 요청에 돌려준다.
 */
export const IDEMPOTENCY_TTL_HOURS = 24;

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
 * **발견 큐만 상한이 다르다**(REQ-CB-006 의 예외 — 2026-09-05 에 여기로 올렸다).
 *
 * 근거는 규모다: clemvion 소급 적재 실측에서 발견이 **18,650건**이라 30건씩 끊으면
 * facet 을 좁히기 전에 페이지만 넘기게 된다(4.5 §2.6a). 게이트 표의 브랜치도 같다 —
 * 실측 441개다.
 *
 * **이 값들이 `review.service.ts` 안에 있었다.** 화면이 "더 있다" 를 판단하는 값과
 * 서버가 자르는 값이 갈리면 마지막 페이지에서 어긋나는데(그것이 위 두 상수를 여기 둔
 * 이유다), 정작 예외인 쪽이 서비스 파일에 박혀 있어 화면은 그 수를 알 길이 없었다.
 */
export const FINDING_PAGE_LIMIT_DEFAULT = 50;
export const FINDING_PAGE_LIMIT_MAX = 200;
export const GATE_BRANCH_LIMIT_DEFAULT = 20;
export const GATE_BRANCH_LIMIT_MAX = 200;

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
 * 표시 키를 **텍스트에서 찾는 규칙** — `<project.key>-<타입>-<base32 6자>`(data-model §5.1).
 *
 * 발급은 `@nerv/schema/keys`(node 전용, 해시를 쓴다)이고 여기에는 **모양만** 둔다.
 * 브라우저도 읽는 배럴이라 그렇고, 찾는 쪽은 서버·CLI·웹 모두이기 때문이다.
 *
 * 이 상수가 생긴 이유: GitHub 웹훅이 `TSK-xxxx` 라는 **옛 형식**을 찾고 있었다(2026-08-23 에
 * 키 공간을 넓히며 바뀐 형식을 따라오지 않았다). 그래서 PR 브랜치에 `CLV-T-7QF3K2` 를 적어도
 * 매칭이 0건이었고 FR-13(PR↔Task 자동 링크)은 현행 키로 발급된 어떤 Task 에서도 동작하지
 * 않았다 — 그 사이 테스트는 손으로 `TSK-` 키를 넣어 통과하고 있었다.
 *
 * 알파벳은 Crockford base32(`I`·`L`·`O`·`U` 제외)다 — `keys.ts` 의 BASE32 와 같은 집합이고,
 * `display-key.spec.ts` 가 둘이 어긋나지 않는지 본다.
 */
export const DISPLAY_KEY_PATTERN = '\\b[A-Z][A-Z0-9]{1,9}-[TS]-[0-9A-HJKMNP-TV-Z]{6}\\b';

/** 텍스트에서 Task 표시 키 하나를 찾는다(대문자만 — 사람이 소문자로 적으면 못 찾는다). */
export function findTaskKey(text: string): string | null {
  const re = new RegExp(DISPLAY_KEY_PATTERN.replace('[TS]', 'T'));
  return re.exec(text)?.[0] ?? null;
}

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

/**
 * **`nerv_task_update`·EP-TASK-09 가 받는 목표 상태 여섯**(2026-09-07 · REQ-API-129~132).
 *
 * `claimed` 가 빠져 있다. 그 상태로 가는 길은 원자적 클레임 하나뿐이고(`nerv_task_claim` —
 * [3.5 spec-workflow](../../../../docs/03-proposal/spec-workflow.md) §1.4), 상태를 직접 쓰는
 * 문이 열려 있으면 "활성 소유자는 한 명" 이 상태 축에서만 무너진다 — 클레임 행 없이 `claimed`
 * 인 Task 는 아무도 쥐지 않았는데 아무도 잡을 수 없는 Task 다.
 */
export const TASK_TRANSITION_TARGETS = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'done',
  'blocked',
] as const;

/**
 * **세션(에이전트) 경로가 살아 있는 자기 클레임 없이는 갈 수 없는 목표 셋**.
 *
 * 문서 셋이 이미 이것을 약속하고 있었다([3.4 agent-integration](../../../../docs/03-proposal/agent-integration.md)
 * §2.7 · [4.8 백로그](../../../../docs/04-mvp/backlog.md) E09-S05 수용 기준 · 4.4 REQ-API-005).
 * 그런데 서버는 활성 클레임이 **아예 없으면** 판정을 건너뛰었다 — 리스가 없으면 거부가 아니라
 * 무검사였다. 사람 경로는 다른 규칙이다(담당자·클레임 보유자·planner·admin).
 */
export const TASK_LEASE_BOUND_TARGETS = ['in_progress', 'in_review', 'done'] as const;

/**
 * **위임 명세 4요소가 실제로 채워졌는가**(2026-09-07 · REQ-API-131).
 *
 * 빈 문자열만 보면 안 된다. 임포터는 원본에 위임 명세가 없을 때 자리표시자를 넣는데
 * (`import.delegation_missing` — 로케일마다 다른 문자열이다), 그 값은 공백이 아니라서
 * "채워졌다" 로 세어졌다. 그래서 임포트된 Task 의 제목만 고쳐도 `ready` 로 튀고,
 * 에이전트는 **무엇을 하라는 말이 한 줄도 없는** 작업을 받는다. 자리표시자는 빈 것이다.
 *
 * 두 로케일 값을 모두 본다 — 적재한 사람의 로케일이 판정하는 사람의 로케일과 같다는
 * 보장이 없다.
 */
export function isDelegationFilled(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  return !DELEGATION_PLACEHOLDERS.has(trimmed);
}

const DELEGATION_PLACEHOLDERS = new Set(
  [ko['import.delegation_missing'], en['import.delegation_missing']].map((v) => v.trim()),
);
