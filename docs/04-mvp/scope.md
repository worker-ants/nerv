---
id: SPC-MVP-SCOPE
status: draft
updated: 2026-08-22
---
# MVP 범위와 스택 확정

> **요약** — 이 문서는 NERV MVP를 **Phase 0(PoC) + Phase 1(MVP)의 합**으로 확정하고, 그 경계를 표로 못 박는다. 기능 범위는 FR-01~17 × 포함(●)/부분(◐)/제외(○)로, 화면은 S1~S5·S7·S8(+로그인/온보딩)로, MCP 도구는 15종으로, 플러그인 스킬은 5종으로 고정하며, 각 판정은 [로드맵](../03-proposal/roadmap.md) §1.3의 Phase 배분표와 문자 그대로 정합한다. 기술 스택은 전 계층 확정이고(웹·API 2026-08-14, 나머지 2026-08-20, 실시간 채널을 WebSocket + SSE 다중 채널·방송 MQ Valkey로 확장 확정 2026-08-21) 재검토 트리거는 결정을 뒤집는 조건이 아니라 감수한 트레이드오프의 기록이다. 이 문서 자체는 결정 문서라 REQ ID를 발급하지 않는다 — 행동 요구는 4.2~4.8 각 문서가 REQ-*로 갖는다.
>
> 문서 버전 v0.8 · 2026-08-22 · HTML 판: [scope.html](../html/scope.html)
>
> v0.8 변경(2026-08-22 — E06-S02 스파이크 종료): **TipTap 왕복 손실 트리거 점화 기록**(§2.2 점화 기록 ②). 실측 19/22·손실 유형 2종을 남기고 **판정은 보류**한다 — 저장 게이트가 손실의 커밋을 막으므로 MVP는 TipTap으로 진행하며, Milkdown 교체는 사람의 결정 사항이다. 확정 스택 표는 불변.
>
> v0.7 변경(2026-08-22 — **임베딩 제공자 추상화, v0.6 "자가호스팅만" 결정의 당일 번복**): 임베딩 호출을 **OpenAI 호환 `/v1/embeddings` 단일 계약**으로 추상화하고 제공자는 env 프로필로 결정한다 — 로컬 = TEI(CPU·compose 동봉), 스테이징 = LM Studio, **운영 = OpenAI**(`dimensions=1024` 절단). v0.6의 외부 임베딩 API 금지(구 REQ-CB-020)는 폐기하고, 외부 전송은 **운영 주체가 env로 명시 선택**하는 것으로 전환한다(기본값은 자가호스팅 — REQ-CB-020 개정). 차원은 전 제공자 1024 고정(REQ-CB-021). 환경 프로필 정본은 [4.2 코드베이스와 배포](codebase.md) §5.2a.
>
> v0.6 변경(2026-08-22 — 스펙 열람·검색 대규모 대응 확정): ① **하이브리드 검색을 MVP로 확정** — Postgres FTS + pg_trgm(한국어 부분 일치) + **pgvector**(HNSW) + **자가호스팅 임베딩**(`nerv-embed` — TEI + BGE-m3) + **관계 확장(graph RAG)**. 근거: `nerv_spec_search`가 P0 도구 8종에 포함 — 에이전트가 MVP 첫날부터 검색의 주 소비자이고, 컨텍스트 수집·중복 확인(FR-01) 품질이 곧 에이전트 작업 품질이다. 검색 파이프라인 정본은 [4.4 API 명세](api.md) §2.2b ② 인프라 서비스 3종 → **4종**(+`nerv-embed`) ③ 탐색·관계 UI 패키지(퀵 스위처·관계 패널·영향 미리보기·트리 스케일 — [4.5 화면 명세](screens.md)) ④ non-goals에 외부 검색엔진·외부 임베딩 API 금지 명시.
>
> v0.5 변경(2026-08-22): **테스트 러너 확정** — Vitest(L1·L2·L3 API) + Playwright(L3 웹). §2.1 스택 표에 행 추가, 3계층 배치 정본은 [4.2 코드베이스와 배포](codebase.md) §4.3.
>
> v0.4 변경(2026-08-22 — 임포터 실행 모델 확정에 따른 범위 조정): ① 모노레포 워크스페이스에 **`apps/cli`** 추가(§2.1) ② 임포터를 **프로파일 기반 범용 도구**로 확정하고 실행 모델을 API 클라이언트로 전환(§3.2 FR-17 행 · [4.7 스펙 임포터](importer.md)) ③ 플러그인 스킬 **4종 → 5종**(`/nerv:import` 포함 — §4.3) ④ MCP 도구는 **15종 유지**(임포트 도구를 만들지 않는다 — §4.2).

---

## 1. MVP의 목표와 가치 가설

### 1.1 가치 가설 — 조정 → 가시성 → 게이트 순서로 검증한다

MVP가 검증하려는 가설은 하나의 문장이다.

> **서버가 모든 세션의 선언을 보면, clemvion이 로컬 한계 때문에 포기한 조정·가시성·거버넌스가 복원된다.**

검증 순서는 [로드맵](../03-proposal/roadmap.md) §1.1이 고정한 의존 순서 — **조정(충돌 제거) → 가시성(세션·커버리지) → 거버넌스(승인·게이트)** — 를 그대로 따른다. 조정과 가시성 없이 게이트만 세우면 게이트는 로컬 파일 위에서 동작하게 되고, 그 결과가 clemvion의 리뷰 md 13,777개·131MB다([1.2 문제 정의와 요구사항](../01-problem/pain-points.md) P6).

| 순서 | 가설 | MVP에서의 검증 수단 | 판정 수치(로드맵 정본) |
| --- | --- | --- | --- |
| ① 조정 | 원자적 클레임+리스가 중복 작업·스펙 충돌을 착수 시점에 막는다 | FR-06 클레임 엔진 + scope 겹침 감지 (Phase 0) | 두 호스트·세 세션 90분 동시 작업에서 **중복 클레임 0건**, 겹침 경고 10/10·오탐 0 (로드맵 §2.4) |
| ② 가시성 | 세션 레지스트리+이벤트 스트림이 "누가 무엇을 하는가"를 즉답한다 | FR-07·FR-08 세션 보드 (Phase 0 읽기 전용 → Phase 1 steer/stop) | 세션 가시성 **100%** / 보드 반영 **p95 ≤ 5초** (로드맵 §3.4) |
| ③ 게이트(첫 단) | 승인이 터미널 밖 수신함으로 나가면 비개발 직군이 참여한다 | FR-11 승인함 + FR-02 승인 레코드 (Phase 1) | 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건** (로드맵 §3.4) |

게이트의 둘째 단(리뷰 수집·게이트 판정 API·커버리지)은 MVP가 아니라 Phase 2다 — §5 non-goals에서 명시한다.

### 1.2 "구현 착수 가능"의 정의

4부(MVP 구체화) 여덟 문서의 공통 목표 기준이며, 이 문서가 그 정의를 소유한다.

> **"구현 착수 가능" — 개발자든 에이전트든 이 문서 세트만 보고 추가 질문 없이 첫 PR을 낼 수 있다.**

구체적으로 아래 실물이 4부 문서 세트에 존재해야 한다. "적절히 구성한다", "필요 시 추가한다" 같은 서술은 이 기준의 위반이다.

| 실물 | 어디에 | 형태 |
| --- | --- | --- |
| 모노레포 트리(`codebase/` 하위) · docker-compose 전문 · k8s 스켈레톤 | [4.2 코드베이스와 배포](codebase.md) | 디렉터리 트리 전문, 설정 파일 전문, `.env` 변수 전표 |
| 전체 DDL(29 테이블·인덱스·트리거·파티션) | [4.3 데이터베이스 스키마](database.md) | `CREATE TABLE` 전문 + 개발 시드 |
| REST·WebSocket/SSE·MCP 대응 전표 | [4.4 API 명세](api.md) | 엔드포인트별 메서드·경로·권한·요청·응답·이벤트 |
| 화면별 데이터 소스·상태·컴포넌트 명세 | [4.5 화면 명세](screens.md) | 라우팅 표 + 화면별 EARS 수용 기준 |
| SKILL.md 4종 전문 · hooks.json 전문 | [4.6 플러그인과 온보딩](plugin.md) | 실제 파일 내용 |
| 임포터 파싱 규칙·실패 리포트 형식 | [4.7 스펙 임포터](importer.md) | 필드 매핑 표 + 수용 기준 |
| 에픽·스토리 분해와 착수 순서 | [4.8 백로그](backlog.md) | `E01-S01` 스토리 + EARS 수용 기준 + 의존 그래프 |

### 1.3 MVP = Phase 0 + Phase 1

[로드맵](../03-proposal/roadmap.md)의 Phase 0(PoC, 2~3주)과 Phase 1(MVP, 4~6주)을 하나의 구현 범위로 묶어 구체화한다. 두 Phase의 **종료 게이트는 로드맵 정본 그대로 유지된다** — Phase 0 게이트를 통과하지 못하면 Phase 1 범위를 착수하지 않는다(로드맵 §1.4 Go/No-Go 규칙). 이 문서에서 "MVP 포함"은 "Phase 1 종료 시점까지 수용 기준 충족"을 뜻하고, P0/P1 열이 그 안의 순서를 보존한다.

종료 게이트는 기능 목록이 아니라 수치다(로드맵 §1.2 인용).

| Phase | 기간 | 종료 게이트(수치) |
| --- | --- | --- |
| Phase 0 — PoC | 2~3주 | 두 호스트·세 세션 90분 동시 작업에서 **중복 클레임 0건**, 겹침 경고 10/10 검출·오탐 0 |
| Phase 1 — MVP | 4~6주 | 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**, 세션 가시성 100% / 보드 반영 p95 ≤ 5초 |

범위 스냅샷 — 이 문서가 확정하는 숫자는 다섯 개다.

| 축 | MVP 확정 | 근거 절 |
| --- | --- | --- |
| 기능(FR-01~17) | 포함 ● 8 · 부분 ◐ 7 · 제외 ○ 2 | §3.2 |
| 비기능(NFR-01~05) | 포함 ● 3 · 부분 ◐ 2 | §3.4 |
| 화면 | S1~S5·S7·S8 + 로그인/온보딩 = 8 | §4.1 |
| MCP 도구 | 15종 = P0 8종 + P1 7종 | §4.2 |
| 플러그인 스킬 | 4종 | §4.3 |

---

## 2. 확정 기술 스택

### 2.1 스택 표 — 전 계층 확정, 재논의 금지

[시스템 아키텍처](../03-proposal/architecture.md) §4.1·§4.2와 정합한다. 웹앱(Vite)·API(NestJS)는 **2026-08-14**에, 쿼리(Drizzle)·인증(better-auth)·실시간(WebSocket)·에디터(TipTap)·배포(로컬 compose/운영 k8s)는 **2026-08-20**에 확정했다. **2026-08-21**에 실시간 채널을 WebSocket 단일에서 **WebSocket + SSE 다중 채널**로 확장하고 팬아웃 **방송 MQ를 Valkey**로 확정했다(§2.2의 재검토 트리거 "브라우저 밖 소비자" 점화). 언어·DB·프론트 세부·MCP SDK는 3부 원안(v0.1 · 2026-08-13)에서 확정된 뒤 변경이 없다.

| 계층 | 확정 | 결정일 | 핵심 규약 |
| --- | --- | --- | --- |
| 언어/모노레포 | TypeScript + pnpm workspace — **구현 코드는 전부 저장소 `codebase/` 하위**. 워크스페이스 4종: `apps/web` · `apps/api` · `apps/cli` · `packages/schema` | 2026-08-13 (3부 원안) · 코드 위치 2026-08-21 · `apps/cli` 2026-08-22 | Turborepo는 빌드 시간이 아플 때 도입(트리거만 기록). 모노레포 루트 = `codebase/`([4.2 코드베이스와 배포](codebase.md) §1, REQ-CB-015). `apps/cli`(`@nerv/cli` — 임포터)는 컨테이너가 아니라 **원본 체크아웃이 있는 장비에 설치되는 클라이언트**다(codebase.md §1.3, REQ-CB-016·017) |
| 웹 | **Vite + React SPA** | 2026-08-14 | 정적 자산 배포. SSR 없음 |
| API | **NestJS(Fastify 어댑터)** | 2026-08-14 | REST·MCP·WebSocket이 **같은 도메인 서비스를 DI로 공유**(D-05). 게이트 판정이 표면마다 갈라지는 것이 최악의 실패 |
| DB | **Postgres** + **Drizzle** | Postgres 2026-08-13 · Drizzle 2026-08-20 | 스키마는 `packages/schema`에 TS로 선언, drizzle-kit 마이그레이션. 복잡 질의는 raw `sql` 1급 |
| 검색 | **하이브리드** — Postgres FTS(`simple`) + **pg_trgm**(한국어·부분 일치) + **pgvector**(HNSW·cosine) + 임베딩(**OpenAI 호환 `/v1/embeddings` 단일 계약**, 1024차원 고정) + **관계 확장(graph RAG)** | 2026-08-22 (제공자 추상화 같은 날 개정) | 파이프라인(ID 직행 → 렉시컬+벡터 RRF 병합 → 1-hop 관계 확장)은 [4.4 API 명세](api.md) §2.2b 정본. **임베딩 제공자는 env 프로필** — 로컬 TEI(CPU·compose `embed`) / 스테이징 LM Studio / 운영 OpenAI(`text-embedding-3-small`, `dimensions=1024`). 프로필 정본 [4.2](codebase.md) §5.2a. 기본값은 자가호스팅이고 외부 전송은 운영 주체의 env 명시 선택(REQ-CB-020). 제공자 무응답 시 렉시컬 degrade(REQ-API-026) |
| 인증 | **better-auth** | 2026-08-20 | organization 플러그인(조직·멤버십), api-key 플러그인 기반 PAT(해시 저장·프로젝트 스코프). OAuth 2.1 리소스 서버는 Phase 2 |
| 실시간 | **WebSocket + SSE 다중 채널**, 방송 MQ **Valkey pub/sub** (NestJS `@WebSocketGateway` socket.io + `@Sse()` 스트림) | WebSocket 2026-08-20 · SSE 병행·Valkey MQ 2026-08-21 | WS(`/ws`)는 웹 SPA 전용 — **websocket 전송만 활성**(폴링 폴백 off → k8s 스티키 불필요), 룸 `project:{id}`·`user:{id}`, join 시 멤버십 검사. SSE(`/sse/*`)는 브라우저 밖 소비자(CLI·외부 도구)용 단방향 구독 — 쿠키 또는 PAT 인증([4.4 API 명세](api.md) §3.5). 팬아웃: EventService가 커밋 후 Valkey `nerv_events`에 PUBLISH → 파드마다 SUBSCRIBE 후 자기 소켓·스트림에 emit(크로스파드 어댑터 불필요 — 모든 emit의 원천이 Valkey 방송). 재연결 시 클라이언트가 화면 데이터 재조회(이벤트 유실 허용, 진실은 DB — D-14) |
| 에디터 | **TipTap + markdown 직렬화** | 2026-08-20 | 지원 노드를 md 표현 가능 집합으로 제한(heading·paragraph·list·table·code·blockquote·link·hr). 소스 보기는 read-only 토글 |
| MCP | MCP TypeScript SDK | 2026-08-13 (3부 원안) | 2026-07-28 리비전 기준 구현 + 구 리비전(2025-03-26~2025-11-25) 병행 서빙(D-11) |
| 프론트 세부 | TanStack Router/Query · Tailwind + shadcn/ui · react-hook-form + zod | 2026-08-13 (3부 원안) | zod 스키마는 `packages/schema` 공유. WebSocket 이벤트 → Query 무효화 |
| 테스트 | **Vitest**(L1 단위·L2 통합·L3 API E2E) + **Playwright**(L3 웹 E2E) | 2026-08-22 | 3계층 배치·명령·무게중심(L2)은 [4.2 코드베이스와 배포](codebase.md) §4.3 정본. L2는 mock 없이 실제 Postgres 상대(동시성 검증은 mock 금지 — AGENTS.md 규약과 동일). Playwright는 웹 E2E에만 — API 시나리오는 Vitest가 compose 스택 상대로 돈다 |
| 배포 | **로컬 docker-compose / 운영 k8s(kustomize base+overlays)** | 2026-08-20 | 같은 이미지 3종: `nerv-api`(REST+MCP+WS+SSE), `nerv-worker`(같은 코드베이스, 엔트리 분리), `nerv-web`(Vite 산출물+nginx). 인프라 서비스는 Postgres(+pgvector·pg_trgm)·MinIO·Valkey + **`embed`(로컬 프로필 전용 — TEI. 외부 제공자 프로필에서는 띄우지 않는다)**. 마이그레이션: compose는 기동 시, k8s는 Job. 워커 replica 1 + advisory lock(HPA 제외). Ingress: WebSocket 업그레이드·SSE 버퍼링 해제·타임아웃 상향, `/mcp` Origin 검증 |

> **인증 확정이 로드맵 표기 하나를 대체한다.** [로드맵](../03-proposal/roadmap.md) §3.2(v0.1 · 2026-08-13)는 Phase 1 인증을 "OAuth 2.1로 승격"으로 적었다. 2026-08-20 인증 스택 확정(better-auth)에서 **OAuth 2.1 리소스 서버는 Phase 2로 이동**했고, MVP의 에이전트 인증은 PAT(해시 저장 · 사용자·프로젝트·역할·스코프 튜플 바인딩)로 확정한다. NFR-03의 수용 기준(토큰 프로젝트 스코프·권한 비확대·본문 비신뢰 — [1.2 문제 정의와 요구사항](../01-problem/pain-points.md) §4.3)은 PAT로 충족되므로 Phase 배분표의 NFR-03 ● 판정은 유지된다. OAuth 2.1은 충족 수단의 고도화이지 수용 기준이 아니다.

### 2.2 재검토 트리거 — 결정을 뒤집는 조건이 아니라 트레이드오프의 기록

전 행이 확정이다. 아래 트리거는 "이 조건이 오면 재논의를 시작한다"는 계측 조건이며, 그 전에는 대안 논의를 재개하지 않는다([시스템 아키텍처](../03-proposal/architecture.md) §4.2의 대안 비교·근거를 인용, 재서술하지 않는다).

| 결정 | 재검토 트리거 | 그때의 후보 |
| --- | --- | --- |
| pnpm 단독(모노레포 태스크 러너 없음) | 전체 빌드 시간이 개발 흐름을 끊는 수준으로 증가 | Turborepo 도입 |
| Vite + React SPA | 스펙 문서 공개 열람(비로그인 링크 공유·검색 노출) 요구 발생 | SSR 프레임워크 재검토 |
| NestJS | MCP 스트리밍 어댑터 계층이 유지보수 부담이 될 때 | Hono 등 웹 표준 런타임 |
| Postgres | 스펙 버전 diff를 DB 네이티브로 다뤄야 할 요구 증가 | Dolt 재평가 |
| Drizzle | 마이그레이션 운영 부담이 임계를 넘을 때 | Prisma/Kysely 재평가 |
| better-auth | 엔터프라이즈 SSO 요구 유입 | Keycloak 연동 검토 |
| Valkey pub/sub(무영속 단일 인스턴스) | 방송 유실로 인한 재조회 비용이 실측 임계를 넘거나 이벤트 재전송(replay) 요구가 생길 때 | Valkey Streams(적재형)·HA(센티널/관리형) 재검토 |
| TipTap | md 직렬화 왕복 손실 실측 발생 | Milkdown 재검토 |
| Vitest + Playwright | L3 유지 비용이 개발 흐름을 끊는 수준으로 증가 | E2E 범위 축소(시나리오 5종 고정) 또는 러너 통합 재검토 |
| 임베딩 제공자 프로필(로컬 TEI / 스테이징 LM Studio / 운영 OpenAI) | 질의 임베딩 p95가 검색 응답 목표(보류 — E06-S06 실측 후 확정, [4.4](api.md) §2.2b)를 잠식, 검색 만족도 실측 미달, 또는 운영 API 비용·정책 변화 | 제공자·모델은 env 교체 + 재임베딩으로 해소(코드 불변 — OpenAI 호환 단일 계약). 그래도 부족하면 전용 검색엔진 재검토(그 전에는 재론 금지) |
| 실시간 공동 편집 미도입 | 버전 충돌(409 재시도) 주 20건 이상 또는 동시 편집 요구 반복(로드맵 §5.1) | Yjs + Hocuspocus |
| 이중 배포 타깃(compose+k8s) | 운영 규모가 단일 노드로 충분(NFR-04) | k8s 생략 |

> **점화 기록 ①.** v0.1의 "WebSocket 단일 채널 → 브라우저 밖 소비자(CLI 등)가 실시간 구독을 원할 때 SSE 병행 재검토" 트리거는 **2026-08-21 점화**되어 SSE 병행이 확정됐다(§2.1 실시간 행). 그 행은 위 표에서 Valkey 방송 MQ의 재검토 트리거로 대체됐다.
>
> **점화 기록 ② — TipTap 왕복 손실 (2026-08-22 점화, 판정 보류).** E06-S02 스파이크를 이 저장소 `docs/**/*.md` 22문서로 실행한 결과 **19/22(86.4%)만 왕복 안정**이었다. 손실 유형 2종이 특정됐다(`apps/web/src/features/spec-editor/loss-probe.spec.ts`가 최소 재현을 고정한다):
>
> | 유형 | 증상 | 표본 |
> | --- | --- | --- |
> | 표 셀 안의 인라인 코드 파이프 | 1회차 직렬화가 이스케이프를 잃어 2회차 파싱이 셀을 쪼갠다 | `02-research/integration-tech.md` |
> | 연속 인용문 병합 + 강조 이스케이프 중복 | 빈 `>` 로 분리된 인용 문단이 하나로 합쳐지고 `**`가 `\*\*`로 늘어난다 | `04-mvp/importer.md` |
>
> **그럼에도 MVP는 TipTap으로 진행한다.** 근거는 손실이 데이터에 도달하지 못한다는 것이다 — 저장 전 왕복 검증이 불안정 직렬화를 차단하고(REQ-WEB-031), 사용자는 소스 보기와 터미널 경로(`/nerv:spec`)로 안내된다. 즉 현재 상태는 "편집기가 특정 문서를 못 연다"이지 "저장이 문서를 망친다"가 아니다.
>
> **스택 교체는 사람의 결정이다.** Milkdown 재검토는 이 기록을 입력으로 하되 착수 여부는 확정하지 않는다. 재검토를 시작한다면 판단 기준은 두 가지여야 한다: ① 위 2유형이 Milkdown에서 해소되는가 ② 교체 비용이 "차단된 문서를 터미널로 편집한다"는 현재의 우회보다 싼가. 스파이크 리포트 산출물은 `apps/web/.spike/tiptap-roundtrip.md`이고 매 실행마다 갱신된다(수치가 떨어지면 회귀로 막힌다).

운영 Postgres의 위치(클러스터 외부 권장 vs CloudNativePG)는 확정이 아니라 **백로그 확인 태스크**다 — [4.8 백로그](backlog.md)에 스토리로 등재한다.

---

## 3. MVP 기능 범위 — FR-01~17 × 포함/부분/제외

### 3.1 읽는 법

- **번호·이름은 [1.2 문제 정의와 요구사항](../01-problem/pain-points.md) §4의 정본을 인용**한다. 수용 기준 전문도 그 문서에 있고, 아래 표의 "MVP에서 되는 것"은 그 요약이다.
- **MVP 판정과 P0·P1 배정은 [로드맵](../03-proposal/roadmap.md) §1.3 배분표와 문자 그대로 정합**한다. ● = MVP(Phase 1 종료 시점)에 수용 기준 충족, ◐ = 부분 구현(잔여는 Phase 2+), ○ = MVP 제외.
- 판정이 ◐인 행은 "MVP에서 안 되는 것" 열이 잔여 범위를 명시한다 — 이 열이 비어 있으면 결함이다.

### 3.2 기능 요구사항 범위 표

| FR | 이름(정본 인용) | MVP | P0 | P1 | MVP에서 되는 것 | MVP에서 안 되는 것(Phase 2+) |
| --- | --- | :-: | :-: | :-: | --- | --- |
| FR-01 | 스펙 단일 진실 저장소 | ● | ◐ | ● | 트리·타입·안정 ID·검색(P0: FTS+trgm 렉시컬, P1: **하이브리드 완성** — 벡터·RRF·관계 확장, [4.4](api.md) §2.2b), P1부터 편집 — 웹 에디터와 기획자 터미널 경로 양쪽(§3.3). 탐색 UI(퀵 스위처·관계 패널·트리 스케일)는 P1([4.5](screens.md)) | — |
| FR-02 | 스펙 버전·문서 상태 | ● | ○ | ● | 불변 SpecVersion 스냅샷, `draft→in_review→approved→superseded/deprecated`, 버전 diff, 승인 레코드, **베이스라인**(프로젝트 승인 세트 동결·재현 + as-of manifest — 2026-08-21 FR-02 범위 확장을 MVP 핵심으로 포함 확정) + **기준 버전 규약·재브리핑**(Task는 파생 버전으로 컨텍스트 고정, superseded 시 서버가 재브리핑 플래그 — [스펙 워크플로우](../03-proposal/spec-workflow.md) §3.3·§3.6) | — |
| FR-03 | Requirement 단위 추적 | ◐ | ○ | ◐ | EARS 템플릿, 안정 ID 발급, 구현 축 초기값 설정 | 구현 축 2축 완성(자동 계산·커버리지 연동)은 Phase 2 |
| FR-04 | CR·델타 리뷰 | ○ | ○ | ○ | — | ADDED/MODIFIED/REMOVED 델타 뷰, 영향 분석 전부 Phase 2 |
| FR-05 | Task 관리·ready 큐 | ● | ◐ | ● | 의존성 그래프 ready 판정 + 위임 명세 4요소 검증(P0), 스펙에서 Task 파생·칸반(P1) | — |
| FR-06 | 원자적 클레임·리스 | ● | ● | ● | **P0의 핵심 검증 대상.** 원자 클레임, scope(spec_ids·file_globs) 겹침 감지, 리스 TTL 30분·하트비트 60초·만료 자동 회수. P1에서 초안 편집 리스(문서 축, D-04 확장, 같은 TTL 30분) | — |
| FR-07 | 세션 레지스트리 | ● | ◐ | ● | 등록·하트비트·상태 머신(`pending→active↔awaiting_input→complete/error/stale`, stale 임계 30분)(P0), 사용자·hostname·에이전트 종류 전체 뷰(P1) | — |
| FR-08 | 활동 스트림·미션 컨트롤 | ● | ○ | ● | typed Activity 타임라인, 전역 보드, steer/stop(P1) | — |
| FR-09 | 리뷰 수집 | ○ | ○ | ○ | — | ReviewSession→Finding→Resolution 전부 Phase 2 |
| FR-10 | 게이트 판정 API | ◐ | ○ | ◐ | Task `done` 전이 조건 판정 | 리뷰 커버리지 조건·커밋 범위 판정은 Phase 2 |
| FR-11 | 승인함(Inbox) | ◐ | ○ | ◐ | 스펙 승인·플랜 승인·질문 3유형 + 스펙 코멘트 왕복, 원클릭 승인/거절/코멘트 | CR·에스컬레이션 카드(5유형 완성)는 Phase 2 |
| FR-12 | 알림 | ◐ | ○ | ◐ | 인앱 알림 | Slack·메일·다이제스트는 Phase 2 |
| FR-13 | 증적·커버리지 | ◐ | ○ | ◐ | PR·커밋 웹훅 수신, Task↔PR 링크 | 커버리지 계산·대시보드는 Phase 2 |
| FR-14 | 멀티테넌시 | ● | ◐ | ● | Organization/Project/User n:n, 역할 6종(admin·planner·designer·developer·qa·viewer) 권한 API·UI 양쪽 강제(P0는 단일 조직·단일 프로젝트 고정) | — |
| FR-15 | 에이전트 연동 | ◐ | ◐ | ◐ | MCP tools P0 8종 + P1 7종 = **15종**(§4.2) + PAT, Claude Code 플러그인 v1(스킬 5종 + hooks + `.mcp.json`), 훅 수집기 | Codex 완전 지원·`AGENTS.md` 배포·OAuth 2.1은 Phase 2(§5) |
| FR-16 | 감사 로그 | ● | ◐ | ● | append-only Event 전 상태 전이 + `is_agent` 액터 구분(P0), 엔티티별 이력 재구성 뷰(P1) | — |
| FR-17 | clemvion 임포트 | ◐ | ◐ | ◐ | spec 임포터(P0: `spec/` 384 md 중 순수 135 md) → plan 임포터(P1: `plan/` 450 md). 멱등 재실행. 도구는 **프로파일 기반 범용 임포터**이고 clemvion은 그 내장 프로파일이다 — 실행은 원본 체크아웃 장비의 CLI(`@nerv/cli`)가 임포트 API(EP-IMP-01~05)를 호출하는 형태([4.7 스펙 임포터](importer.md) §1.4·§3.2) + 래퍼 스킬 `/nerv:import`(§4.3) | review 소급 임포트는 Phase 2. SoT는 MVP 기간 내내 git(컷오버는 Phase 2 M1부터 — 로드맵 §7.2). 양방향 동기화·서버 주도 원격 저장소 clone은 하지 않는다(§5) |

### 3.3 기획자 터미널 경로 — 명시적 포함

스펙 편집은 웹 에디터 단독 경로가 아니다. [로드맵](../03-proposal/roadmap.md) §3.2가 명시한 대로 MVP는 **기획자 터미널 경로 — 초안 편집 리스 · 코멘트 왕복 · 사전 검토 셀프서비스** — 를 포함한다.

- 웹과 에이전트는 같은 `draft` SpecVersion을 번갈아 잡는 **두 개의 입력 장치**다. 초안 편집 리스 TTL 30분(Task 클레임 리스와 같은 상수), 같은 사용자면 표면 간 자동 인계, 다른 사용자는 `NERV_DRAFT_LEASED`([에이전트 연동 설계](../03-proposal/agent-integration.md) §2.7).
- 별도 FR 추가 없이 **FR-01·FR-06·FR-11의 기존 범위 안**이다. 대응 도구는 `nerv_spec_draft_upsert`·`nerv_spec_check`·`nerv_spec_comment_resolve`·`nerv_spec_submit_review`(모두 P1 — §4.2).
- 검증은 로드맵 성공 기준 1-11(기획자 웹·터미널 왕복 — 리스 인계·`base_version` 충돌 0 실증) 그대로다. 재현 절차는 [4.8 백로그](backlog.md)의 E2E 수용 시나리오에 둔다.

### 3.4 비기능 요구사항 범위 표

| NFR | 이름(정본 인용) | MVP | P0 | P1 | MVP에서 되는 것 | MVP에서 안 되는 것(Phase 2+) |
| --- | --- | :-: | :-: | :-: | --- | --- |
| NFR-01 | 자가호스팅 | ● | ◐ | ● | compose 단일 파일 기동(P0), 백업·복구 왕복 검증(P1) | — |
| NFR-02 | 실시간성(≤5s) | ● | ◐ | ● | WebSocket·SSE 푸시, 보드 반영 p95 ≤ 5초 | — |
| NFR-03 | 보안 | ● | ◐ | ● | PAT 프로젝트 스코프(P0), 권한 비확대·스펙 본문 비신뢰(P1). 인증 수단은 better-auth 세션(웹)+PAT(에이전트) — §2.1 인용 | OAuth 2.1 리소스 서버는 Phase 2, SSO는 Phase 3+ |
| NFR-04 | 규모 | ◐ | ○ | ◐ | 목표 규모 설계(프로젝트 수십·동시 세션 수십) | 부하 시험은 Phase 2 |
| NFR-05 | 로컬 폴백 | ◐ | ○ | ◐ | 에이전트 오프라인 읽기 캐시 | 복구 후 자동 동기화는 Phase 2 |

### 3.5 MVP 공통 상수 — 정본 인용

구현 전반이 공유하는 상수다. 리스·하트비트·stale의 정본은 [에이전트 연동 설계](../03-proposal/agent-integration.md) §2.7, blob TTL의 정본은 [데이터 모델](../03-proposal/data-model.md) 보존 정책이며, 다른 값을 쓰면 결함이다.

| 상수 | 값 | 적용 |
| --- | --- | --- |
| 클레임 리스 TTL | **30분** | Task 클레임 리스·초안 편집 리스 **동일 상수**(D-04 문서 축 확장) |
| 하트비트 주기 | **60초** | `nerv_task_heartbeat` — 응답은 서버→세션 역채널을 겸한다 |
| 세션 stale 임계 | **30분** | 무활동 초과 시 `stale` 자동 전이 + 클레임 자동 회수(D-13) |
| 리뷰 프롬프트 blob TTL | 30일 | **MVP 범위 아님** — Phase 2 리뷰 수집(FR-09)부터 적용, 참고로만 기재 |

---

## 4. 화면·도구·스킬 범위

### 4.1 화면 범위 — S1~S5 · S7 · S8 + 로그인/온보딩

화면 번호·와이어프레임은 [화면 설계](../03-proposal/ui-wireframes.md)가 정본이고, 데이터·상태·컴포넌트 명세는 [4.5 화면 명세](screens.md)가 소유한다.

| 화면 | 이름(정본 인용) | MVP | 비고 |
| --- | --- | :-: | --- |
| — | 로그인/온보딩 | ● | better-auth 세션. PAT 발급 온보딩 절차는 [4.6 플러그인과 온보딩](plugin.md) §4 |
| S1 | 홈 대시보드 | ● | |
| S2 | 프로젝트 개요 | ● | |
| S3 | 스펙 상세 | ● | 에디터·코멘트·승인 패널·편집 리스 UI·터미널 이어쓰기(§3.3) |
| S4 | 작업 보드 | ● | 칸반, 위임 명세 4요소 강제 |
| S5 | 세션 모니터(미션 컨트롤) | ● | Phase 0은 읽기 전용 축소판 → Phase 1에 steer/stop 승격 |
| S6 | 리뷰 센터 | ○ | **Phase 2**(§5) |
| S7 | 승인함(Inbox) | ● | 3유형 카드(스펙 승인·플랜·질문) — CR·에스컬레이션 카드는 Phase 2 |
| S8 | 설정 · 멤버 · 토큰 | ● | MVP 탭: 멤버·역할, 에이전트 토큰(PAT 발급·폐기), 스펙 게이트 정책(T0~T3 티어 매핑 — 저위험 자동 통과는 로드맵 §3.5가 첫날부터 요구). git 연동 탭·리뷰 게이트 정책은 Phase 2 |

> **S8 게이트 정책 탭 확정이 로드맵 표기 하나를 대체한다.** [로드맵](../03-proposal/roadmap.md) §3.2(v0.1 · 2026-08-13)는 "S6 리뷰 센터와 S8의 연동·게이트 정책 탭은 Phase 2"로 적었다. 이 중 **S8 게이트 정책 탭의 스펙 게이트(T0~T3 티어 매핑) 부분을 MVP로 앞당긴다**(2026-08-21, 로드맵 §3.2 표기 대체. 근거: 로드맵 §3.5 '저위험 자동 통과 경로를 첫날부터 켠다'). git 연동·리뷰 게이트 정책 탭은 로드맵대로 Phase 2다.

### 4.2 MCP 도구 범위 — 15종 (P0 8종 + P1 7종)

도구 정의(입력·출력·권한·멱등성)는 [에이전트 연동 설계](../03-proposal/agent-integration.md) §2.3 카탈로그(17종)가 정본이며, 여기서는 이름·티어·Phase 배정만 인용한다. **MVP = 15종, 카탈로그 완성(17종)은 Phase 2.**

| Phase | 도구 | 티어 | 한 줄(카탈로그 호출 시점 인용) |
| --- | --- | :-: | --- |
| P0 | `nerv_bootstrap` | A1 | 세션 시작 직후 첫 도구 호출 |
| P0 | `nerv_spec_tree` | A1 | 스펙 탐색 시작 |
| P0 | `nerv_spec_search` | A1 | 컨텍스트 수집·중복 확인 |
| P0 | `nerv_spec_get` | A1 | 구현 착수 전, 리뷰 전 |
| P0 | `nerv_task_next` | A1 | 클레임 직전 |
| P0 | `nerv_task_claim` | A2 | 작업 착수 |
| P0 | `nerv_task_heartbeat` | A1 | 60초 주기 |
| P0 | `nerv_task_release` | A2 | 세션 종료·작업 전환·중단 |
| P1 | `nerv_spec_draft_upsert` | A2 | 스펙 초안 작성·CR 제안 |
| P1 | `nerv_spec_submit_review` | A3 | 초안 완료 후 사람 검토 요청 |
| P1 | `nerv_spec_check` | A1 | 초안 저장 후·제출 전 아무 때나 |
| P1 | `nerv_spec_comment_resolve` | A2 | 코멘트 반영 직후 |
| P1 | `nerv_task_update` | A2 | 상태 변화 시점(`done` 시도는 서버 게이트) |
| P1 | `nerv_question_create` | A2 | 판단 불가·경계 이탈·게이트 필요 |
| P1 | `nerv_session_event` | A1 | 훅 없는 실행 환경의 폴백 |
| ~~P2~~ | `nerv_review_submit` · `nerv_finding_resolve` | — | **MVP 제외**(§5) — Phase 2에서 카탈로그 17종 완성 |

임포트에는 **MCP 도구를 만들지 않는다.** 전수 계정·바이트 보존·멱등 재실행(REQ-IMP-001~004)이 재현돼야 하는 결정적 ETL이라 LLM이 매개하는 도구 호출로 쪼개지 않는다 — 에이전트가 관여하는 지점은 CLI를 감싸는 스킬 `/nerv:import`뿐이다([4.7 스펙 임포터](importer.md) §3.6). 그래서 MVP 도구 수는 15종 그대로다.

티어 표기는 도구 위험 티어 **A1~A4**다. 스펙 변경 게이트 티어 **T0~T3**([스펙 워크플로우와 거버넌스](../03-proposal/spec-workflow.md) §2.4)와는 **다른 축**이므로 혼용하지 않는다. MCP 15종 ↔ 내부 서비스 ↔ REST 대응 표는 [4.4 API 명세](api.md) §4가 소유한다.

### 4.3 플러그인 스킬 범위 — 5종

| 스킬 | MVP | 책임([에이전트 연동 설계](../03-proposal/agent-integration.md) §3.2 인용) |
| --- | :-: | --- |
| `/nerv:next` | ● | 다음 작업 추천·클레임 |
| `/nerv:spec` | ● | 스펙 초안·CR 작성 경로 |
| `/nerv:impl` | ● | 클레임한 Task의 구현 절차 |
| `/nerv:question` | ● | 질문 에스컬레이션·폴링 |
| `/nerv:import` | ● | **2026-08-22 추가** — 임포터 CLI 래퍼: 프로파일 선택 → dry-run → 리포트 요약 → 사람 승인 → `--apply` → 멱등 재실행 검증. 대상 저장소를 가리지 않는다(프로파일만 바뀐다 — [4.7 스펙 임포터](importer.md) §3.6) |
| `/nerv:review` | ○ | **Phase 2** — 리뷰 도구 2종과 함께(스킬 5종 → 6종) |

SKILL.md 5종의 파일 전문·hooks.json·`.mcp.json`·온보딩 절차는 [4.6 플러그인과 온보딩](plugin.md)이 소유한다.

> **스킬이 5종인데 도구가 15종인 이유.** 스킬은 도구와 1:1이 아니다 — `/nerv:import`는 MCP 도구가 아니라 로컬 CLI를 실행하는 절차 스킬이다(§4.2). 플러그인이 배포하는 것은 "무엇을 어떤 순서로 하느냐"이고, 서버 권한은 여전히 PAT 스코프가 정한다.

---

## 5. Non-goals — MVP에서 하지 않는 것

전부 "안 한다"가 아니라 "이 Phase에서 한다"이다. 항목·시점은 [로드맵](../03-proposal/roadmap.md) §4(Phase 2)·§5(Phase 3+)와 정합한다.

| 하지 않는 것 | 언제 하나 | 왜 MVP가 아닌가 |
| --- | --- | --- |
| 리뷰 센터 S6 | Phase 2 | FR-09(리뷰 수집)가 Phase 2라 표시할 데이터가 없다 |
| 리뷰 도구 2종 `nerv_review_submit` · `nerv_finding_resolve` | Phase 2 | 게이트 둘째 단(리뷰·커버리지)과 한 몸 — MVP 도구는 15종으로 고정 |
| `/nerv:review` 스킬 | Phase 2 | 위 도구 2종에 의존 |
| Codex 완전 지원 | Phase 2 | P0에서 tools-only 완주(로드맵 성공 기준 0-8)는 검증하되, 질문 폴링 폴백·notify 매핑·`AGENTS.md` 배포는 Phase 2. MVP는 `config.toml`·`AGENTS.md` **초안 제공**까지 — 경계는 [4.6 플러그인과 온보딩](plugin.md) §5 |
| CR 델타 UI 고도화 | Phase 2 | FR-04(ADDED/MODIFIED/REMOVED 뷰·영향 분석)가 Phase 2. MVP의 스펙 diff는 버전 diff(FR-02)까지 |
| 실시간 공동 편집(CRDT) | Phase 3+ (착수 조건: 409 재시도 주 20건 이상) | 서버 권위 + `base_version` 409 + 편집 리스로 충분하다는 실증(아키텍처 §4.2) |
| OAuth 2.1 리소스 서버 | Phase 2 | 2026-08-20 인증 확정(better-auth)으로 이동 — §2.1 콜아웃 참조. MVP 에이전트 인증은 PAT |
| 임포트 양방향 동기화 · 서버 주도 저장소 clone | Phase 3+ (착수 조건부) | 임포트는 복제이고 SoT는 git이다(§6.1-5). 서버는 대상 저장소에 접근하지 않는다 — 파일을 읽는 쪽이 파일 있는 장비라는 것이 임포터 구조의 전제다([4.7 스펙 임포터](importer.md) §3.2) |
| 임포트 MCP 도구 | — (계획 없음) | 결정적 ETL을 LLM 매개 도구 호출로 쪼개면 전수 계정·멱등 검증이 재현되지 않는다. 에이전트 경로는 스킬 `/nerv:import`뿐(§4.2·§4.3) |
| 외부 검색엔진(Elasticsearch 등) | — (계획 없음, §2.2 트리거로만) | Postgres 하이브리드(FTS+trgm+pgvector)로 목표 규모(NFR-04) 충분. 운영 컴포넌트 +1의 비용이 이득을 넘는다 |
| OpenAI 호환이 아닌 임베딩 SDK 직결(Voyage 전용 SDK 등) | — (계획 없음) | 제공자는 OpenAI 호환 `/v1/embeddings` 단일 계약만(REQ-CB-020) — 제공자별 분기 코드를 만들지 않는다. ※ 외부 제공자 사용 시 스펙 본문이 그 제공자에 전송된다 — 기밀 등급이 높은 프로젝트는 자가호스팅 프로필을 쓰는 것이 운영 권고다 |
| 전역 관계 그래프 뷰·서버 watch 테이블 | Phase 2 | S3 관계 패널(양방향 목록)로 MVP 충족. 그래프 시각화·워치 서버 동기화는 알림 확장과 함께([4.5](screens.md) §2.4) |
| git 미러 export | Phase 2 말(M2 컷오버 시점) | MVP 기간에는 spec/plan의 SoT가 git이라 export할 것이 없다(로드맵 §7.4). **HTTP md 미러(`GET …/specs/{id}.md` · `llms.txt`)는 별개로 MVP 포함** — [4.4 API 명세](api.md) §2 |

이 표는 3부 non-goals([1.2 문제 정의와 요구사항](../01-problem/pain-points.md) §5 — 코드 호스팅·CI·범용 PM·에이전트 런타임 비대체, 로컬 하네스 전면 흡수 금지)를 대체하지 않고 그 위에 얹힌다.

---

## 6. 전제 · 제약 · 스파이크

### 6.1 전제와 제약

| # | 전제/제약 | 내용 |
| --- | --- | --- |
| 1 | 런타임 | Node.js LTS. 패키지 매니저 pnpm(모노레포 workspace) |
| 2 | 배포 이중 타깃 | 로컬·소규모 = docker-compose 단일 파일, 운영 = k8s(kustomize base+overlays). 같은 이미지 3종 공유(§2.1). 인프라 서비스는 Postgres(+pgvector·pg_trgm)·MinIO·**Valkey**(방송 MQ — pub/sub 전용·무영속) + **`embed`**(로컬 프로필 전용 — 외부 제공자 사용 시 미기동, [4.2](codebase.md) §5.2a). 상세 실물은 [4.2 코드베이스와 배포](codebase.md) |
| 3 | 워커 단일 인스턴스 | `nerv-worker` replica 1 + Postgres advisory lock, HPA 제외 |
| 4 | 마이그레이션 실행 위치 | compose는 기동 시, k8s는 Job — [4.2 코드베이스와 배포](codebase.md) §6 |
| 5 | SoT 경계 | MVP 기간 중 clemvion `spec/`·`plan/`의 SoT는 git이다. 임포트는 복제이고 컷오버(M1~)는 Phase 2부터(로드맵 §7.2·§7.4) |
| 5b | 임포트 실행 위치 | 서버는 임포트 대상 저장소의 체크아웃에 접근할 수 없다는 전제다 — 임포터 CLI는 원본이 있는 장비에서 돌고 서버에는 `import:write` PAT로만 붙는다([4.7 스펙 임포터](importer.md) §3.2 · [4.2 코드베이스와 배포](codebase.md) §1.3) |
| 6 | 파일럿 구성 | 프로젝트 2개 — 신규 1 + clemvion 미러(읽기 전용) 1. 동시 세션 상한 프로젝트당 3에서 시작(로드맵 §3.5) |
| 7 | 저위험 자동 통과 | T0 자동 통과 경로를 파일럿 첫날부터 켠다(로드맵 §3.5, D-06) |
| 8 | 운영 Postgres 위치 | 미확정 — 클러스터 외부 권장 vs CloudNativePG. 백로그 확인 태스크([4.8 백로그](backlog.md)) |

### 6.2 검증 스파이크 — 확정 결정의 검증 태스크

스택은 확정이지만, 아래 5종은 Phase 0 착수 주간에 **스파이크(검증 태스크)** 로 실증한다. 스파이크 실패는 결정 번복이 아니라 §2.2 재검토 트리거의 조기 점화이며, 스토리 분해는 [4.8 백로그](backlog.md) E06이 소유한다.

| 스파이크 | 검증 대상 | 통과 기준(요약) |
| --- | --- | --- |
| 실시간 게이트웨이 PoC | NestJS `@WebSocketGateway`(websocket 전송만) + SSE 스트림 + Valkey pub/sub 팬아웃 | 2개 API 인스턴스에서 WS·SSE 클라이언트 각각 룸/스트림 브로드캐스트 수신, 재연결 시 재조회로 화면 정합 |
| TipTap md 왕복 검증 | 지원 노드 화이트리스트의 md 직렬화 왕복 | 노드 8종 각각 md→에디터→md 왕복 손실 0 |
| drizzle 마이그레이션 파이프라인 | `packages/schema` 선언 → drizzle-kit 생성 → compose 기동/k8s Job 적용 | 신규 DB에서 초기 스냅샷 적용·재실행 멱등 |
| MCP 리비전 병행 서빙 | 2026-07-28 리비전 + 구 리비전(세션 ID 시대) 동시 서빙 | Claude Code·Codex 현행 클라이언트 각각 `nerv_bootstrap` 호출 성공 |
| 임베딩 제공자·하이브리드 검색 | OpenAI 호환 클라이언트 3프로필 스모크(로컬 TEI CPU p95 · LM Studio · OpenAI `dimensions=1024`) + FTS/trgm/하이브리드(RRF) 한국어 품질 비교([4.8 백로그](backlog.md) E06-S06) | 프로필별 지연·차원 검증 통과, 하이브리드가 렉시컬 단독 대비 품질 우위 확인 |

---

## 참고 자료

### 이 문서가 인용한 정본

- [1.2 문제 정의와 요구사항](../01-problem/pain-points.md) — FR-01~17 · NFR-01~05 · P1~P8의 정의와 수용 기준 전문(§4), non-goals(§5)
- [3.7 로드맵](../03-proposal/roadmap.md) — Phase 구분·종료 게이트·FR×Phase 배분표(§1.3)·성공 기준(§2.4·§3.4)·파일럿 규칙(§3.5)·마이그레이션 순서(§7)
- [3.2 시스템 아키텍처](../03-proposal/architecture.md) — 기술 스택 선택 요약·대안 비교·재검토 트리거(§4), docker-compose 구성(§4.4)
- [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) — MCP 도구 카탈로그 17종(§2.3)·에러 규약과 리스 상수(§2.7)·플러그인 구성(§3)
- [3.5 스펙 워크플로우와 거버넌스](../03-proposal/spec-workflow.md) — 게이트 티어 T0~T3(§2.4)·권한 매트릭스
- [3.6 화면 설계](../03-proposal/ui-wireframes.md) — S1~S8 와이어프레임 정본
- [3.1 비전과 핵심 시나리오](../03-proposal/vision.md) — 3대 가치·성공 지표(§5.2)

### 이 문서를 인용하는 4부 문서

- [4.2 코드베이스와 배포](codebase.md) — §2.1 배포 규약의 실물(트리·compose·k8s)
- [4.3 데이터베이스 스키마](database.md) — 확정 스택(Postgres+Drizzle)의 DDL 실물
- [4.4 API 명세](api.md) — 도구 15종 ↔ REST 대응, HTTP md 미러
- [4.5 화면 명세](screens.md) — §4.1 화면 범위의 데이터·상태·컴포넌트 명세
- [4.6 플러그인과 온보딩](plugin.md) — §4.3 스킬 5종 전문과 Codex 경계
- [4.7 스펙 임포터](importer.md) — FR-17 ◐ 범위의 파싱·멱등 규칙
- [4.8 백로그](backlog.md) — §6.2 스파이크 E06과 운영 Postgres 확인 태스크
