# NERV(가칭) — AI 에이전트 협업 개발 플랫폼 제안서

> **요약** — NERV는 기획자·디자이너·개발자·QA가 하나의 플랫폼에서 **스펙 문서를 단일 진실**로 관리하고, Claude Code·Codex 같은 AI 에이전트를 **MCP·훅·스킬로 연동**해 스펙 작성→검토→구현→테스트를 수행하며, 사람은 **승인/거절/코멘트 게이트**를 지키고 **누구(hostname)의 어떤 에이전트 세션이 무엇을 하는지** 실시간으로 보는 멀티 프로젝트 × 멀티 유저(n:n) 협업 플랫폼이다. 이 제안서는 기존 1인용 하네스(clemvion)의 실측 분석과 웹 딥리서치(도구 생태계·협업 플랫폼·연동 기술·저장 전략·HITL·실전 사례)를 근거로 문제 정의부터 아키텍처·데이터 모델·연동 설계·화면·로드맵까지를 다룬다.
>
> 문서 버전 v0.1 · 2026-08-13 · 사람이 읽기 좋은 HTML 판: [html/index.html](html/index.html)

## 읽는 순서

처음이라면 **[html/index.html](html/index.html)** (개요)에서 시작해 1부→3부 순서로 읽는 것을 권장한다.
빠르게 결론만 보려면: [문제 정의](01-problem/pain-points.md) → [비전](03-proposal/vision.md) → [로드맵](03-proposal/roadmap.md).

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

## 핵심 수치 (전체 문서의 근거 뼈대)

- clemvion `review/`에만 **markdown 13,777개·131MB** — review 이력 blob이 `.git` packed blob 바이트의 **60%**
- **73일간 리뷰 세션 1,891개**(일평균 26개), 커밋 2,464개 중 38%가 review/ 접촉 — 리뷰 산출물이 다음 리뷰의 diff에 포함되는 **자기증식 루프** 실측
- 스펙 동시수정 자동 검출은 **"다른 머신·세션이면 로컬에서 안 보인다"는 이유로 의도적으로 제거**됨(clemvion #576) — 로컬 git 아키텍처의 구조적 상한
- 업계 실측: AI 도입 팀에서 **PR 리뷰 시간 중앙값 +441%, 무리뷰 머지 31%**(Faros AI, 2.2만 명 계측) — 병렬 에이전트의 제1 실패 모드는 리뷰 병목

## 이 문서 세트의 관리 규약 (유지보수용)

- **md가 원본**이고 html은 사람 열람용 파생본이다. 내용 수정 시 둘 다 갱신한다(구조는 `html/`의 사이드바 순서를 따른다).
- 용어·상태값·결정 번호(D-01~D-14)·요구사항 번호(FR/NFR)는 [pain-points.md](01-problem/pain-points.md)의 정의를 단일 기준으로 한다.
- 근거 URL은 실제 접속 확인된 것만 싣는다. clemvion 근거는 `clemvion:경로` 표기.
- 큰 방향 변경(결정 추가·폐기)은 이 README의 버전을 올리고 각 문서 머리의 버전 표기를 동기화한다.
