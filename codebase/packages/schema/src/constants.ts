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
/**
 * 임포트가 `done` 으로 적재하는 Task 의 스펙 영향 선언 — **모른다는 표시**다.
 *
 * `{"none": true}` 는 "영향 없음을 확인했다" 는 **사람의 선언**이라, 임포터가 그것을 지어
 * 넣으면 거짓 부정이 된다(2026-09-07 · 사람 결정). done 게이트는 키 이름을 보지 않고
 * 비어 있지 않음만 보므로 판정에는 영향이 없고, 나중에 사람이 그 Task 를 열었을 때
 * "확인한 적 없다" 는 사실이 남는다.
 */
export const IMPORT_SPEC_IMPACT_UNKNOWN = { unknown: true } as const;

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
 * 표시 이름의 길이 상한 — 멤버 표·카드·활동 줄에 그대로 박힌다(2026-09-25 · REQ-API-186).
 *
 * 가입 때는 인증 스택이 받는 대로 들어왔고 상한이 어디에도 없었다. 사람이 이름을 바꾸는 문(EP-AUTH-02)을
 * 열면서 값을 한 곳에 둔다 — 화면의 입력 칸도 이 값을 읽는다.
 */
export const DISPLAY_NAME_MAX = 60;

/**
 * 비밀번호의 최소 길이 — 인증 스택(`minPasswordLength`)과 화면의 입력 칸이 같은 값을 읽는다(2026-09-25).
 * 세 자리(로그인·가입·내 계정)에 `8` 이 글자로 박혀 있었다 — 한쪽만 바꾸면 화면이 서버와 다른 약속을 한다.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * 비밀번호 재설정 링크의 수명(분) — 메일로 받은 링크를 이 시간 안에 열어야 한다(2026-09-25 · REQ-API-187).
 *
 * 초대(7일)보다 훨씬 짧은 이유는 **이 링크가 계정 그 자체이기 때문이다**: 메일함을 잠깐 본 사람이 비밀번호를
 * 정하고 모든 로그인을 가져간다. 되찾는 길(다시 받기)은 로그인 화면에서 언제나 열려 있다. 인증 스택의 기본값도
 * 1시간이지만 값을 여기 둔다 — 메일 본문이 "몇 분 안에" 를 말해야 하고, 그 숫자가 두 곳에 있으면 갈라진다.
 */
export const PASSWORD_RESET_TTL_MINUTES = 60;

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

/**
 * 자리표시자 문장 — 로케일마다 하나씩. **SQL 도 이 목록으로 판정한다**(REQ-API-175): 보드 목록의
 * `delegation_complete` 가 "NULL 이 아닌가" 만 보던 동안 자리표시자를 찬 것으로 셌고, 그래서
 * 임포트 작업을 backlog 로 되돌리면 [채우기] 없이 갇혔다 — 판정이 두 벌이면 한쪽이 틀린다.
 */
export const DELEGATION_PLACEHOLDER_TEXTS: readonly string[] = [
  ko['import.delegation_missing'],
  en['import.delegation_missing'],
].map((v) => v.trim());

const DELEGATION_PLACEHOLDERS = new Set(DELEGATION_PLACEHOLDER_TEXTS);

// ── 메일 발송 (2026-09-22 · 사람 결정 · database.md §2.17) ──────────────────
/**
 * 한 통을 몇 번까지 시도하는가. 백오프가 2의 거듭제곱(1·2·4·8·16분)이라 **상한까지 31분**이다.
 * 더 늘리면 죽은 서버를 며칠씩 두드리고, 줄이면 잠깐 막힌 서버 때문에 초대가 영영 안 간다.
 */
export const MAIL_MAX_ATTEMPTS = 5;
/**
 * 한 틱에 집는 통 수. 밀린 큐를 한 번에 비우려 들면 메일 서버의 속도 제한에 걸리고,
 * 그때 실패한 줄이 전부 백오프로 물러나 **오히려 더 늦게** 나간다.
 */
export const MAIL_BATCH_SIZE = 20;
/**
 * SMTP submission 포트 — `NERV_MAIL_PORT` 를 비우면 이 값이다(2026-09-24 · §5.2).
 *
 * 25 를 기본으로 두지 않는 이유는 그것이 **서버 간 릴레이** 포트이고 클라우드 사업자
 * 대부분이 막아 두기 때문이다. 587 은 평문으로 열어 `STARTTLS` 로 올린다.
 */
export const MAIL_SUBMISSION_PORT = 587;
/**
 * 암묵 TLS 포트 — 접속하자마자 TLS 다. `NERV_MAIL_SECURE` 를 비우면 포트가 이 값일 때만
 * 참이 된다. 587·25 와 바꿔 적으면 연결이 걸린 채 타임아웃하거나 핸드셰이크가 깨지는데,
 * 어느 쪽도 원인을 가리키지 않는다 — 그래서 사람이 고르지 않고 포트가 정하게 둔다.
 */
export const MAIL_IMPLICIT_TLS_PORT = 465;

// ── 플러그인 활성화 (2026-09-24 · E12-S03 · api.md EP-SES-06) ─────────────────
/**
 * 활성화 현황이 **몇 일 치 세션**을 보는가. 호스트는 등록되지 않는다 — 세션을 연 적이 있는
 * 기계가 곧 호스트이므로, 창이 없으면 한 번 쓰고 떠난 노트북이 영원히 "꺼짐" 으로 남아
 * 활성화율을 끌어내린다. 30일은 파일럿 한 주기(2주 스프린트 둘)를 덮는다.
 */
export const PLUGIN_COVERAGE_WINDOW_DAYS = 30;

// ── 게이트 티어의 산출 근거 (2026-09-26 · spec-workflow §2.4 · §6.4 · REQ-API-188) ─────────────
/**
 * 게이트 티어를 정하는 **네 축** — 각 0~2점, 합이 티어를 정한다. 이름은 spec-workflow §2.4 의 표를
 * 따른다(부작용 · 민감도 · 가역성 · 영향 범위). 제출·결재 요청 이벤트의 `gate_axes` 가 이 키로
 * 축별 점수를 싣고, 받은 요청 카드가 그대로 읽는다.
 */
export const GATE_AXES = ['side_effect', 'sensitivity', 'reversibility', 'blast_radius'] as const;
export type GateAxis = (typeof GATE_AXES)[number];
/**
 * 티어를 올리는 **동적 강화 신호** — 이벤트의 `gate_signals` 가 발동한 것만 싣는다. 이름은
 * 카탈로그의 `gate.reason.<키>` 와 같다. **여럿이 발동해도 티어는 한 단계만 오른다**(2026-09-26
 * 사람 결정 — spec-workflow §2.4). 롤백 이력 신호는 같은 날 걷었다 — NERV 에 "승인 후 롤백" 에
 * 해당하는 전이가 없다(버전 되돌리기가 생기면 다시 본다 · 재검토 트리거).
 */
export const GATE_SIGNALS = ['first_version', 'retry_threshold'] as const;
export type GateSignal = (typeof GATE_SIGNALS)[number];
/**
 * 신호의 **근거** — 사람이 따라가 볼 수 있는 원문 하나(2026-09-26 · REQ-API-189). 재시도 신호면
 * 에이전트가 올린 `e2e-fail-3x` 에스컬레이션(질문 또는 발견 처분)이다. 이벤트의 `gate_evidence`
 * 가 싣고 받은 요청 카드가 신호 곁에 링크로 그린다.
 */
export interface GateEvidence {
  signal: GateSignal;
  kind: 'question' | 'finding';
  id: string;
  title: string;
  task_key: string | null;
  session_id: string | null;
  /** 신고 시각 — ISO 문자열 */
  at: string;
}
