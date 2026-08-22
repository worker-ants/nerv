# NERV(가칭) — AI 에이전트 협업 개발 플랫폼 제안서

> **요약** — NERV는 기획자·디자이너·개발자·QA가 하나의 플랫폼에서 **스펙 문서를 단일 진실**로 관리하고, Claude Code·Codex 같은 AI 에이전트를 **MCP·훅·스킬로 연동**해 스펙 작성→검토→구현→테스트를 수행하며, 사람은 **승인/거절/코멘트 게이트**를 지키고 **누구(hostname)의 어떤 에이전트 세션이 무엇을 하는지** 실시간으로 보는 멀티 프로젝트 × 멀티 유저(n:n) 협업 플랫폼이다. 이 제안서는 기존 1인용 하네스(clemvion)의 실측 분석과 웹 딥리서치(도구 생태계·협업 플랫폼·연동 기술·저장 전략·HITL·실전 사례)를 근거로 문제 정의부터 아키텍처·데이터 모델·연동 설계·화면·로드맵까지를 다룬다.
>
> 문서 버전 v1.0 · 2026-08-22 · 사람이 읽기 좋은 HTML 판: [html/index.html](html/index.html)
>
> v1.0 변경(2026-08-22 — 구현 착수 중 발견): **인증 인프라 테이블 3종 명세 추가**(4.3 §2.16 — `auth_session`·`auth_account`·`auth_verification` + `"user"` 2컬럼). 확정 스택 better-auth가 요구하는 물리 테이블인데 DDL 전문에 빠져 있어 웹 세션 인증 구현이 막혀 있었다. **엔티티 29종 카운트는 불변**(검색 인덱스와 같은 "도메인 엔티티 아님" 등급). 같은 절에서 **organization 플러그인 미사용**을 확정한다 — 조직·멤버십·역할의 정본은 도메인 테이블(3.3 §2.1)이고 플러그인은 같은 사실을 두 곳에 저장하게 만든다. 다른 결정·요구는 불변.
>
> v0.9 변경(2026-08-22 — 구현 착수 중 발생): **배포 산출물 위치 개정(REQ-CB-015)** — 배포 트리를 `codebase/deploy/`에서 **저장소 루트 `deploy/`**로 옮기고, 저장소 구역을 문서·규약·코드(`codebase/`)·배포(`deploy/`) 넷으로 정리했다. 이미지 빌드 컨텍스트는 저장소 루트로 통일(4.2 §5.3·§6.1). 다른 결정·요구는 불변.
>
> v0.2 변경: ① 구현 코드 위치를 저장소 `codebase/` 하위로 확정(4.2 §1, REQ-CB-015) ② 실시간 채널을 WebSocket 단일에서 **WebSocket + SSE 다중 채널**로 확장하고 팬아웃 **방송 MQ를 Valkey pub/sub**로 확정(4.1 §2 · 4.4 §3 · 4.3 §3) ③ 에이전트 작업 규약 [AGENTS.md](../AGENTS.md) 신설(CLAUDE.md가 import).
>
> v0.8 변경(2026-08-22 — 재검토 후속): ① 검색 p95 목표치 **보류 결정** 기록(E06-S06 실측 후 확정 — 4.4 §2.2b) ② `nerv_spec_search`에 `references?` 필터 추가(REST와 입력 정합 — 3.4 §2.3) ③ **로드맵 v0.2** — Phase 0·1 범위 표에 하이브리드 검색·탐색 UI 역반영(판정·배분 불변, 표기 보완).
>
> v0.7 변경(2026-08-22 — 임베딩 제공자 추상화, **v0.6 "자가호스팅만"의 당일 번복**): 임베딩 호출을 **OpenAI 호환 `/v1/embeddings` 단일 계약**으로 추상화 — 제공자는 env 프로필(로컬 = TEI CPU / 스테이징 = LM Studio / **운영 = OpenAI** `dimensions=1024`). 외부 전송 금지 조항(구 REQ-CB-020)은 폐기하고 외부 전송은 운영 주체의 env 명시 선택으로 전환(기본값 자가호스팅, 고기밀 프로젝트는 자가호스팅 권고). 차원 1024 전 프로필 고정(REQ-CB-021), 프로필 정본 4.2 §5.2a.
>
> v0.6 변경(2026-08-22 — 스펙 열람·검색 대규모 대응): ① **하이브리드 검색 MVP 확정** — Postgres FTS + pg_trgm + **pgvector**(HNSW) + **자가호스팅 임베딩**(`nerv-embed` — TEI + BGE-m3, 외부 임베딩 API 금지) + **관계 확장(graph RAG)**. 근거: `nerv_spec_search`가 P0 도구 — 에이전트가 첫날부터 검색의 주 소비자(4.1 §2.1 · 4.4 §2.2b · 4.3 §2.15) ② **관계 가시화** — EP-SPEC-18(역참조 1급)·S3 관계 패널·영향 미리보기 ③ **탐색 UI** — 전역 퀵 스위처(⌘K)·트리 지연 로드·검색 결과 뷰(4.5) ④ 인프라 서비스 4종(+embed), 백로그 스토리 68 → 74.
>
> v0.5 변경(2026-08-22 — 구현 착수 검토의 공백 보완): ① **스펙 메타 표면 신설**(EP-SPEC-15~17 — 이동·개명·아카이브. FR-01 "이동·개명에도 ID 불변"의 실행 경로, 4.4 §2.2 · 4.5 §2.4) ② **`gate_policy`·`retention` 키 스키마 확정**(4.4 §2.1a — S8 편집 항목 정합) ③ **쿼터 시작값**(4.4 §1.8 — PAT 300/min · 웹 600/min · ingest 120/min) ④ **`spec_relation` 자동 추출**(4.4 REQ-API-024 — 참조 전파의 데이터 전제) ⑤ **오프라인 폴백 실물**(4.6 §3.4 — `.nerv/cache`·`outbox`) ⑥ **테스트 러너 확정**(Vitest + Playwright — 4.1 §2.1) ⑦ **CI 전문**(4.2 §4.5) ⑧ **백업·복구 절차**(4.2 §6.5). 백로그 스토리 65 → 68.
>
> v0.4 변경(2026-08-22 — 임포터 실행 모델·범용화): ① 임포터를 **프로파일 기반 범용 스펙 임포터**로 확정하고(clemvion·nerv-docs는 내장 프로파일, 사용자 정의는 프로파일 파일) 문서 제목을 "4.7 스펙 임포터"로 변경 ② 실행 모델을 DB 직결에서 **API 클라이언트 CLI**로 전환 — 운영 서버가 원본 체크아웃에 접근할 수 없다는 사실이 근거(4.7 §3.2). 임포트 REST 표면 **EP-IMP-01~05** 신설(4.4 §2.10), 모노레포에 **`apps/cli`** 추가(4.2 §1.3) ③ 플러그인 **스킬 4종 → 5종**(`/nerv:import` — 4.6 §2.5), **MCP 도구는 15종 유지** ④ 백로그 스토리 62 → 65(E07-S04·S05 · E12-S05).
>
> v0.3 변경(FR-02 범위 확장 — 스펙이 구현보다 앞서갈 때의 기준 관리): ① **베이스라인**(프로젝트 승인 세트의 이름 있는 동결)을 MVP 핵심으로 포함 — 테이블 29종(+`spec_baseline`·`spec_baseline_item`), EP-SPEC-11~14, as-of manifest(3.5 §3.6 · 3.3 §2.2) ② **기준 버전 규약** — Task 컨텍스트는 파생 버전(`source_spec_version_id`)의 불변 스냅샷을 읽고, superseded 시 서버가 `basis_superseded` 표시 + 재브리핑 플래그(3.4 §2.4 · 3.5 §3.3) ③ **참조 문서 전파** — 승인 시 `spec_relation` 역방향 재검토 신호(`spec.recheck_requested`).

## 읽는 순서

처음이라면 **[html/index.html](html/index.html)** (개요)에서 시작해 1부→4부 순서로 읽는 것을 권장한다.
빠르게 결론만 보려면: [문제 정의](01-problem/pain-points.md) → [비전](03-proposal/vision.md) → [로드맵](03-proposal/roadmap.md).
구현에 바로 착수하려면 4부만 읽어도 되도록 쓰였다: [MVP 범위와 스택 확정](04-mvp/scope.md)부터 시작한다.

## 문서 목차

### 1부 · 현행 분석 (왜 필요한가)

| 문서 | 내용 |
| --- | --- |
| [1.1 clemvion 하네스 분석](01-problem/clemvion-analysis.md) | 현행 1인용 SDD+TDD 하네스의 구조(스킬·훅·워크플로우·spec/plan/review 체계) 전수 분석, 계승할 자산과 구조적 한계 — 전부 실측 근거 |
| [1.2 문제 정의와 요구사항](01-problem/pain-points.md) | 문제 P1~P8(스펙 충돌·중복 작업·버전 부재·추적 곤란·출처 단절·git 비대화·직군 장벽·n:n 부재)의 증상→근거→근본 원인, **FR-01~17 / NFR-01~05 요구사항 정의** |

### 2부 · 리서치 (근거)

| 문서 | 내용 |
| --- | --- |
| [2.1 Spec-Driven Development](02-research/spec-driven-development.md) | Spec Kit·Kiro·OpenSpec·Tessl·BMAD·spec-workflow-mcp 등 SDD 도구 생태계 분석 — 수렴하는 문서 구조와 **전 도구 공통의 멀티유저 공백**(1차 출처), 워터폴 비판·반론 |
| [2.2 병렬 에이전트 오케스트레이션](02-research/agent-orchestration.md) | Conductor·vibe-kanban·claude-squad·Claude Code web·Codex cloud·Copilot·Jules·Devin 등의 할당·격리·상태 표시·충돌 방지·개입 5축 비교, 검증된 패턴(원자적 클레임·세션 카드·3게이트), 리뷰 병목 실측 |
| [2.3 협업 플랫폼의 에이전트 통합](02-research/collab-platforms.md) | Linear for Agents(세션 상태머신·SLA·activity)·GitHub(Agent HQ·지시자≠승인자)·Jira Rovo·Notion·Asana·Slack — "에이전트=팀원" 모델의 수렴 패턴 |
| [2.4 Claude Code/Codex 연동 기술](02-research/integration-tech.md) | hooks 31종(`type:"http"`)·MCP(도구/리소스/OAuth·리비전 호환)·skills·plugins·OTel·Agent SDK, Codex 패리티(tools-only 제약) — NERV가 실제로 쓸 연동 표면 카탈로그 |

### 3부 · 플랫폼 제안 (무엇을 어떻게 만들 것인가)

| 문서 | 내용 |
| --- | --- |
| [3.1 비전과 핵심 시나리오](03-proposal/vision.md) | 한 줄 정의·3대 가치·포지셔닝("SDD 도구들의 Linear"), 직군별 페르소나 4종의 하루, 핵심 여정 3개, **Build vs Buy 비교**, 성공 지표 |
| [3.2 시스템 아키텍처](03-proposal/architecture.md) | 컴포넌트 구성(웹·API·MCP 게이트웨이·훅 수집기·DB·워커), **저장 전략(DB 단일 진실 + md 미러 + git export)**, 데이터 흐름 시퀀스 4종, 기술 스택 선정·대안 비교, 보안·확장 |
| [3.3 데이터 모델](03-proposal/data-model.md) | ERD 전체와 엔티티 상세(Spec/SpecVersion/Requirement, Task/Claim, AgentSession/Activity, ReviewSession/Finding, Approval/Question, Event…), clemvion frontmatter 매핑, 검증 질의 |
| [3.4 에이전트 연동 설계](03-proposal/agent-integration.md) | 3층 연동(MCP tools-first / 훅 텔레메트리 / 플러그인·AGENTS.md 배포), `nerv_*` MCP 도구 카탈로그, Claude Code·Codex 설정 예시, 세션 수명주기 규약, 보안 |
| [3.5 스펙 워크플로우와 거버넌스](03-proposal/spec-workflow.md) | 스펙 2축 상태(문서 승인 축 × 요구사항 구현 축), 승인·CR 흐름, Task 파생→클레임→게이트, 리뷰 파이프라인(fingerprint dedup·커버리지), 알림 설계 |
| [3.6 화면 설계](03-proposal/ui-wireframes.md) | IA와 S1~S8 와이어프레임(대시보드·프로젝트 개요·스펙 상세·작업 보드·세션 모니터·리뷰 센터·승인함·설정) — HTML 판은 실제 렌더링 목업 |
| [3.7 로드맵](03-proposal/roadmap.md) | Phase 0 PoC(조정 검증) → 1 MVP → 2 리뷰·연동 확장 → 3 고도화, 각 단계 성공 기준·리스크·clemvion 마이그레이션 계획 |

### 4부 · MVP 구체화 (구현 착수 가능한 명세)

| 문서 | 내용 |
| --- | --- |
| [4.1 MVP 범위와 스택 확정](04-mvp/scope.md) | MVP 가치 가설과 "구현 착수 가능" 정의, 확정 스택 전문(결정일·재검토 트리거), FR-01~17 포함/부분/제외 표, 화면·도구(15종)·스킬(5종) 범위와 non-goals |
| [4.2 코드베이스와 배포](04-mvp/codebase.md) | 저장소 구역(`docs/`·`codebase/`·`deploy/`)과 모노레포 트리 전문(`codebase/` 하위 — `apps/web`·`apps/api`·`apps/cli`·`packages/schema`), NestJS 모듈 맵(D-05 실물), 개발 환경 부트스트랩·docker-compose 전문, k8s(kustomize) 운영 배포 |
| [4.3 데이터베이스 스키마](04-mvp/database.md) | 29개 테이블 전체 DDL(FK·CHECK·인덱스·트리거·파티션), 이벤트 방송 규약(Valkey `nerv_events`), 개발 시드, 마이그레이션 왕복 수용 기준 — [3.3 데이터 모델](03-proposal/data-model.md)의 DDL 정본 |
| [4.4 API 명세](04-mvp/api.md) | `/api/v1` 공통 규약(인증 2경로·에러 코드·멱등키·페이지네이션), 리소스별 엔드포인트 전표, 실시간 채널 계약(WebSocket + SSE — 룸·이벤트), 임포트 표면(EP-IMP-01~05), MCP 15종 ↔ REST 대응 표 |
| [4.5 화면 명세](04-mvp/screens.md) | 라우팅 맵과 앱 셸, 화면별 데이터 소스·WS 구독·상태 3종·컴포넌트·수용 기준, TipTap 에디터 상세, 디자인 토큰. 와이어프레임 커버리지 표(§1.6) — S1~S8 그림은 [3.6 화면 설계](03-proposal/ui-wireframes.md), 신설 화면·하위 뷰(앱 셸·로그인·온보딩·알림 센터·스펙 목록·작업 상세 패널) 그림은 이 문서가 소유 |
| [4.6 플러그인과 온보딩](04-mvp/plugin.md) | 스킬 5종 SKILL.md 전문(`/nerv:next`·`/nerv:spec`·`/nerv:impl`·`/nerv:question`·`/nerv:import`), hooks.json·`.mcp.json` 전문, 사람 온보딩 절차(PAT 발급→설치→bootstrap), Codex 경계 |
| [4.7 스펙 임포터](04-mvp/importer.md) | 프로파일 기반 범용 임포터 — 내장 프로파일 `clemvion`(spec 135md·plan 450md)·`nerv-docs`, 파싱 규칙과 Spec/Requirement/Task 매핑, CLI(`nerv import`, dry-run 기본)+임포트 API 실행 모델, 래퍼 스킬 `/nerv:import`, 실패 리포트 형식과 수용 기준 |
| [4.8 백로그](04-mvp/backlog.md) | Phase 0·1 에픽/스토리 분해(`E01-S01` 형식, EARS 수용 기준·근거 링크), 의존 그래프와 착수 순서, E2E 수용 시나리오 |

## 핵심 수치 (전체 문서의 근거 뼈대)

- clemvion `review/`에만 **markdown 13,777개·131MB** — review 이력 blob이 `.git` packed blob 바이트의 **60%**
- **73일간 리뷰 세션 1,891개**(일평균 26개), 커밋 2,464개 중 38%가 review/ 접촉 — 리뷰 산출물이 다음 리뷰의 diff에 포함되는 **자기증식 루프** 실측
- 스펙 동시수정 자동 검출은 **"다른 머신·세션이면 로컬에서 안 보인다"는 이유로 의도적으로 제거**됨(clemvion #576) — 로컬 git 아키텍처의 구조적 상한
- 업계 실측: AI 도입 팀에서 **PR 리뷰 시간 중앙값 +441%, 무리뷰 머지 31%**(Faros AI, 2.2만 명 계측) — 병렬 에이전트의 제1 실패 모드는 리뷰 병목

## 이 문서 세트의 관리 규약 (유지보수용)

- **md가 원본**이고 html은 사람 열람용 파생본이다. 내용 수정 시 둘 다 갱신한다(구조는 `html/`의 사이드바 순서를 따른다).
- **애플리케이션·패키지 코드는 저장소 `codebase/` 하위에, 배포 산출물은 저장소 루트 `deploy/` 하위에** 둔다([4.2 코드베이스와 배포](04-mvp/codebase.md) §1, REQ-CB-015 — 2026-08-22 개정). `docs/`에는 문서와 html 파생본만 들어간다.
- 에이전트(Claude Code·Codex) 작업 규약의 정본은 저장소 루트의 [AGENTS.md](../AGENTS.md)다. `CLAUDE.md`는 그것을 import만 한다 — 어느 머신·세션에서 작업해도 같은 규약이 적용되게 하기 위해서다.
- 용어·상태값·결정 번호(D-01~D-14)·요구사항 번호(FR/NFR)는 [pain-points.md](01-problem/pain-points.md)의 정의를 단일 기준으로 한다.
- 근거 URL은 실제 접속 확인된 것만 싣는다. clemvion 근거는 `clemvion:경로` 표기.
- 큰 방향 변경(결정 추가·폐기)은 이 README의 버전을 올리고 각 문서 머리의 버전 표기를 동기화한다.
