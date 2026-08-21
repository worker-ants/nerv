---
id: SPC-MVP-SCREENS
status: draft
updated: 2026-08-21
---
# 화면 명세

> **요약** — MVP 웹앱(Vite + React SPA)의 화면을 구현 착수 가능한 수준으로 확정한다. 대상은 로그인/온보딩 + S1 홈 · S2 프로젝트 개요 · S3 스펙 상세 · S4 작업 보드 · S5 세션 모니터 · S7 승인함 · S8 설정이며, S6 리뷰 센터는 Phase 2다([로드맵](../03-proposal/roadmap.md) §4). 각 화면에 대해 라우트·데이터 소스([API 명세](api.md) 리소스+동사 인용)·WebSocket 구독과 쿼리 무효화 매핑·컴포넌트 목록·폼 검증(zod)·EARS 수용 기준(REQ-WEB-*)을 명세한다. **MVP 라우트는 전부 와이어프레임을 갖는다** — S1~S8 그림의 정본은 [화면 설계 (와이어프레임)](../03-proposal/ui-wireframes.md)이고, 그 문서에 없는 MVP 신설 화면(앱 셸·로그인·온보딩·알림 센터)과 하위 뷰(스펙 목록·작업 상세 패널·세션 상세·설정 탭 3종)의 그림은 이 문서가 소유한다(§1.6 커버리지 표가 전 라우트의 소재를 밝힌다). 그 밖에 TipTap 에디터의 노드 화이트리스트와 md 왕복 규칙, 초안 편집 리스 UX, 기존 제안서 팔레트의 Tailwind 토큰 이식 표를 담는다.
>
> 문서 버전 v0.3 · 2026-08-21 · HTML 판: [screens.html](../html/screens.html)

---

## 1. 라우팅 맵과 앱 셸

### 1.1 이 문서의 정본 관계와 범위

| 무엇 | 정본 | 이 문서는 |
| --- | --- | --- |
| 화면 레이아웃·와이어프레임·인터랙션 원칙 — **S1~S8** | [3.6 화면 설계](../03-proposal/ui-wireframes.md) S1~S8 | 그림 재작성 금지 — 각 절에서 해당 §를 링크 인용 |
| 와이어프레임 — **S 번호가 없는 MVP 화면**(앱 셸·로그인·온보딩·알림 센터)과 **하위 뷰**(스펙 목록·작업 상세 패널·세션 상세·설정 탭 3종) | **이 문서**(§1.3·§2) | 3.6에 대응 그림이 없어 여기서 신규 작성한다. 상위 화면의 레이아웃 규약(3열 구성·상태 표기·인터랙션 원칙)은 3.6을 따르며 어기지 않는다 |
| REST·WebSocket 계약 | [4.4 API 명세](api.md) | 엔드포인트를 **ID(EP-*)와 메서드·경로**로 인용(권한·스키마·발생 이벤트는 api.md가 확정) |
| 엔티티 필드·상태 값 | [3.3 데이터 모델](../03-proposal/data-model.md) | 테이블·컬럼·enum 문자열을 그대로 사용 |
| 상태 전이·권한·이벤트 이름 | [3.5 스펙 워크플로우](../03-proposal/spec-workflow.md) | `<리소스>.<동사>` 이벤트 이름을 그대로 사용 |
| MCP 도구 이름·인자 | [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) §2 | `nerv_*` 도구명을 그대로 사용 |
| MVP 범위·스택 | [4.1 MVP 범위와 스택 확정](scope.md) · [3.7 로드맵](../03-proposal/roadmap.md) | 화면 범위 S1~S5·S7·S8 + 로그인/온보딩. S6·CR 델타 UI·커버리지 드릴다운·Slack/메일 알림은 Phase 2 |

예시 데이터는 기존 문서와 같은 한 벌을 쓴다 — 프로젝트 **clemvion**, 스펙 `SPC-CWC-007` · 요구사항 `REQ-CWC-031`, Task `TSK-3f77`(하나/mac-07) · `TSK-a3f8`(도현/mac-02) · `TSK-b904`(유나/linux-ci-01/codex), 세션 `S-b7e9` 등. 이 표기용 ID의 실제 발급 규칙(서버 발급 해시, `CLV-T-7QF3K2` 형식)은 [데이터 모델](../03-proposal/data-model.md) §5.1이 정의한다.

### 1.2 라우트 표 (TanStack Router)

파일 기반 라우팅을 쓴다. 전역(조직) 화면과 프로젝트 화면은 최상위 트리가 분리된다 — 이 분리는 ui-wireframes §1.2 IA 트리("전역은 S1·S7·알림·S8, 프로젝트 단위는 S2~S6")의 라우팅 표현이다. 프로젝트 스코프는 URL 두 번째 세그먼트다(ui-wireframes §1.4 URL 규약).

| 경로 | 화면 | 가드 | 비고 |
| --- | --- | --- | --- |
| `/login` | 로그인 | 비인증 전용 | 인증 상태면 `/`로 |
| `/onboarding` | 온보딩 | 인증 필요 | 소속 조직 0개일 때만 진입 |
| `/` | S1 홈 대시보드 | 인증 필요 | 활성 조직 컨텍스트 |
| `/o/:org` | 조직 전환 | 인증 필요 | 컨텍스트 전환 후 `/`로 리다이렉트(멀티 조직) |
| `/inbox` | S7 승인함 | 인증 필요 | 조직 전역 — 승인함은 하나(FR-14) |
| `/notifications` | 알림 센터(인앱 피드) | 인증 필요 | MVP는 인앱만 — Slack·메일·다이제스트는 Phase 2(로드맵 §1.3 FR-12) |
| `/settings` | S8 설정 | 인증 필요 | index는 멤버·역할 탭으로 |
| `/settings/members` | S8 멤버·역할 | admin 외 읽기 전용 | |
| `/settings/tokens` | S8 에이전트 토큰 | 인증 필요 | 본인 토큰 + admin은 전체 |
| `/settings/gates` | S8 게이트 정책 | `policy:edit`은 admin 전용 | |
| `/p/:proj` | S2 프로젝트 개요 | 프로젝트 멤버십 | |
| `/p/:proj/specs` | 스펙 트리(목록) | 멤버십 | 스펙 0건이면 빈 상태 + [+ 새 스펙] |
| `/p/:proj/specs/:spec` | S3 스펙 상세 | 멤버십 | 쿼리: `?v=<version_no>` `?diff=v3..v4` |
| `/p/:proj/tasks` | S4 작업 보드 | 멤버십 | 쿼리: `?spec=` `?assignee=` `?ai=1` |
| `/p/:proj/tasks/:task` | 작업 상세(오버레이 패널) | 멤버십 | 보드 위 패널 — URL 공유 가능 |
| `/p/:proj/sessions` | S5 세션 모니터 | 멤버십 | |
| `/p/:proj/sessions/:session` | 세션 상세(Activity 타임라인) | 멤버십 | |
| `/p/:proj/coverage` | 커버리지 드릴다운 | — | **Phase 2** — 라우트만 예약(로드맵 §3 비범위) |
| `/p/:proj/reviews` · `/p/:proj/crs/:cr` | S6 리뷰 센터 · CR 델타 | — | **Phase 2** — 라우트만 예약 |

```text
apps/web/src/routes/
  __root.tsx                 앱 셸: 전역 헤더 · 연결 상태 배너 · 토스트 아웃렛
  login.tsx                  /login
  onboarding.tsx             /onboarding
  index.tsx                  /            → S1
  o.$org.tsx                 /o/:org      → 조직 전환 리다이렉트
  inbox.tsx                  /inbox       → S7
  notifications.tsx          /notifications
  settings/route.tsx         /settings    셸(탭 내비게이션)
  settings/index.tsx           → members로 리다이렉트
  settings/members.tsx
  settings/tokens.tsx
  settings/gates.tsx
  p.$proj/route.tsx          /p/:proj     프로젝트 셸(멤버십 가드 · 프로젝트 탭)
  p.$proj/index.tsx            → S2
  p.$proj/specs.index.tsx      스펙 트리
  p.$proj/specs.$spec.tsx      S3
  p.$proj/tasks.index.tsx      S4
  p.$proj/tasks.$task.tsx      작업 상세 패널
  p.$proj/sessions.index.tsx   S5
  p.$proj/sessions.$session.tsx
```

리소스 지목은 항상 안정 ID다(`/p/clemvion/specs/SPC-CWC-007`) — 경로·제목이 바뀌어도 링크가 깨지지 않는다(FR-01 · D-09). 뷰 상태는 쿼리 문자열로 둬 알림 딥링크에 그대로 붙는다(ui-wireframes §1.4).

### 1.3 앱 셸 레이아웃

```text
┌────────────────────────────────────────────────────────────────┐
│ 전역 헤더  ⬢ NERV · [조직 ▾] · 홈 | 승인함 (2) | 알림 (5)      │ ← WS 배지
│           🔍 전역 검색                        [사용자 메뉴 ▾]  │
├────────────────────────────────────────────────────────────────┤
│ ⚠ 연결 상태 배너 (WS 끊김 · 오프라인 · 게이트 fail-open)      │ ← 조건부
├──────────────┬─────────────────────────────────────────────────┤
│ 프로젝트     │                                                 │
│ 사이드바     │              화면 콘텐츠 (라우트 아웃렛)        │
│ (S2~S5 탭 · │                                                 │
│  스펙 트리)  │                                                 │
├──────────────┴─────────────────────────────────────────────────┤
│ 토스트 스택 (겹침 경고 · 처리됨 트레일 · 되돌리기 링크)        │
└────────────────────────────────────────────────────────────────┘
```

| 셸 요소 | 명세 |
| --- | --- |
| 전역 헤더 | 조직 스코프. 승인함·알림 숫자 배지는 WebSocket으로 갱신(FR-11 · FR-12 · NFR-02). 승인함 배지는 **내 결정을 기다리는 것만** 센다(spec-workflow §6.6 원칙 3) |
| 프로젝트 사이드바 | `/p/:proj/*`에서만 렌더. 상단: 개요·스펙·작업·세션 탭(리뷰 탭은 Phase 2 — 비활성 + 툴팁). 하단: 스펙 트리(S3 좌측 트리와 같은 컴포넌트, 스크롤 위치 유지 — ui-wireframes §2.3 (1)) |
| 연결 상태 배너 | 2단계로 구분한다. ① WS 끊김(REST 정상): 배너 "실시간 갱신 중단 — 폴링으로 갱신 중" + 폴백 폴링 전환(REQ-WEB-002 · ui-wireframes §4.2). ② 플랫폼 연결 끊김(REST 실패 = `NERV_UNAVAILABLE`): 회색 배너 "오프라인 — 캐시된 읽기 전용. 복구 시 자동 동기화"로 격상(NFR-05 · ui-wireframes §3.4). 재연결 시 활성 화면 쿼리 전부 무효화 — 이벤트 유실 허용, 진실은 DB(D-14) |
| 토스트 스택 | `claim.conflict_warn` 겹침 경고, 승인 처리 후 "처리됨" 트레일(3분 유지 + 되돌리기 링크 — ui-wireframes §4.1) |

이 아스키 그림은 md 원본용 표기다 — **HTML 판(screens.html §1.3)은 ui-wireframes.html과 같은 방식의 렌더링 목업**으로 제공한다(관례: md는 아스키, html은 실제 UI 근사 렌더링 — ui-wireframes.md 서두와 동일).

### 1.4 실시간 계약 — 구독 룸과 쿼리 무효화

WebSocket은 NestJS `@WebSocketGateway`(socket.io 어댑터, websocket 전송만)이고, 핸드셰이크 인증·룸 join 규약·이벤트 전체 목록의 정본은 [api.md](api.md) §3이다. 클라이언트 계약은 세 줄이다.

1. **룸 2종** — `user:{id}`는 연결 성공 시 서버가 자동 join, `project:{id}`는 프로젝트 화면 진입 시 클라이언트가 join emit(서버가 멤버십 검사, 이탈 시 leave — api.md §3.2).
2. **이벤트는 무효화 신호다.** 이벤트 봉투에는 식별자만 있고 본문이 없다 — 수신하면 해당 TanStack Query 키를 invalidate하고 재조회한다(진실은 DB, D-14).
3. **재연결 = 전체 재조회.** 끊겼다 붙으면 활성 화면의 쿼리를 전부 무효화한다. 이벤트 재전송(replay)은 없다(api.md §3.4).

쿼리 키 규약과 이벤트 매핑 — 이벤트 이름은 [spec-workflow](../03-proposal/spec-workflow.md) §6.3 정본 + [api.md](api.md) §3.3에서 추가 확정된 이벤트(★)를 그대로 쓴다. api.md §3.4가 위임한 "이벤트 → 화면 Query 무효화" 매핑의 정의가 이 표다.

| 이벤트(`<리소스>.<동사>`) | 무효화하는 쿼리 키 | 수신 룸 |
| --- | --- | --- |
| `spec.draft_created` `spec.submitted` `spec.rejected` `spec.approved` `spec.superseded` `spec.deprecated` | `['spec', specId]` · `['spec', specId, 'versions']` · `['project', projId, 'specTree']` | `project:{id}` |
| `spec.comment_added` · ★`comment.resolved` | `['spec', specId, 'comments']` | `project:{id}` |
| `task.ready` `task.claimed` `task.blocked` `task.done` · ★`task.created` ★`task.updated` | `['project', projId, 'tasks']` · `['task', taskId]` | `project:{id}` |
| `task.rebrief_required` | `['project', projId, 'tasks']` · `['task', taskId]` + S4 재브리핑 배지 | `project:{id}` + 담당자·클레임 세션 소유자 `user:{id}` |
| `spec.recheck_requested` | `['spec', specId]` + S3 참조 갱신 배지 | `project:{id}` + 대상 문서 owner `user:{id}` |
| ★`baseline.created` | `['project', projId, 'baselines']` | `project:{id}` |
| `claim.conflict_warn` `claim.conflict_blocked` | `['project', projId, 'sessions']` + 경고 토스트 | `project:{id}` + 양쪽 세션 소유자 `user:{id}` |
| ★`claim.released` | `['project', projId, 'tasks']` · `['project', projId, 'sessions']` | `project:{id}` |
| `session.started` `session.stale` `session.complete` · ★`session.steered` | `['project', projId, 'sessions']` · `['session', sessionId]` | `project:{id}` |
| `approval.requested` `question.created` | `['inbox']` + 헤더 배지 | `user:{id}` + `project:{id}` |
| ★`question.answered` | `['inbox']` · `['project', projId, 'sessions']`(세션 재개 반영) | `user:{id}` + `project:{id}` |
| ★`notification.created` | `['me', 'notifications']` + 헤더 알림 배지 | `user:{id}` |
| `gate.bypassed` · `gate.failopen` | `['project', projId, 'events']` + 게이트 배너/카운터 | `project:{id}`(bypassed는 admin `user:{id}`에도) |
| `finding.opened` `finding.resolved` `cr.opened` | — Phase 2(S6·CR) | — |

세션 상세의 Activity 스트림과 하트비트·diff 갱신은 알림을 만들지 않고 `project:{id}` 룸으로만 흐른다(spec-workflow §6.3 말미). 리스 잔여·경과 시간 카운트다운은 서버 push가 아니라 응답의 `lease_expires_at`·`started_at`을 기준으로 한 클라이언트 시계 렌더링이다.

### 1.5 공통 상태·에러 규약

**상태 3종 공통 규칙** — 모든 화면은 로딩/빈/에러를 다음 기본값으로 처리하고, 각 화면 절에는 특이사항만 적는다.

| 상태 | 기본 처리 |
| --- | --- |
| 로딩 | 화면 골격(skeleton) — 스피너 단독 금지. 목록은 행 3개 골격, 카드는 카드 골격 |
| 빈 | "막다른 길 금지"(ui-wireframes §3.4) — 빈 문구 + 다음 행동 링크 1개 이상 |
| 에러 | 인라인 에러 카드 + [다시 시도]. 전역 토스트로 중복 알리지 않는다 |

**NERV_* 에러 코드 → UI 매핑.** REST 에러 포맷은 MCP와 같은 코드 체계를 재사용한다([api.md](api.md) §1 · [agent-integration](../03-proposal/agent-integration.md) §2.7).

| 코드 | UI 동작 |
| --- | --- |
| `NERV_UNAUTHENTICATED` | `/login`으로 리다이렉트(원래 경로 보존) |
| `NERV_FORBIDDEN` | 버튼 비활성 + 사유 툴팁(숨기지 않는다 — ui-wireframes §1.5) |
| `NERV_PRECONDITION` | `base_version` 불일치 409 — S3 저장 충돌 다이얼로그(§3.4) |
| `NERV_CONFLICT_SCOPE` | 클레임 겹침 모달 — 상대 세션의 사용자·hostname·scope 표시 |
| `NERV_LEASE_EXPIRED` | 리스 만료 배너 + 재클레임 안내 |
| `NERV_DRAFT_LEASED` | S3 읽기 전용 전환 + 보유자 배지 + [인계 요청] 버튼(§3.4) |
| `NERV_APPROVAL_REQUIRED` | "승인 대기 항목이 생성됨" 안내 + 승인함 딥링크 |
| `NERV_HUMAN_ONLY` | (에이전트 전용 코드 — 웹에서는 도달하지 않음. 도달 시 일반 에러 카드) |
| `NERV_RATE_LIMIT` | 재시도 대기 안내(Retry-After 존중) |
| `NERV_UNAVAILABLE` | 연결 상태 배너 격상 + 폴백 폴링 |

**셸 수용 기준**

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-001 | WHEN 비인증 사용자가 `/login` 외 경로에 접근하면 THE SYSTEM SHALL `/login`으로 리다이렉트하고 로그인 성공 시 원래 경로로 복귀시킨다 |
| REQ-WEB-002 | WHEN WebSocket 연결이 끊기면 THE SYSTEM SHALL 3초 이내에 연결 상태 배너를 표시하고 폴백 폴링으로 전환하며, 재연결 시 활성 화면의 쿼리를 전부 무효화한다 |
| REQ-WEB-003 | WHEN 사용자에게 권한이 없는 동작 버튼이 렌더링되면 THE SYSTEM SHALL 버튼을 숨기지 않고 비활성화하며 필요 역할을 툴팁으로 표기한다 (예: "이 전이는 `qa`(및 `admin`) 역할만 가능") |
| REQ-WEB-004 | WHEN `project:{id}` 룸에서 화면 관련 이벤트를 수신하면 THE SYSTEM SHALL 5초 이내에 해당 쿼리를 재조회해 화면에 반영한다(NFR-02) |

### 1.6 와이어프레임 커버리지 — 전 라우트의 그림 소재

**MVP 라우트는 전부 와이어프레임을 갖는다**(2026-08-21 확정). S1~S8은 [ui-wireframes](../03-proposal/ui-wireframes.md)가 정본이고, S 번호가 없는 MVP 신설 화면과 하위 뷰는 이 문서(§1.3·§2)가 그림을 소유한다. 이 표에 "없음"이 생기면 결함이다.

| 라우트(§1.2) | 화면 | 와이어프레임 소재 |
| --- | --- | --- |
| (전 라우트 공통) | 앱 셸 | **이 문서 §1.3** (html 판은 렌더링 목업) |
| `/login` | 로그인 | **이 문서 §2.1** |
| `/onboarding` | 온보딩 | **이 문서 §2.1** |
| `/` | S1 홈 대시보드 | ui-wireframes §2.1 |
| `/o/:org` | 조직 전환 | 화면 없음(컨텍스트 전환 후 즉시 리다이렉트) — 그림 비대상 |
| `/inbox` | S7 승인함 | ui-wireframes §2.7 (고충실도) |
| `/notifications` | 알림 센터 | **이 문서 §2.9** |
| `/settings/members` · `/tokens` · `/gates` | S8 설정 3탭 | ui-wireframes §2.8 (멤버·토큰·게이트 정책 3탭 합성 — 연동 탭은 Phase 2 비활성) |
| `/p/:proj` | S2 프로젝트 개요 | ui-wireframes §2.2 |
| `/p/:proj/specs` | 스펙 목록(트리 전체 화면) | **이 문서 §2.4** |
| `/p/:proj/specs/:spec` | S3 스펙 상세 | ui-wireframes §2.3 (고충실도) |
| `/p/:proj/tasks` | S4 작업 보드 | ui-wireframes §2.4 |
| `/p/:proj/tasks/:task` | 작업 상세 패널(오버레이) | **이 문서 §2.5** |
| `/p/:proj/sessions` | S5 세션 모니터 | ui-wireframes §2.5 (고충실도) |
| `/p/:proj/sessions/:session` | 세션 상세(Activity 타임라인) | ui-wireframes §2.5 둘째 그림(`S-8f31` 상세 — 탭·타임라인·산출물 역링크) |
| `/p/:proj/coverage` · `/reviews` · `/crs/:cr` | Phase 2(라우트만 예약) | S6은 ui-wireframes §2.6, 커버리지·CR 델타는 Phase 2 착수 시 작성 |

---

## 2. 화면별 명세

각 절의 형식: **데이터 소스**(api.md 리소스+동사 인용) → **실시간** → **핵심 컴포넌트** → **폼·검증**(zod, `packages/schema` 공유) → **상태·수용 기준**. S1~S8 와이어프레임 그림은 [ui-wireframes.md](../03-proposal/ui-wireframes.md)의 해당 §를 보고, 그 문서에 없는 화면·하위 뷰의 그림은 각 절 안에 둔다(§1.6 표).

### 2.1 로그인 · 온보딩

인증은 better-auth 세션 쿠키다(웹 경로 — [api.md](api.md) §1 인증 2경로). OAuth 2.1 리소스 서버는 Phase 2([scope.md](scope.md) §2 확정 스택).

| 화면 요소 | 데이터 소스 |
| --- | --- |
| 로그인 폼 | `POST /api/auth/*` (better-auth 핸들러 — 이메일+비밀번호) |
| 로그인 사용자·역할 확인 | EP-AUTH-01 `GET /api/v1/me` · EP-ORG-01 `GET /api/v1/orgs` |
| 온보딩(조직 0개) | better-auth organization 플러그인 경로(`/api/auth/*` — 조직 생성·초대 수락) 후 EP-ORG-01로 재확인 |

```text
로그인 — nerv.example.com/login
┌──────────────────────────────────────────────────┐
│                                                  │
│                    ⬢ NERV                        │
│         스펙 단일 진실 · 에이전트 협업           │
│                                                  │
│   이메일     [ jimin@example.com             ]   │
│   비밀번호   [ ••••••••                      ]   │
│   ⚠ 이메일 또는 비밀번호가 올바르지            │
│     않습니다 (인라인 · 비밀번호만 초기화)   (1)  │
│                                                  │
│   [              로그인              ]      (2)  │
│                                                  │
│   초대 링크로 오셨나요? 로그인하면 초대가        │
│   자동으로 수락됩니다.                      (3)  │
└──────────────────────────────────────────────────┘
```

1. **인라인 실패 사유** — 전역 토스트가 아니라 폼 안. 비밀번호 필드만 초기화한다. `REQ-WEB-005`
2. **로그인** — better-auth 세션 쿠키 발급 후 역할별 첫 화면으로 착지(§1.2 가드). `REQ-WEB-006`
3. **초대 수락 경로** — 초대 링크 진입 시 로그인 후 `InviteAcceptCard`로 이어진다(온보딩 ① 대체).

```text
온보딩 — nerv.example.com/onboarding          (소속 조직 0개일 때만 진입)
┌──────────────────────────────────────────────────────────────┐
│  ● ① 조직 만들기 ──── ○ ② 역할 확인 ──── ○ ③ 다음 행동      │
├──────────────────────────────────────────────────────────────┤
│  새 조직 만들기                          (1)                 │
│   조직 이름   [ 아크메                    ]                  │
│   첫 프로젝트 [ acme-console              ]                  │
│   [ 만들기 ]                                                 │
│  ── 또는 ──                                                  │
│  📨 받은 초대                             (2)                │
│   아크메 · planner 로 초대됨 — 지민       [수락]             │
├──────────────────────────────────────────────────────────────┤
│  ② 당신의 역할: planner — 스펙 승인·플랜 검토가 옵니다  (3)  │
│  ③ 다음 행동: 승인함으로 이동 ▸                         (4)  │
│     에이전트를 연결하려면: 설정 › 에이전트 토큰 ▸            │
└──────────────────────────────────────────────────────────────┘
```

1. **조직 생성**(`OrgCreateForm`) — better-auth organization 플러그인 경로. 첫 프로젝트를 같이 만든다.
2. **초대 수락**(`InviteAcceptCard`) — 조직 생성과 배타적 분기. MVP 초대는 기존 사용자 배정이다(메일 발송은 Phase 2 — api.md §2.1).
3. **역할 확인** — `membership.role` 6종 기준으로 이 역할이 받게 될 게이트·카드를 한 줄로 설명한다.
4. **다음 행동** — 역할별 첫 화면 규칙(ui-wireframes §1.5, qa는 MVP에서 작업 보드로)대로 착지 링크. 에이전트 연결(PAT 발급→플러그인 설치)은 [plugin.md](plugin.md) §4로 링크만 둔다.

- **컴포넌트**: `LoginForm` · `InviteAcceptCard` · `OrgCreateForm`. 폼은 react-hook-form + zod(`LoginInput`: email 형식, password min 8).
- 온보딩 마지막 단계는 역할 확인과 "다음 행동" 안내다 — planner/designer는 승인함, developer는 작업 보드, qa는 (MVP에서는) 커버리지가 아니라 작업 보드로 안내한다(ui-wireframes §1.5 역할별 첫 화면 — S6은 Phase 2이므로 qa 착지만 조정). 에이전트 연결 온보딩(PAT 발급→플러그인 설치)은 [plugin.md](plugin.md) §4가 정의하고, 이 화면은 S8 토큰 탭으로 가는 링크만 둔다.

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-005 | WHEN 로그인에 실패하면 THE SYSTEM SHALL 실패 사유를 폼 인라인으로 표시하고 비밀번호 필드만 초기화한다 |
| REQ-WEB-006 | WHEN 로그인한 사용자의 소속 조직이 0개이면 THE SYSTEM SHALL `/onboarding`으로 보내고, 1개 이상이면 역할별 첫 화면 규칙에 따라 착지시킨다 |

### 2.2 S1 홈 대시보드 — [ui-wireframes §2.1](../03-proposal/ui-wireframes.md)

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 오늘 할 일 숫자 | EP-APR-01 `GET /api/v1/approvals` (state=pending — 승인함 목록) | MVP는 승인 대기·답변 대기 질문 2숫자. 와이어프레임의 "내가 만든 CR" 칩은 Phase 2(CR) |
| 내 승인 대기 카드 | 위와 동일 목록의 상위 N건 | 카드 위 승인/거절/코멘트 — S7과 같은 `ApprovalCard` 재사용 |
| 내 질문 큐 | 승인함 목록 중 `subject_type = question` | 세션 신원 3요소(사용자·hostname·에이전트 종류)와 대기 시간 필수 표기 |
| 내 프로젝트 카드 | EP-PRJ-01 `GET /api/v1/orgs/{org}/projects` + EP-PRJ-03 `GET /api/v1/projects/{proj}`(활성 세션/승인 대기 카운트 포함) | 승인률·커버리지 게이지 고도화는 Phase 2 — MVP는 상태별 카운트 표시 |
| 최근 알림 | EP-NTF-01 `GET /api/v1/me/notifications` · 읽음 처리 EP-NTF-02 | 인앱 피드. `notification` 파생·읽음 상태는 [data-model](../03-proposal/data-model.md) §2.9 |

- **실시간**: `user:{id}` 룸 — `approval.requested` · `question.created` → `['inbox']` + 배지, `notification.created` → 알림 피드. 프로젝트 카드는 화면 재진입 시 재조회(홈에서 `project:{id}` 룸은 join하지 않는다).
- **컴포넌트**: `TodayStrip` · `ApprovalCard` · `QuestionCard` · `ProjectCard` · `EventFeed`.
- **빈 상태**: 승인 대기 0건 — "지금 당신을 기다리는 항목이 없습니다" + 최근 처리 3건(ui-wireframes §3.4).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-007 | WHEN `approval.requested` 또는 `question.created` 이벤트를 수신하면 THE SYSTEM SHALL 5초 이내에 헤더 배지와 오늘 할 일 숫자를 갱신한다(NFR-02) |
| REQ-WEB-008 | WHEN 질문 카드를 렌더링하면 THE SYSTEM SHALL 요청 세션의 사용자·hostname·에이전트 종류와 대기 경과 시간을 함께 표기한다(FR-07 · D-13) |

### 2.3 S2 프로젝트 개요 — [ui-wireframes §2.2](../03-proposal/ui-wireframes.md)

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 스펙 트리 + 상태 배지 | EP-SPEC-01 `GET /api/v1/projects/{proj}/specs/tree` | 노드: id·title·type(6종)·현재 버전 문서 상태 — `nerv_spec_tree`와 같은 서비스(D-05) |
| 구현 현황 카드 | EP-COV-01 `GET /api/v1/projects/{proj}/coverage` (requirement `impl_status` 집계) | MVP는 전체·영역별 카운트(`unimplemented / in_progress / implemented / verified`). Evidence 기반 자동 계산·드릴다운은 Phase 2(로드맵 §3 — FR-03 ◐, 커버리지 대시보드 비범위) |
| 활성 세션 스트립 | EP-SES-01 `GET /api/v1/projects/{proj}/sessions` (state 필터) | 미니 세션 카드 — hostname·에이전트 종류·하트비트·diff 생략 금지(ui-wireframes §2.2 (3)) |
| 최근 이벤트 | EP-EVT-01 `GET /api/v1/projects/{proj}/events` (커서 페이지네이션) | 항목마다 `is_agent` 아이콘 구분(D-08) |

- **실시간**: `project:{id}` 룸 — `spec.*` → 트리, `session.*` → 세션 스트립, 이벤트 피드는 모든 수신 이벤트를 prepend 후 재조회.
- **컴포넌트**: `SpecTree`(사이드바와 공유) · `ImplStatusCard` · `SessionStrip` · `EventFeed` · `NewSpecButton`(권한: 역할 매트릭스 — spec-workflow §1.6).
- **빈 상태**: 스펙 0건 — "첫 스펙을 만드세요" + [+ 새 스펙] + [clemvion 임포트 안내 ▸](importer.md).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-009 | WHEN 스펙 트리를 렌더링하면 THE SYSTEM SHALL 각 노드에 타입과 문서 상태 배지를 표기하고, `spec.approved` 등 문서 축 이벤트 수신 시 5초 이내 배지를 갱신한다 |
| REQ-WEB-010 | WHEN 이벤트 피드 항목을 렌더링하면 THE SYSTEM SHALL `event.is_agent` 값에 따라 사람/에이전트 아이콘을 구분 표기한다(FR-16 · D-08) |

### 2.4 S3 스펙 상세 — [ui-wireframes §2.3](../03-proposal/ui-wireframes.md)

3열 레이아웃(좌 트리 · 중앙 본문 · 우 상태 패널). 에디터 상세 규약은 §3에 있다.

**하위 뷰: 스펙 목록** (`/p/:proj/specs`) — 사이드바 트리(`SpecTree`)의 전체 화면 판이다. 그림은 ui-wireframes에 없어 여기서 소유한다(§1.6).

```text
스펙 목록 — nerv.example.com/p/clemvion/specs
┌──────────────────────────────────────────────────────────────────────┐
│ 스펙   [🔍 검색…]  [타입 ▾] [상태 ▾] [베이스라인 ▾](4)  [+ 새 스펙](1) │
├──────────────────────────────────────────────────────────────────────┤
│ ▾ 1-product-vision                                                   │
│    비전                vision    ✅ approved  v3   2주 전       💬 0 │
│ ▾ 7-channel-web-chat                                            (2)  │
│    1-widget            feature   ✅ approved  v7   4일 전       💬 1 │
│    2-embed-v2          feature   🕐 in_review v4   2시간 전     💬 3 │
│    3-states            design    📝 draft     v1   1시간 전     💬 0 │
│ ▸ 5-system (12)                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ 표시 24 / 전체 38 · 필터: 전체                                  (3)  │
└──────────────────────────────────────────────────────────────────────┘
```

1. **생성 진입점** — 권한은 역할 매트릭스(spec-workflow §1.6). 행 클릭은 S3 상세로.
2. **행 = 트리 노드 + 메타** — 타입(6종)·문서 상태·현재 버전·최근 갱신·open 코멘트 수. 데이터는 S2·S3 트리와 같은 EP-SPEC-01(+ 검색은 EP-SPEC-02) — 컴포넌트도 `SpecTree` 공유다(D-05의 프론트 판).
3. **필터 결과 카운트** — 검색·타입·상태 필터는 URL 쿼리로 보존한다(ui-wireframes §1.4 뷰 상태 규약).
4. **베이스라인 선택기** — EP-SPEC-11 목록 + [현재 세트로 동결…](planner·admin — EP-SPEC-12 다이얼로그). 베이스라인을 고르면 `?baseline=` 쿼리로 목록이 그 세트에 핀된 버전 기준으로 렌더된다(spec-workflow §3.6). 새 라우트 없음 — 뷰 상태 쿼리다.

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 본문 + 메타 | EP-SPEC-03 `GET /api/v1/projects/{proj}/specs/{spec}` (`include[]`: requirements·tasks·comments) | 기본 버전은 최신 `approved` — draft는 명시 선택(`?v=`) |
| 버전 목록·diff | EP-SPEC-04 `GET /api/v1/projects/{proj}/specs/{spec}/versions` · EP-SPEC-06 `GET .../specs/{spec}/diff` | `?diff=v3..v4` 뷰 상태 → EP-SPEC-06(from, to)으로 조회. 표기는 ui-wireframes §4.3 |
| 초안 저장 | EP-SPEC-08 `PUT /api/v1/projects/{proj}/specs/{spec}/draft` (draft upsert — `base_version` 전제조건) | `nerv_spec_draft_upsert`와 같은 서비스·같은 zod 스키마(D-05) |
| 사전 검토 | EP-SPEC-09 `GET /api/v1/projects/{proj}/spec-versions/{ver}/check` | 5검사기 결과(warning/block + 앵커) — `nerv_spec_check`와 동일 |
| 검토 요청 | EP-SPEC-10 `POST /api/v1/projects/{proj}/spec-versions/{ver}/submit` | `draft → in_review` — 성공 시 승인함 카드 생성(FR-11) |
| 코멘트 | EP-CMT-01 `GET .../specs/{spec}/comments` · EP-CMT-02 `POST .../spec-versions/{ver}/comments` · EP-CMT-04 `POST .../comments/{id}/resolve` | 앵커: 헤딩 slug 또는 Requirement `ref`(§3.3) |
| 우측 패널 | include 응답의 requirement 목록(`ref`·`statement_md`·`impl_status`) · 파생 task 목록 | "관련 리뷰" 패널은 Phase 2(S6) — 자리만 비활성 표시. **참조 갱신 배지**: `spec.recheck_requested` 수신 시 "참조 스펙에 앞선 버전 존재" 표시(spec-workflow §3.3 참조 문서 전파) |
| 베이스라인 조회 | EP-SPEC-11 `GET .../baselines` · EP-SPEC-13 `GET .../baselines/{bl}` | 버전 피커(`VersionPicker`)에 베이스라인 항목 — 선택 시 그 세트에 핀된 버전을 표시(`?baseline=` 쿼리, spec-workflow §3.6) |

- **실시간**: `project:{id}` 룸 — `spec.*` → `['spec', specId]`, `spec.comment_added`·`comment.resolved` → `['spec', specId, 'comments']`, `task.*` → 파생 Task 패널.
- **컴포넌트**: `SpecTree` · `VersionPicker` · `DiffToggle` · `SpecEditor`(TipTap — §3) · `SourceViewToggle`(read-only md) · `CommentThread` · `EditLeaseBadge` · `RequirementPanel` · `DerivedTaskPanel` · `StatusPanel` · `SubmitReviewButton` · `TerminalHandoffCard`.
- **버튼 상태**: [검토 요청]은 사전 검토 BLOCK 존재 시 비활성 + 결과 인라인(spec-workflow §2.1). [CR 제안]은 Phase 2 — 비활성 + "Phase 2" 툴팁(로드맵 §3 비범위). 승인/거절은 이 화면이 아니라 승인함 카드에서 한다(S7).
- **터미널 이어쓰기**: 복사용 명령 `claude "/nerv:spec edit SPC-CWC-007"` 카드(ui-wireframes §2.3 (12)). 반대 방향은 `nerv_spec_draft_upsert` 응답의 `web_url` 딥링크가 이 화면으로 온다.
- **폼·검증**: `SpecDraftUpsertInput`(zod — `packages/schema`, MCP 도구 인자와 공유): `body_markdown`·`base_version`·`change_summary`(min 1), 새 스펙 생성은 `SpecCreateInput`(`parent_id`·`type` 6종 enum·`title` min 1·`body_markdown`). 코멘트 `CommentCreateInput`: `anchor`(min 1)·`body_md`(min 1).
- **빈 상태**: 요구사항 0건 — "이 버전에는 요구사항 블록이 없습니다" + EARS 템플릿 안내 링크.

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-011 | WHEN 스펙 상세를 열면 THE SYSTEM SHALL 최신 `approved` 버전을 기본 표시하고, draft 열람은 명시적 버전 선택으로만 허용한다(D-02) |
| REQ-WEB-012 | WHEN 다른 사용자가 편집 리스를 보유한 draft를 열면 THE SYSTEM SHALL 에디터를 읽기 전용으로 전환하고 보유자(사용자·표면·최신 갱신)와 [인계 요청] 버튼을 표시한다(`NERV_DRAFT_LEASED`) |
| REQ-WEB-013 | WHEN 저장 요청이 `NERV_PRECONDITION`(base_version 불일치 409)으로 실패하면 THE SYSTEM SHALL 로컬 본문을 버리지 않은 채 충돌 다이얼로그(서버 최신 보기·내 본문 복사)를 표시한다 |
| REQ-WEB-014 | WHEN 사전 검토 결과에 block이 1건 이상이면 THE SYSTEM SHALL [검토 요청] 버튼을 비활성화하고 검사기별 결과와 앵커 위치를 인라인 표시한다 |
| REQ-WEB-015 | WHEN 본문이 새 버전으로 바뀌어도 THE SYSTEM SHALL 헤딩 slug·Requirement `ref` 앵커의 코멘트 스레드를 유지 표시한다(D-09) |
| REQ-WEB-037 | WHEN `spec.recheck_requested`를 수신하거나 대상 문서의 참조 스펙에 앞선 approved 버전이 존재하면 THE SYSTEM SHALL S3 상태 패널에 참조 갱신 배지(참조 스펙·핀 시점 버전·최신 버전)를 표시한다 |

### 2.5 S4 작업 보드 — [ui-wireframes §2.4](../03-proposal/ui-wireframes.md)

칸반 레인: `ready / claimed / in_progress / in_review / done(7d)` + 하단 `blocked` 접이식 레인. `backlog`는 필터로 노출.

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 보드 목록 | EP-TASK-01 `GET /api/v1/projects/{proj}/tasks` (status·spec·assignee 필터) | 카드: 제목·출처 스펙·👤 assignee·🤖 delegate(hostname)·리스 잔여·diff |
| 작업 상세 패널 | EP-TASK-04 `GET /api/v1/projects/{proj}/tasks/{task}` | 위임 명세·활성 클레임·의존·Evidence — 보드 위 오버레이(`/p/:proj/tasks/:task`, URL 공유 가능). 그림은 아래(§1.6) |
| Task 파생·생성 | EP-TASK-03 `POST /api/v1/projects/{proj}/tasks` | 승인된 SpecVersion에서만 파생 — 버튼은 approved 아닌 스펙에서 비활성(D-02) |
| 위임 명세 편집 | EP-TASK-05 `PATCH /api/v1/projects/{proj}/tasks/{task}` | 4요소: `goal_md`·`output_format_md`·`tools_sources_md`·`boundaries_md`(data-model §2.4). 충족 시 서버가 `ready` 승격 |
| 사람 클레임 | EP-TASK-06 `POST /api/v1/projects/{proj}/tasks/{task}/claim` | `claim.agent_session_id` NULL — `nerv_task_claim`과 같은 서비스·같은 겹침 판정 |
| 상태 전이 | EP-TASK-09 `POST /api/v1/projects/{proj}/tasks/{task}/transition` | 서버 가드 거부 시 사유를 그대로 카드 툴팁으로 |

**하위 뷰: 작업 상세 패널** (`/p/:proj/tasks/:task`) — 보드 위 오버레이. 그림은 ui-wireframes에 없어 여기서 소유한다(§1.6).

```text
작업 상세 패널 — nerv.example.com/p/clemvion/tasks/TSK-a3f8   (보드 위 오버레이)
┌──────────────────────────────────────────────── [닫기 ✕] ──┐
│ TSK-a3f8 · 위젯 상태별 렌더링          🕐 in_progress  (1) │
│ 출처: SPC-CWC-007 @v4 ▸ · REQ-CWC-031 ▸               (2) │
├────────────────────────────────────────────────────────────┤
│ 위임 명세 (4요소 — 전부 충족 시 ready)                (3)  │
│  ✅ 목표        REQ-CWC-031 위젯 5상태 렌더링 구현         │
│  ✅ 산출물 형식 React 컴포넌트 + 스토리 + 단위 테스트      │
│  ✅ 도구·출처   SPC-CWC-007 §4 · 디자인 토큰               │
│  ✅ 경계        codebase/apps/web/src/widget/** 밖 수정 금지│
├────────────────────────────────────────────────────────────┤
│ 활성 클레임                                           (4)  │
│  👤 도현 · 🤖 mac-02/claude-code · 리스 22:41 · scope:     │
│  SPC-CWC-007 + widget/**            [세션 보기 ▸]          │
│ 의존: TSK-3f77(done ✅) → 이 작업                     (5)  │
│ Evidence: PR #481 ▸ · 커밋 4 ▸                        (6)  │
├────────────────────────────────────────────────────────────┤
│ [in_review로 전이]  [blocked 표시]  [클레임 해제]     (7)  │
└────────────────────────────────────────────────────────────┘
```

1. **상태 + 표시 키** — URL로 공유 가능(안정 ID — D-09).
2. **출처 역링크** — 유래 SpecVersion(불변 스냅샷)과 Requirement로. "왜 이 작업인가"가 한 클릭. `FR-05 · D-03`
3. **위임 명세 4요소** — `goal_md`·`output_format_md`·`tools_sources_md`·`boundaries_md`. 미충족 요소는 ❌ + 인라인 편집(EP-TASK-05). `FR-05 · REQ-WEB-016`
4. **활성 클레임** — 사람 assignee와 에이전트 delegate 동시 표기(D-08), 리스 카운트다운, 선언 scope, S5 세션 딥링크. `FR-06`. 출처 줄의 기준 버전(`@v4`)이 superseded면 **재브리핑 배지**(⟳ 기준 버전 v4 → 최신 v5)가 뜬다 — `rebrief_required_at`·spec-workflow §3.3. `REQ-WEB-036`
5. **의존 그래프** — 미해소 의존은 ready 불가 사유로 표기. `FR-05`
6. **Evidence** — PR·커밋 링크(FR-13). 리뷰 커버리지 표시는 Phase 2.
7. **전이 버튼** — 서버 게이트 거부 시 사유 툴팁(REQ-WEB-018). 권한 없는 버튼은 숨기지 않고 비활성(REQ-WEB-003).

- **실시간**: `project:{id}` 룸 — `task.ready` `task.claimed` `task.blocked` `task.done` `task.created` `task.updated` `claim.released` → 보드 재조회. 리스 카운트다운은 클라이언트 시계.
- **컴포넌트**: `TaskBoard` · `TaskCard`(위임 명세 체크 표시·리스 카운트다운·세션 상태 dot → S5 딥링크) · `TaskDetailPanel` · `TaskCreateDialog` · `BlockedLane`.
- **폼·검증** — 위임 명세 4요소는 zod로도 강제한다(서버 검증의 프론트 미러):

```ts
// packages/schema — TaskCreateInput (발췌)
export const TaskCreateInput = z.object({
  title: z.string().min(1),
  body_md: z.string().optional(),
  source_spec_version_id: z.string().uuid(),
  source_requirement_id: z.string().uuid().optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  goal_md: z.string().min(1, '목표(REQ ID 포함)는 필수'),
  output_format_md: z.string().min(1, '산출물 형식은 필수'),
  tools_sources_md: z.string().min(1, '도구·출처는 필수'),
  boundaries_md: z.string().min(1, '경계는 필수'),
});
```

- **done 전이**: MVP의 서버 게이트는 `spec_impact` 선언 + Evidence 연결이다. 리뷰 커버리지 판정(FR-10 게이트 전체)은 Phase 2(로드맵 §3 비범위) — 카드의 "리뷰 n/n" 표시는 Phase 2에 함께 온다. 전이 거부 시 카드는 제자리로 돌아가고 사유 툴팁이 뜬다.
- **빈 상태**: ready 0건 — "ready인 Task가 없습니다 — blocked N건의 의존성 보기 ▸"(ui-wireframes §3.4).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-016 | WHEN 위임 명세 4요소 중 하나라도 비어 있으면 THE SYSTEM SHALL Task 카드에 `ready` 전이 불가 사유를 인라인 표기하고 전이 버튼을 비활성화한다(FR-05) |
| REQ-WEB-017 | WHEN `claimed`/`in_progress` 카드를 렌더링하면 THE SYSTEM SHALL `lease_expires_at` 기준 리스 잔여를 카운트다운으로 표시하고, 잔여 2분 미만이면 호박색으로 전환한다(D-04) |
| REQ-WEB-018 | WHEN 서버가 상태 전이를 거부하면 THE SYSTEM SHALL 카드를 원 위치로 되돌리고 거부 사유를 툴팁으로 표시한다(FR-10) |
| REQ-WEB-036 | WHEN `rebrief_required_at`이 세팅된 Task를 렌더링하면 THE SYSTEM SHALL 보드 카드와 상세 패널에 재브리핑 배지(기준 버전 → 최신 approved 버전)를 표시하고, 위임 명세 재확인·기준 버전 갱신(EP-TASK-05) 경로를 제공한다 |

### 2.6 S5 세션 모니터 — [ui-wireframes §2.5](../03-proposal/ui-wireframes.md)

세션 카드 필수 표기는 와이어프레임 규약 그대로다 — 신원 3요소(사용자·hostname·에이전트 종류) · 클레임한 Task와 유래 스펙 · 하트비트/리스 잔여/경과 · 브랜치/diff 통계 · 선언 scope · 액션.

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 세션 보드 | EP-SES-01 `GET /api/v1/projects/{proj}/sessions` (state 필터: `pending / active / awaiting_input / complete / error / stale`) | 요약 스트립 = 상태별 집계 |
| 세션 상세 | EP-SES-02 `GET /api/v1/projects/{proj}/sessions/{sid}` | `agent_session` 필드(data-model §2.5): hostname·agent_type·branch·diff_added/removed·current_task_id |
| Activity 타임라인 | EP-SES-03 `GET /api/v1/projects/{proj}/sessions/{sid}/activities` (커서) | `thought / action / elicitation / response / error` 5종 — 불변 레코드(D-10) |
| steer / stop | EP-SES-04 `POST /api/v1/projects/{proj}/sessions/{sid}/steer` (`kind`: steer/stop) | 지시는 다음 `nerv_task_heartbeat` 응답의 `pending`에 실린다(agent-integration §2.4 역채널) — UI는 "다음 하트비트에 전달" 안내 |

- **실시간**: `project:{id}` 룸 — `session.started` `session.stale` `session.complete` `session.steered` → 보드, Activity 스트림·하트비트/diff 갱신도 같은 룸으로 흐른다(알림 아님 — spec-workflow §6.3). 하트비트 표기는 상대 시각만(ui-wireframes §3.3).
- **컴포넌트**: `SessionBoard` · `SessionCard` · `SessionSummaryStrip` · `ActivityTimeline` · `ScopeChips`(spec_ids + file_globs) · `SteerDialog` · `StopDialog`(사유 필수) · `FailOpenBanner`(게이트 판정 실패 카운터 — 판정 자체는 Phase 2, 배너 컴포넌트는 자리 확보).
- **액션 4종**: 로그 보기 · attach ↗(세션 상세 딥링크) · steer(중단 없이 지시 큐잉) · stop(확인 + 사유, 클레임 즉시 회수 → Task `ready`). `awaiting_input` 카드는 [질문 열기 ↗]로 승인함 딥링크.
- **폼·검증**: `SessionSteerInput`(`kind`: steer/stop, `message` min 1 — stop의 message가 곧 사유). 스티어 메시지는 승인이 아니다(ui-wireframes §4.2 보안 불변식).
- **빈 상태**: 활성 세션 0 — "실행 중인 세션이 없습니다" + 플러그인 온보딩 링크([plugin.md](plugin.md) §4).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-019 | WHEN 세션 카드를 렌더링하면 THE SYSTEM SHALL 사용자·hostname·에이전트 종류·하트비트 상대 시각·리스 잔여·diff 통계를 표기하며, hostname이 없는 세션은 렌더링하지 않는다(ui-wireframes §3.3) |
| REQ-WEB-020 | WHEN 세션이 `stale`로 전이되면 THE SYSTEM SHALL 카드에 회수된 Task ID와 "무활동 임계 30:00 초과 → 자동 전이"를 표시한다(D-13) |
| REQ-WEB-021 | WHEN 사용자가 stop을 실행하면 THE SYSTEM SHALL 확인 다이얼로그에서 사유를 필수로 받고, 처리 후 해당 Task가 `ready`로 회수된 것을 보드에 반영한다 |

### 2.7 S7 승인함 — [ui-wireframes §2.7](../03-proposal/ui-wireframes.md)

MVP 카드 유형은 3종이다 — **스펙 승인 · 플랜 승인 · 질문**(로드맵 §3: CR·에스컬레이션 유형은 Phase 2). 필터 사이드바의 CR·에스컬레이션 항목은 비활성 + "Phase 2" 표기.

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 대기 목록 | EP-APR-01 `GET /api/v1/approvals` (state=pending · 유형/프로젝트 필터 — 승인함 목록) | `approval.subject_type`: `spec_version / plan / question`(MVP) — data-model §2.7 |
| 결정 | EP-APR-03 `POST /api/v1/approvals/{id}/decision` | `decision`: `approve / reject / comment`(spec-workflow §2.5) |
| 질문 답변 | EP-QST-02 `POST /api/v1/projects/{proj}/questions/{id}/answer` | `answer_key`(선택지) 또는 `answer_md` — 내부적으로 승인 결정과 한 경로(api.md §2.6) |
| 카드 본문 | EP-APR-01 응답 `ApprovalCard`에 대상 리소스 원문 포함(스펙 델타·질문 원문·선택지) | 요약문이 아니라 **원문 우선**(spec-workflow §6.4 — OWASP ASI09 방어) |

- **실시간**: `user:{id}` 룸 — `approval.requested` `question.created` → `['inbox']` + 배지, `question.answered` → 카드의 "요청 세션에 전달됨" 반영.
- **컴포넌트**: `InboxFilterRail` · `ApprovalCard`(S1과 공유) · `SpecApprovalCard`(변경분 미리보기 + 자동 사전 검토 결과 인라인) · `PlanApprovalCard`(승인/수정 요청/거절 3분기) · `QuestionCard`(라디오 선택지 + 코멘트 필드 + "처리 시 요청 세션에 즉시 전달" 고지) · `ProcessedTrail` · `SlaBadge`(24h 초과 경고 — spec-workflow §2.6).
- **결정 규칙의 UI 반영**: 지시자≠승인자 — 요청자와 승인자가 같으면 승인 버튼 비활성 + 툴팁, 에이전트 작성 초안은 세션 소유자 단독 승인 불가 배너(spec-workflow §2.3). 소규모 완화 시 차단 대신 배너 + 감사 이벤트.
- **키보드**: `j/k` 이동 · `a` 승인 · `r` 거절 · `c` 코멘트(ui-wireframes §4.6).
- **폼·검증**:

```ts
// packages/schema — ApprovalDecisionInput (발췌)
export const ApprovalDecisionInput = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), comment_md: z.string().optional() }),
  z.object({ decision: z.literal('reject'),  comment_md: z.string().min(1, '거절 사유는 필수') }),
  z.object({ decision: z.literal('comment'), comment_md: z.string().min(1) }),
]);
```

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-022 | WHEN 사용자가 거절을 선택하면 THE SYSTEM SHALL 사유 입력을 필수로 요구하고, 사유는 요청자 알림과 감사 로그 양쪽에 남긴다(FR-16) |
| REQ-WEB-023 | WHEN 요청자와 열람자가 같거나 대상 초안을 열람자의 세션이 작성했으면 THE SYSTEM SHALL 승인 버튼을 비활성화하고 사유를 표시한다(지시자≠승인자 — D-06) |
| REQ-WEB-024 | WHEN 질문 처리에 성공하면 THE SYSTEM SHALL 카드에 "요청 세션 `<hostname>/<agent_type>`에 전달됨"을 표시하고 처리됨 트레일에 3분간 유지한다 |
| REQ-WEB-025 | WHEN 승인함이 포커스를 가지면 THE SYSTEM SHALL `j/k/a/r/c` 키보드만으로 카드 이동과 결정을 지원한다 |

### 2.8 S8 설정 — [ui-wireframes §2.8](../03-proposal/ui-wireframes.md)

MVP 탭: **멤버·역할 / 에이전트 토큰 / 게이트 정책**. 연동(GitHub·Slack) 탭은 Phase 2(로드맵 §3.2 — "S6 리뷰 센터와 S8의 연동·게이트 정책 탭은 Phase 2") — 탭 자리만 비활성 표기. 게이트 정책 탭 중 스펙 게이트(T0~T3) 부분의 MVP 앞당김은 [scope.md](scope.md) §4.1의 supersession 콜아웃이 확정한다(근거: 로드맵 §3.5 저위험 자동 통과 첫날부터).

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 멤버 매트릭스 | EP-MBR-01 `GET /api/v1/orgs/{org}/members` · EP-MBR-02 `POST`(기존 사용자 배정 — 초대 메일 발송은 Phase 2, api.md §2.1) · EP-MBR-03 `PATCH /api/v1/memberships/{id}`(역할) | `membership.role` 6종: `admin / planner / designer / developer / qa / viewer`. 사람 × 프로젝트 n:n(FR-14) |
| 토큰 목록·발급·폐기 | EP-TOK-01 `GET /api/v1/me/tokens` · EP-TOK-02 `POST /api/v1/me/tokens` · EP-TOK-03 `DELETE /api/v1/me/tokens/{id}` · EP-TOK-04 `GET /api/v1/orgs/{org}/tokens`(admin 조직 전체) | `api_token`: 라벨·소유자·프로젝트 스코프·`prefix`·`last_used_at`(hostname 포함 표기). admin은 조직 전체 목록 열람 |
| 게이트 정책 | EP-PRJ-03 `GET /api/v1/projects/{proj}` · EP-PRJ-04 `PATCH /api/v1/projects/{proj}` (`gate_policy` 필드 — data-model §2.1) | MVP 편집 항목: stale 임계(기본 30분)·게이트 티어 임계(T0~T3)·자기 승인 금지 토글(기본 ON). 리뷰 커버리지 게이트 행·fail-open 임계는 Phase 2와 함께 활성화 |

- **토큰 발급 흐름**: 발급 다이얼로그(`TokenCreateInput`: `project`·`name`·`scopes[]`·`expires`) → 성공 시 **원문 1회 표시**(복사 버튼, 닫으면 다시 볼 수 없음 — 해시 저장) → 목록에는 `prefix`만. 스코프 체크박스는 [agent-integration §6.1](../03-proposal/agent-integration.md)의 `resource:action` 목록을 그대로 쓰고, `spec:approve`·`approval:decide`는 **체크박스 비활성**(사람 전용 — 시스템 불변식).
- **컴포넌트**: `SettingsTabs` · `MemberMatrix` · `MemberAddDialog` · `TokenTable` · `TokenIssueDialog` · `TokenRevealOnce` · `GatePolicyForm` · 권한 비확대 고지문("토큰은 사용자 권한을 상속하며 절대 확대하지 않는다" — NFR-03 · D-08).
- **빈 상태**: 토큰 0개 — 플러그인 온보딩 절차 링크([plugin.md](plugin.md) §4).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-026 | WHEN 토큰 발급에 성공하면 THE SYSTEM SHALL 토큰 원문을 1회만 표시하고 이후 목록에는 `prefix`와 마지막 사용(시각·hostname)만 노출한다(NFR-03) |
| REQ-WEB-027 | WHEN 토큰 스코프 선택 UI를 렌더링하면 THE SYSTEM SHALL `spec:approve`·`approval:decide` 체크박스를 항상 비활성으로 표시한다(사람 전용) |
| REQ-WEB-028 | WHEN admin이 아닌 사용자가 멤버·역할 탭을 열면 THE SYSTEM SHALL 매트릭스를 읽기 전용으로 표시하고 편집 컨트롤을 비활성화한다(FR-14) |

### 2.9 알림 센터 (`/notifications`)

인앱 알림 피드다(FR-12 ◐ — Slack·메일·다이제스트는 Phase 2). 승인함과 역할이 다르다 — **승인함은 "내 결정을 기다리는 것", 알림은 "내가 알아야 하는 것"**(spec-workflow §6.6 원칙 3). 그림은 ui-wireframes에 없어 여기서 소유한다(§1.6).

```text
알림 센터 — nerv.example.com/notifications
┌──────────────────────────────────────────────────────────────────┐
│ 알림   [전체 | 안읽음 (5)]                                  (1)  │
├──────────────────────────────────────────────────────────────────┤
│ ● ✅ SPC-CWC-007 v4가 승인됨 — 승인 지민            2분 전  (2)  │
│ ● ⚠️ 세션 S-2d04 stale — TSK-b904가 ready로 회수됨  30분 전      │
│ ● 💬 서연이 embed-v2 §4에 코멘트                    1시간 전     │
│ ● 🤖 mac-02/claude-code가 질문에 답변을 받음        2시간 전     │
│ ○ 📥 플랜 승인 요청 — TSK-3f77 (처리됨)             어제    (3)  │
│ ○ ✅ REQ-CWC-018 → verified                         어제         │
├──────────────────────────────────────────────────────────────────┤
│ 더 보기 ▾ (커서 페이지네이션)                                    │
└──────────────────────────────────────────────────────────────────┘
```

1. **필터 2종만** — 전체/안읽음. 헤더 배지 수 = 안읽음 수(정합 — REQ-WEB-035).
2. **행 = 이벤트 요약 + 딥링크** — 클릭 시 읽음 처리 후 대상으로 이동(뷰 상태 쿼리 포함 — ui-wireframes §1.4). ●/○는 읽음 여부.
3. **승인함 항목의 그림자** — 승인 요청 알림은 여기에도 남지만 행동은 승인함에서 한다(카드 중복 금지).

| 화면 요소 | 데이터 소스 | 비고 |
| --- | --- | --- |
| 알림 피드 | EP-NTF-01 `GET /api/v1/me/notifications` (state: unread/read, 커서) | `notification` 파생 규칙·읽음 상태는 [data-model](../03-proposal/data-model.md) §2.9 |
| 읽음 처리 | EP-NTF-02 `POST /api/v1/me/notifications/{id}/read` | 단건 — 행 클릭 시 자동 호출 |

- **실시간**: `user:{id}` 룸 — `notification.created` → `['me', 'notifications']` + 헤더 배지(§1.4 표와 동일).
- **컴포넌트**: `NotificationFeed` · `NotificationRow`(아이콘·본문·딥링크·상대 시각·읽음 dot).
- **빈 상태**: "새 알림이 없습니다" + 승인함 링크(막다른 길 금지 — ui-wireframes §3.4).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-034 | WHEN 알림 행을 클릭하면 THE SYSTEM SHALL 해당 알림을 읽음 처리(EP-NTF-02)한 뒤 대상 딥링크로 이동한다 |
| REQ-WEB-035 | WHEN `notification.created`를 수신하거나 읽음 처리가 완료되면 THE SYSTEM SHALL 5초 이내에 헤더 알림 배지 수를 안읽음 목록 수와 일치시킨다(NFR-02) |

---

## 3. 에디터 상세 (S3)

### 3.1 TipTap 노드 화이트리스트

지원 노드는 markdown 표현 가능 집합으로 제한한다([scope.md](scope.md) §2 확정 스택 — 왕복 손실 실측 시 Milkdown 재검토 트리거).

| 화이트리스트(스택 확정) | TipTap 구현 매핑 | markdown 직렬화 |
| --- | --- | --- |
| heading | `Heading` (level 1~6) | `#`~`######` |
| paragraph | `Paragraph` | 빈 줄 구분 문단 |
| list | `BulletList` · `OrderedList` · `ListItem` | `-` · `1.` |
| table | `Table` · `TableRow` · `TableHeader` · `TableCell` | GFM 파이프 표 |
| code | `CodeBlock`(펜스) + 인라인 `Code` 마크 | ``` 펜스 · 백틱 |
| blockquote | `Blockquote` | `>` |
| link | `Link` 마크 | `[텍스트](url)` |
| hr | `HorizontalRule` | `---` |

- 텍스트 마크는 md 표현 가능한 것만: bold(`**`) · italic(`*`) · strike(`~~`) · inline code. 그 외(색·밑줄·이미지 업로드 등)는 확장하지 않는다.
- 화이트리스트 밖 콘텐츠 붙여넣기(리치 HTML 등)는 지원 노드로 강등하거나 일반 텍스트로 받는다 — 조용히 비표현 노드를 만드는 것이 금지 사항이다.
- 소스 보기는 read-only 토글이다. 소스를 직접 고치는 경로는 MVP에 없다 — 터미널 경로(`/nerv:spec`)가 그 역할이다.

### 3.2 md 직렬화 왕복 규칙

저장 포맷은 markdown이고 메타는 DB 컬럼이다(D-09). 왕복 계약:

1. **저장 경로**: 에디터 문서 → serialize(md) → `PUT .../draft`(`body_markdown`). 서버는 `content_hash = sha256(body_md)`로 무변경 저장을 차단한다(data-model §2.2 `spec_version`).
2. **왕복 검증**: 저장 전 클라이언트가 `serialize(parse(serialize(doc)))`와 `serialize(doc)`의 일치를 확인한다. 불일치(직렬화 비안정)면 저장을 막고 소스 보기 + 오류 리포트를 안내한다 — 이 실측이 Milkdown 재검토 트리거의 입력이다.
3. **정규화는 serializer가 결정한다**: 리스트 마커·표 정렬·공백 정규화 규칙은 단일 serializer 구현에 고정하고, 웹과 터미널이 같은 draft를 오가도 정규화 차이만으로 diff가 생기지 않게 한다.
4. **파싱 실패 허용**: 터미널에서 저장된 md에 화이트리스트 밖 구문이 있으면 에디터는 해당 블록을 **원문 보존 read-only 블록**으로 렌더링한다. 본문을 임의로 재작성하지 않는다(정보 손실 0 원칙 — [importer.md](importer.md)와 동일).

### 3.3 코멘트 앵커

`spec_comment.anchor`는 헤딩 slug 또는 Requirement `ref`다(data-model §2.2). 줄 번호 앵커는 만들지 않는다 — 다음 버전에서 고아가 되기 때문이다(ui-wireframes §4.3).

| 앵커 종류 | 값 | 생존 규칙 |
| --- | --- | --- |
| 헤딩 slug | 헤딩 텍스트에서 서버가 발급(정규화 + 충돌 시 `-n` 접미) | 새 버전에서 같은 slug의 헤딩이 있으면 스레드 유지, 없으면 "앵커 유실" 상태로 문서 상단에 모아 표시 |
| Requirement ref | `REQ-CWC-031` 형식의 안정 ID | Requirement가 존속하는 한 버전과 무관하게 유지 |

해소는 삭제가 아니라 `open → resolved` 전이이고 `resolved_in_version_id`가 반영 버전을 남긴다. 웹의 [해결됨으로 표시]와 터미널의 `nerv_spec_comment_resolve`는 같은 서비스다(D-05).

### 3.4 초안 편집 리스 UX

규약의 정본은 [spec-workflow §1.2](../03-proposal/spec-workflow.md)다(TTL 30분 — Task 클레임 리스와 같은 상수, 별도 claim/release 없음). 웹 UX로의 번역:

| 순간 | UI |
| --- | --- |
| 획득 | draft 에디터를 여는 순간 자동 획득 — 별도 버튼 없음. 상단에 `✏️ 편집 중 — <사용자> · 웹 · 방금` 배지 |
| 갱신 | 저장 시 + 에디터가 열려 있는 동안 60초 주기 갱신(하트비트 상수 재사용). 리스 잔여 2분 미만이면 배지를 호박색으로 전환(S4 리스 표시 임계와 동일) |
| 같은 사용자, 다른 표면 | 터미널에서 열면 자동 인계 — 웹 에디터는 읽기 전용으로 전환되고 "터미널 세션 `<hostname>/<agent_type>`이 이어쓰는 중" 배지 + 이전 표면 알림 |
| 다른 사용자 | 읽기 전용 + 보유자 배지 + [인계 요청](보유자 알림, 승인 시 이전). 에이전트 upsert는 `NERV_DRAFT_LEASED` 하드 차단 |
| 해제 | 검토 요청 성공 · 에디터 닫기 · TTL 만료 |
| 최후 방어선 | 리스와 무관하게 저장은 `base_version` 전제조건을 갖는다 — 409는 §1.5의 `NERV_PRECONDITION` 다이얼로그 |

터미널 이어쓰기 카드(S3 하단)는 복사용 명령 한 줄이다: `claude "/nerv:spec edit SPC-CWC-007"`. 스펙을 쓰는 에이전트 세션도 S5 세션 보드에 뜬다 — 기획자의 작성 세션이 팀 시야 밖에 있는 사각은 없다(spec-workflow §1.2).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-029 | WHEN 사용자가 draft 에디터를 열면 THE SYSTEM SHALL 편집 리스를 자동 획득·주기 갱신하고, 보유 사실을 상단 배지로 표시한다 |
| REQ-WEB-030 | WHEN 화이트리스트 밖 노드가 포함된 md를 열면 THE SYSTEM SHALL 해당 블록을 원문 보존 read-only 블록으로 렌더링하고 본문을 재작성하지 않는다 |
| REQ-WEB-031 | WHEN 직렬화 왕복 검증이 실패하면 THE SYSTEM SHALL 저장을 차단하고 소스 보기와 함께 실패 리포트를 표시한다 |

---

## 4. 디자인 토큰

### 4.1 색 토큰 — 제안서 팔레트의 Tailwind 이식

원본은 제안서 HTML 공통 팔레트(`docs/html/assets/style.css`의 CSS 변수)다. Tailwind 테마 토큰으로 1:1 이식하고, 라이트/다크는 CSS 변수 값 교체로 처리한다(`data-theme` 아님 — `prefers-color-scheme`, 제안서 사이트와 동일).

| Tailwind 토큰 | 원본 변수 | 라이트 | 다크 | 행동 축 의미(ui-wireframes §3.1) |
| --- | --- | --- | --- | --- |
| `status.idle` | `--gray-soft` 계열 | `#eceef2` (텍스트 `#5b667a`) | `#232837` (`#a3adc2`) | 회색 — 아직 아무 일도 없음 |
| `status.action` | `--accent` | `#4f46e5` | `#818cf8` | 남색 — 사람의 행동 대기 |
| `status.waiting` | `--warn` | `#b45309` | `#fbbf24` | 호박 — 검토·응답 대기 |
| `status.agent` | `--purple` | `#7c3aed` | `#c4b5fd` | 보라 — 에이전트 점유·수행 중 |
| `status.progress` | `--info` | `#1d4ed8` | `#60a5fa` | 파랑 — 진행 중 |
| `status.ok` | `--ok` | `#16803c` | `#4ade80` | 초록 — 승인·검증 완료 |
| `status.done` | `--teal` | `#0f766e` | `#5eead4` | 청록 — 종료 |
| `status.danger` | `--danger` | `#b91c1c` | `#f87171` | 적색 — 차단·실패 |

각 색은 `-soft` 배경 짝(`#e6f4ea`/`#12291a` 등 — style.css의 `--*-soft` 값)을 함께 이식해 배지 배경으로 쓴다. shadcn/ui 시맨틱 토큰(`primary`=accent, `destructive`=danger, `muted`=gray)은 이 표에서 파생한다.

### 4.2 상태 → 토큰 매핑

엔티티별 색 배정은 ui-wireframes §3.1 표를 토큰 이름으로 옮긴 것이다 — 엔티티마다 색을 새로 정하지 않는다.

| 토큰 | SpecVersion | Requirement | Task | AgentSession | severity |
| --- | --- | --- | --- | --- | --- |
| `status.idle` | `draft` `superseded` | `unimplemented` | `backlog` | `pending` | — |
| `status.action` | — | — | `ready` | — | `spec_drift` 태그 |
| `status.waiting` | `in_review` | — | `in_review` | `awaiting_input` | `warning` |
| `status.agent` | — | — | `claimed` | — | — |
| `status.progress` | — | `in_progress` | `in_progress` | — | `info` |
| `status.ok` | `approved` | `verified` | — | `active` | — |
| `status.done` | — | `implemented` | `done` | `complete` | — |
| `status.danger` | `deprecated` | — | `blocked` | `error` `stale` | `critical` |

### 4.3 배지·표기 규약

- **색만으로 구분하지 않는다** — 모든 상태 dot에 텍스트 라벨 병기(`● active`, `○ stale`), 색+텍스트+아이콘 3중 인코딩(ui-wireframes §3.1·§4.6).
- **사람/에이전트 구분** — Task 카드는 `👤 assignee` + `🤖 delegate(hostname)` 병기, 피드는 `is_agent` 아이콘, 에이전트 작성물은 `AI` 배지 + 위임자 괄호 표기(`mac-02/claude-code (도현 위임)`) — ui-wireframes §3.2.
- **신원·시간 표기** — 신원 3요소 `도현 · mac-02 · claude-code`(좁은 화면은 `mac-02/claude-code` 축약, hostname은 고정폭). 하트비트는 상대 시각만, diff는 `+218 −34 · 파일 7` — ui-wireframes §3.3.
- **컴포넌트 기반** — Tailwind + shadcn/ui. 배지·카드·표·탭은 shadcn 프리미티브 위에 위 토큰만 사용한다. 임의 hex 직접 사용은 lint로 금지(REQ-WEB-032).

| ID | 수용 기준(EARS) |
| --- | --- |
| REQ-WEB-032 | WHEN 상태 색을 렌더링하면 THE SYSTEM SHALL §4.2 매핑의 토큰만 사용하며, 컴포넌트 코드의 임의 hex 색 사용은 lint 규칙으로 차단된다 |
| REQ-WEB-033 | WHEN 상태를 색으로 표현하면 THE SYSTEM SHALL 항상 텍스트 라벨을 병기한다(색 단독 인코딩 금지) |

---

## 참고 자료

### 이 문서가 인용한 정본 문서

- [3.6 화면 설계 (와이어프레임)](../03-proposal/ui-wireframes.md) — S1~S8 와이어프레임·상태 표현 규칙·인터랙션 규약의 정본. 이 문서의 모든 화면 절이 § 단위로 인용
- [3.3 데이터 모델](../03-proposal/data-model.md) — 엔티티 29종 필드·enum 값·ID 발급 규칙(§5.1)·`spec_comment` 앵커(§2.2)
- [3.5 스펙 워크플로우와 거버넌스](../03-proposal/spec-workflow.md) — 상태 축 3종·권한 매트릭스(§1.6)·초안 편집 리스(§1.2)·지시자≠승인자(§2.3)·이벤트 이름과 알림 카탈로그(§6.3)
- [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) — `nerv_*` 도구 17종(§2.3)·하트비트 역채널(§2.4)·토큰 스코프(§6.1)
- [3.7 로드맵](../03-proposal/roadmap.md) — Phase 1 화면 범위(S1~S5·S7·S8)와 비범위(S6·CR 델타·커버리지 대시보드·Slack), FR-12 P1 인앱
- [1.2 문제 정의와 요구사항](../01-problem/pain-points.md) — 이 문서가 번호로 인용한 FR-01~17 · NFR-01~05
- [3.2 시스템 아키텍처](../03-proposal/architecture.md) — 웹앱·WebSocket·이벤트 흐름의 시스템 배경

### 4부 형제 문서

- [4.1 MVP 범위와 스택 확정](scope.md) — 화면 범위·확정 스택(TipTap 화이트리스트·Milkdown 재검토 트리거)의 정본
- [4.4 API 명세](api.md) — 이 문서가 리소스+동사 수준으로 인용한 REST·WebSocket 계약의 정본
- [4.6 플러그인과 온보딩](plugin.md) — S8 토큰 발급에서 이어지는 에이전트 온보딩 절차
- [4.7 clemvion 임포터](importer.md) — S2 빈 상태에서 안내하는 임포트 경로
- [4.8 백로그](backlog.md) — 이 문서의 REQ-WEB-*를 근거로 하는 화면 구현 스토리
