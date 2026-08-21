---
id: SPC-MVP-IMPORTER
status: draft
updated: 2026-08-20
---
# clemvion 임포터

> **요약** — 이 문서는 `clemvion:spec/`(순수 스펙 135 md — status 분포 implemented 117 / partial 17 / backlog 1)과 `clemvion:plan/`(450 md)을 Spec/SpecVersion/Requirement/Task로 옮기는 임포터(FR-17)를 구현 착수 가능한 수준으로 확정한다. 매핑의 의미 정본은 [3.3 데이터 모델](../03-proposal/data-model.md) §3이고 단계 배정의 정본은 [3.7 로드맵](../03-proposal/roadmap.md) §7이다 — spec은 Phase 0, plan은 Phase 1, `review/` 소급은 Phase 2로 이 문서 범위 밖이다. 실행 모델은 CLI `nerv import`(dry-run 기본, `--apply`로 적재)이며, 멱등 키는 파일 경로+frontmatter id, 재실행은 변경분만 처리한다. 수용 기준은 REQ-IMP-001~010 — 135 md 전수 계정, 원문 바이트 보존(정보 손실 0), 연속 2회 실행 시 신규 생성 0. 마지막 절은 도그푸딩이다: `docs/04-mvp/*.md` 이 문서 세트 자체가 NERV에 임포트될 첫 스펙이고, 그래서 공통 frontmatter 규격을 갖는다.
>
> 문서 버전 v0.1 · 2026-08-20 · HTML 판: [importer.html](../html/importer.html)

---

## 1. 대상과 목표

### 1.1 무엇을, 언제 옮기나

FR-17의 수용 기준은 한 문장이다 — "`spec/` 384 md와 `plan/` 450 md를 Spec/SpecVersion/Requirement·Task로 변환하는 임포터가 멱등적으로 재실행되고, 변환 실패·수동 확인 필요 항목이 목록으로 보고된다"([1.2 문제 정의](../01-problem/pain-points.md) FR-17). Phase 배정은 [로드맵](../03-proposal/roadmap.md) §3 표의 "spec P0 → plan P1 → review P2"를 그대로 따른다.

| 대상 | 규모(실측 2026-08-13) | 변환 결과 | Phase | 이 문서에서 |
| --- | --- | --- | --- | --- |
| `clemvion:spec/` | 384 md · 9.3MB — 기계생성 API 카탈로그 249 md·4.6MB 제외 시 **순수 135 md · 49,383줄** | Spec / SpecVersion / Requirement / SpecRelation / Evidence | **P0** | §2.1~2.5 |
| `clemvion:plan/` | 450 md · 5.2MB (in-progress 62 = 최상위 34 + 클러스터 28 / complete 387 / research 1) | Task / TaskDependency / Evidence | **P1** | §2.6 |
| `clemvion:review/` | 13,777 md · 131MB (code 9,070 + consistency 4,697 + spec-coverage 10) | ReviewSession / Finding / Resolution | **P2 — 범위 밖** | §2.7 경계만 |
| `docs/`(NERV 제안서 자체) | md 13편 + 4부 8편 | Spec / SpecVersion / Requirement (+ backlog 스토리 → Task) | P1(도그푸딩) | §5 |

순수 135 md의 frontmatter `status` 분포는 **implemented 117 / partial 17 / backlog 1**(`spec-only`·`archived` 0)이다. 이 수치는 [1.1 clemvion 하네스 분석](../01-problem/clemvion-analysis.md) §3.1이 2026-08-14에 재검증한 정본이며, 세는 방법 자체가 함정이라는 점이 §2.1의 파싱 규칙으로 이어진다.

### 1.2 임포트는 복제다 — 컷오버와 구분

이 임포터는 D-12(clemvion 점진 이관)의 실행 도구다. 로드맵 §7.2의 구분을 그대로 계승한다.

- **임포트(복제)** — NERV가 git의 사본을 읽어 들이는 것. **SoT(단일 진실)는 여전히 git**이다. Phase 0(spec)·Phase 1(plan)에서 수행하며, 이 문서가 다루는 전부다.
- **컷오버(쓰기 경로 전환)** — SoT가 NERV로 넘어가는 것(M1~M4). 사전 조건·검증·롤백은 로드맵 §7.4~7.6이 정본이며, 그 사전 조건 중 두 가지 — "임포터가 멱등 재실행 검증을 통과했다(신규 생성 0)", "정합 검사 — 원본 파일 수 ↔ 레코드 수, 샘플 30건의 본문 해시 일치" — 를 이 임포터가 공급한다.

임포트 기간에 NERV는 미러이므로, 원본이 갱신되면 임포터를 재실행해 따라잡는다(§3.4 변경분만 규칙). 양방향 동기화는 만들지 않는다 — 그것은 M4(Phase 3+)의 착수 조건부 항목이다.

### 1.3 목표와 비목표

**목표** (수용 기준은 §4.2 REQ-IMP-*):

1. **전수 계정(accounting)** — 스캔한 384 md 전부가 "적재 / 제외(카탈로그) / 실패 / 수동 확인" 중 정확히 하나로 분류되어 리포트에 남는다. 조용히 사라지는 파일이 0이다.
2. **정보 손실 0** — 본문은 바이트 그대로 보존한다. frontmatter는 필드로 흡수하되 원문 해시를 매니페스트에 남긴다.
3. **멱등 재실행** — 같은 입력으로 몇 번을 돌려도 결과가 같다(로드맵 Phase 0 종료 조건 0-7).
4. **추정 금지** — 자동으로 알 수 없는 것(owner의 신원, 요구사항 단위 구현 상태, 우선순위 미표기)은 추정해 채우지 않고 수동 확인 큐로 보낸다.

**비목표**:

- `review/` 소급 임포트 — P2(§2.7).
- 과거 실행 이력의 위조 — Claim·AgentSession은 실행의 기록이므로 임포터가 소급 생성하지 않는다(§2.6).
- 위임 명세 4요소의 소급 생성 — "옛 Task를 다시 착수할 때 명세를 채워야 `ready`로 전이한다"(로드맵 §7.3(2), FR-05).
- git 이력(과거 커밋)의 버전 이력 재구성 — 임포트 시점 스냅샷 1개 버전만 만든다. 과거 이력은 git이 계속 보관한다(D-01의 역할 분담).

---

## 2. 파싱 규칙

### 2.1 스캔 대상·제외·집계 대조 — clemvion 프로파일

임포터는 **소스 프로파일(profile)** 단위로 스캔 글롭·제외 글롭·매핑 규칙·기대 집계를 고정한다. `clemvion` 프로파일:

| 항목 | 값 |
| --- | --- |
| 스캔 루트 | `--root`로 받은 clemvion 체크아웃(READ-ONLY — 임포터는 원본에 어떤 쓰기도 하지 않는다) |
| spec 스캔 | `spec/**/*.md` — 384 md |
| spec 제외 | 기계생성 API 카탈로그 249 md(제외 글롭은 프로파일에 명시 고정) — 커밋 해시로 재생성 가능한 기계 산출물은 옮기지 않는다. `_prompts/`를 git에서 뺀 clemvion 자신의 판단, 그리고 "결론 영구·입력 휘발"(D-07)과 같은 원칙 |
| plan 스캔 | `plan/{in-progress,complete,research}/**/*.md` — 450 md |
| 기대 집계 | 적재 대상 총수 **135** — 불일치 시 **중단(abort)**. status 분포 **117/17/1** — 불일치 시 경고(warn) |

> **파싱 규칙 · frontmatter는 문서 선두 블록만 센다.** 단순 `grep '^status:'` 라인 집계는 **118/18/1/1(합 138)** 로 부풀려진다 — 규약 문서 `clemvion:spec/conventions/spec-impl-evidence.md`(5회)와 `clemvion:spec/conventions/swagger.md`(2회)가 **본문에 예시 frontmatter를 담고 있기 때문**이다. 임포터의 파서는 파일 첫 줄이 `---`일 때 그 블록 하나만 frontmatter로 취급하고, 본문 중간의 코드펜스·인용 예시는 절대 세지 않는다. 올바르게 파싱하면 117/17/1이고 합이 정확히 135로 맞는다([1.1 분석](../01-problem/clemvion-analysis.md) §3.1). 기대 집계를 프로파일에 선언해 두는 이유가 이것이다 — **측정 방법이 흔들리는 수치(P4)를 임포터가 재생산하면 안 된다.**

### 2.2 디렉터리 계층 → 스펙 트리

[로드맵](../03-proposal/roadmap.md) §7.3(1)의 매핑을 규칙으로 확정한다. clemvion `spec/`의 실측 계층은 루트 진입 문서 3건 + 영역 폴더 7개(2-navigation 18 · 3-workflow-editor 7 · 4-nodes 44(하위 7 카테고리) · 5-system 18 · 7-channel-web-chat 7 · conventions 22+카탈로그 249 · data-flow 16)다.

| 원본 | Spec 노드 | `spec.type` | 규칙 |
| --- | --- | --- | --- |
| 영역 디렉터리(예: `spec/2-navigation/`) | 트리 중간 노드 | `area` | 디렉터리당 노드 1개. 자체 `_product-overview.md`가 있으면 그 본문이 이 노드의 SpecVersion. 없으면 본문 없는 노드로 만들고 리포트에 표기(Spec은 트리 노드일 뿐 본문을 갖지 않는다 — 데이터 모델 §2.2) |
| `N-name.md` 개별 문서 | 리프 노드 | `feature` | 부모 = 소속 디렉터리의 area 노드 |
| `conventions/**`(카탈로그 제외) | 리프 노드 | `convention` | |
| 루트 진입 문서 3건 | 리프 노드 | 프로파일 예외 표로 고정: `0-overview.md` → `vision`, `1-data-model.md`·`6-brand.md` → `design` | 자동 판정하지 않는다 |
| `## Rationale`만으로 결정을 담은 문서 | 리프 노드 | `adr` **후보** — 자동 전환하지 않고 수동 확인 큐 | 로드맵 §7.3(1) "Rationale 단독 결정→`adr` 후보" |

필드 채움 규칙:

- `spec.key` ← frontmatter `id`(kebab-case). 옛 id는 이렇게 **별칭으로 보존**되어 기존 인용이 살아남는다(로드맵 §7.3(1)). 같은 프로젝트에서 key가 충돌하면 **중단** — clemvion은 "basename 충돌 시 영역 prefix" 관행으로 id 유일성을 유지해 왔으므로 충돌은 원본 결함이고, 임포터가 임의로 개명하지 않는다.
- `spec.sort_key` ← 파일·디렉터리명의 정수 접두(`0-`/`1-`/`5-` …). "정수 접두 규약을 데이터로 흡수"하는 자리가 정확히 이 필드다(데이터 모델 §2.2).
- `spec.title` ← 본문 첫 `# ` 헤딩. 없으면 파일명(리포트 warn).
- `spec.archived_at` ← `status: archived`일 때 임포트 실행 시각(현재 실측 0건).
- `spec.current_version_id` ← 이번 실행이 만든 SpecVersion.

### 2.3 spec frontmatter → 필드 매핑

의미 정본인 [데이터 모델](../03-proposal/data-model.md) §3.1을 실행 규칙으로 옮긴 표다. 컬럼명·값은 전부 그 문서와 1:1이다.

| clemvion 필드 | NERV 대응 | 임포터 규칙 |
| --- | --- | --- |
| `id:` (kebab-case, basename 기반) | `spec.key` + `spec.id`(서버 발급 UUID) | §2.2. UUID가 정본, 옛 id는 별칭 |
| `status:` 5값 | **2축 분해** — 문서 축 `spec_version.status` + 구현 축 `requirement.impl_status` | 아래 분해 표 |
| `code:` glob 목록 | `evidence(kind='code_path', locator=glob)` 다중 행 | glob당 1행. `source='human'`(실행자 위임), `stale=false`로 적재 후 **경로 실존 검사**를 돌려 미매치 glob은 `stale=true` + 수동 확인 큐 — "stale glob은 본 가드만으로 검출 불가"(R-1)라던 자기 인정 약점을 임포트 직후 값으로 드러낸다 |
| `pending_plans:` | `task(source_requirement_id=…, status≠done)` 링크 | P0 시점에는 Task가 없으므로 경로를 매니페스트의 미해소 목록에 적어 두고, **P1 plan 임포트가 해소**한다. 요구사항 단위 지정이 불가능한 항목은 Task의 `source_spec_version_id`만 세팅하고 수동 확인 큐로 |
| `user_guide:` | `evidence(kind='user_guide')` | 가드 미적용(R-10)이던 필드가 다른 증적과 같은 검증 경로에 올라온다 |
| 요구사항 표(`NAV-WF-01` 등) | `requirement` 행 | §2.5 |
| 요구사항 표 ✅ 마크 | **폐기** | 커버리지는 관계에서 계산한다(D-03). 131개 대 0개로 이미 갈라진 수동 표기를 데이터로 승격하지 않는다 |
| `## Overview` / 본문 / `## Rationale` | `spec_version.body_md` 안에 그대로 | §2.4 — 3섹션 규약은 본문 규약으로 유지, 위치 불변 |
| `> 관련 문서:` 상대링크 | `spec_relation` 행 | §2.4 — 관계 종류는 전부 `references`(종류 추정 금지) |

**status 분해 표** — 로드맵 §7.3(1)이 열어 둔 선택지("문서 `draft` 또는 `approved`")를 다음처럼 확정한다.

| clemvion `status` | 실측 | 문서 축 `spec_version.status` | 구현 축 `requirement.impl_status` 초기값 | 근거 |
| --- | --- | --- | --- | --- |
| `backlog` | 1 | `draft` | `unimplemented` | clemvion 라이프사이클에서 backlog는 "id가 `0-overview.md` 본문에 등장 의무"만 있는 약속 전 단계 — 문서 합의가 없다 |
| `spec-only` | 0 | `approved` | `unimplemented` | 스펙 본문은 완성·합의됐고 구현만 없는 상태. TTL 90일 빌드 실패 규약은 "approved + 파생 Task 0건" 워커 스캔으로 대체(데이터 모델 §3.1) |
| `partial` | 17 | `approved` | `in_progress` | 로드맵 "partial→approved + Requirement 일부 in_progress" |
| `implemented` | 117 | `approved` | `implemented` | |
| `archived` | 0 | `deprecated` | 유지(변경 없음) | + `spec.archived_at` 세팅 |

> **손실 주의 — 구현 축 초기값은 문서 status의 복사본이다.** 문서 단위 값 하나를 요구사항 단위로 자동 분해할 수는 없다(로드맵 §7.3(1) 손실 주의). 1,750줄 문서에 status 값이 하나뿐이어서 `CCH-SE-02`("spec이 `필수`로 약속한 update dedup이 통째로 미구현")가 통과한 것이 D-02의 기원 사고다. 그래서 `partial` 문서에서 나온 모든 Requirement 행은 **수동 확인 큐**(리포트의 manual 분류, §4.1)에 올라가고, 사람이 요구사항 단위로 확정한다. 임포터는 이 확정을 대신하지 않는다.

approved 버전의 결재 메타는 위조하지 않는다: `spec_version.approved_at` = 임포트 실행 시각(플랫폼 관점의 적재 시점), `approved_by_user_id` = NULL(소급 결재자 없음), `author_user_id` = CLI `--as-user` 실행자, `author_session_id` = NULL. 이후의 편집은 임포트가 아니라 정상 워크플로(draft → in_review → approved, [3.5 스펙 워크플로우](../03-proposal/spec-workflow.md) 정본)를 탄다.

### 2.4 본문 처리 — 원문 보존이 제1규칙

1. **바이트 보존** — `spec_version.body_md`는 frontmatter 블록(선두 `---` … `---`)을 제외한 본문과 바이트 동일하다. `content_hash = sha256(body_md)`(데이터 모델 §2.2의 정의 그대로)가 대조 키다. 요구사항 추출(§2.5)·링크 해소는 **파생 데이터를 만들 뿐 본문을 수정하지 않는다**.
2. **`## Rationale` 유지** — 3섹션 규약(`## Overview` → 본문 → `## Rationale`, Rationale 실측 105개 문서)은 본문 안에 그대로 남는다. "폐기된 대안 보존은 문화로 유지, 위치는 그대로"(데이터 모델 §3.1). Rationale만으로 구성된 결정 문서는 `adr` 후보로 수동 확인 큐에 올린다(§2.2).
3. **상호참조 링크 → `spec_relation`** — 본문의 in-repo 상대링크(스펙→스펙)를 해소해 `spec_relation(kind='references')` 행을 만든다. 해소 실패 링크는 행을 만들지 않고 리포트로 남긴다(로드맵 §7.3(1) "변환 실패 링크는 리포트로"). 본문 자체의 링크 재작성은 기본 **off**다 — 켜려면 `--rewrite-links`(§3.1)를 쓰며, 이때도 원문 버전(v1)을 남기고 재작성본을 후속 버전(v2)으로 얹어 정보 손실 0을 유지한다.

### 2.5 요구사항 추출 — `[A-Z]+-[A-Z]+-\d+` 휴리스틱

clemvion의 요구사항 ID는 `NAV-WF-01` · `ED-CV-01` · `ND-AG-24` · `CCH-SE-02` 형식(영역-화면-순번)으로 `_product-overview.md`의 표 안에서 정의되고, 커밋 메시지가 이 ID로 대화한다([1.1 분석](../01-problem/clemvion-analysis.md) §3.1). 추출 규칙:

| # | 규칙 |
| --- | --- |
| 1 | **정의 위치** — `_product-overview.md` 본문 표의 행 중 정규식 `[A-Z]+-[A-Z]+-\d+`에 매칭되는 ID 토큰을 가진 행만 정의로 취급한다. 본문 다른 곳의 등장은 참조일 뿐이며 행을 만들지 않는다 |
| 2 | **필드** — `requirement.ref` ← ID 원문(임포트 원본 어휘 계승 — 데이터 모델 §5.1 "요구사항 ref: `REQ-<영역>-<번호>` 또는 임포트 원본(`NAV-WF-01`)"). `statement_md` ← 행의 설명 셀 원문. `acceptance_md` ← 수용 기준 셀이 있으면 그 원문 — **EARS 정규화는 자동으로 하지 않는다**(사람 확인, 로드맵 §7.3(1)) |
| 3 | **소속** — `requirement.spec_id` = 그 `_product-overview.md`를 본문으로 갖는 area 노드. feature 단위 재배치가 필요해 보이는 행은 수동 확인 큐로 |
| 4 | **우선순위** — 필수→`must`, 권장→`should`(데이터 모델 §2.2의 매핑). 미표기는 NULL로 두고 추정하지 않는다 — plan `priority` 미선언을 null로 두는 로드맵 §7.3(2)와 같은 원칙 |
| 5 | **구현 상태** — `impl_status` 초기값은 소속 문서의 status 복사(§2.3 분해 표), `partial` 유래는 전건 수동 확인 큐 |
| 6 | **중복 ref** — `UNIQUE (project_id, ref)` 위반이 되는 두 번째 정의 행은 건너뛰고(첫 행 적재) 수동 확인 큐로 |
| 7 | **버전 델타** — `requirement.introduced_in_version_id` = `current_version_id` = 이번 임포트 버전. `requirement_version` 행은 `change_kind='added'`, `ordinal` = 표 내 순서, `statement_md` = 시점 스냅샷 |

✅ 마크는 읽지 않는다(§2.3 — 폐기). 상태 컬럼이 아예 없는 영역(`3-workflow-editor`·`7-channel-web-chat`)과 131개가 칠해진 영역(`2-navigation`)이 공존하는 표기를 신뢰할 수 없기 때문이며, 커버리지는 이후 관계에서 계산된다(D-03, FR-13).

### 2.6 plan frontmatter → Task 매핑 (P1)

의미 정본은 [데이터 모델](../03-proposal/data-model.md) §3.2, 규칙 정본은 [로드맵](../03-proposal/roadmap.md) §7.3(2)다. plan 필수 3필드는 `worktree:`(미착수 sentinel `(unstarted)`) · `started:`(ISO 날짜) · `owner:`다.

| clemvion | NERV | 임포터 규칙 |
| --- | --- | --- |
| md 파일 1건 | `task` 1행 | `plan/research/`(1건)는 Task를 만들지 않고 리포트에 "참고 문서" 분류만 남긴다(로드맵 §7.3(2)). 클러스터(하위 디렉터리 28건)의 묶음 정보는 매니페스트에 기록하되 Task 간 관계는 만들지 않는다 — 관계 추정 금지 |
| 디렉터리 + `worktree:` | `task.status` | `complete/` → `done`(+`done_at`=임포트 시각), `in-progress/` + `worktree: (unstarted)`(13/34) → `backlog`, `in-progress/` + worktree 값 있음 → `in_progress`. **`ready`로는 절대 적재하지 않는다** — 위임 명세 4요소를 소급 생성하지 않으므로(FR-05) `backlog → ready` 전이 조건을 만족할 수 없다 |
| `started:` | `task.created_at` | 데이터 모델 §3.2의 매핑. 값 없음·placeholder면 파일의 git 최초 커밋 시각이 아니라 **NULL 계열로 두지 않고** 임포트 시각 + 리포트 warn(시각 추정 금지) |
| `owner:`(자유 텍스트) | `task.assignee_user_id` | **owner는 신원이 아니다** — 최상위 34건의 실측 분포: `developer` 17 / `project-planner` 8 / `planner` 5 / `developer (TBD)` 2 / `사용자 본인 / planner` 1 / `developer (다음 진입자)` 1. CLI `--owner-map`(라벨→이메일 수동 매핑 테이블)으로만 배정하고, **매핑 불가 항목은 assignee NULL(unassigned)로 적재 후 사람이 배정한다**(로드맵 §7.3(2)) |
| `priority:`(P1~P3, 15/34만 선언) | `task.priority` | 선언된 것만. "미선언은 null로 두고 추정하지 않는다"(로드맵 §7.3(2)) |
| `spec_impact:`(Gate C — 완료 plan) | `task.spec_impact` jsonb | 스펙 경로 목록 → 매니페스트로 스펙 UUID 변환, sentinel(`none`/`없음`/`n/a`/`na` — Gate C 어휘 4종) → `{"none": true}`(데이터 모델 §2.4). 경로 해소 실패는 수동 확인 큐 |
| plan 본문 체크박스 | Task 체크리스트(본문 유지) | 하위 Task 분해는 임포트 옵션(`--split-checkboxes`, 기본 off — 로드맵 "분해 기준은 임포트 옵션"). 기본값에서 본문은 `task.body_md`에 바이트 보존 |
| 본문 | `task.title` · `task.body_md` | title ← 첫 `# ` 헤딩(없으면 파일명), body ← frontmatter 제외 본문 원문 |

**소급 위조 금지** — 임포터는 `claim`·`agent_session` 행을 만들지 않는다. 둘은 실행의 기록이지 문서의 번역이 아니다. `worktree:` 값(살아있는 worktree 디렉토리명)은 매니페스트에 보존만 하고, 그 디렉터리가 현재 실존하지 않으면 리포트 warn으로 남긴다 — "머지된 값을 두면 가드가 '연결된 plan 없음'으로 오판해 무장 해제된다"던 스칼라 필드의 한계([1.1 분석](../01-problem/clemvion-analysis.md) §3.3)는 NERV에서 claim 테이블이 대체하며, 그 claim은 재착수 시점에 실제 세션이 만든다.

### 2.7 review 소급은 P2 — 경계만 명시

`review/` 13,777 md의 소급은 Phase 2다(로드맵 §3 "review P2" · §7.3(3)). MVP 임포터는 이 경로를 구현하지 않는다. P2 착수 시의 정본 규칙만 재인용해 둔다: 결론(SUMMARY·RESOLUTION)만 소급하고 `_prompts/`(리뷰 전체의 ~70%, 이미 gitignored)는 이관하지 않는다 · 커밋 SHA가 `meta.json`에 필드 자체가 없으므로(표본 200개 SUMMARY 중 47개만 산문에 해시 언급) NULL + `provenance_incomplete` 플래그를 세우고 게이트 판정 입력으로 쓰지 않는다 · 멱등 키는 `(source_path, content_hash)`다.

---

## 3. 실행 모델

### 3.1 CLI — `nerv import`

임포터는 CLI다. **dry-run이 기본**이고, DB에 쓰려면 `--apply`를 명시해야 한다.

```text
nerv import spec  --profile clemvion --root <clemvion 체크아웃 경로> --project <프로젝트 slug>
                  [--apply] [--map <매니페스트 경로>] [--report-dir <디렉터리>]
                  [--rewrite-links] [--as-user <이메일>]

nerv import plan  --profile clemvion --root <경로> --project <slug>
                  [--apply] [--map …] [--report-dir …] [--owner-map <owners.yaml>] [--split-checkboxes]

nerv import docs  --profile nerv-docs --root docs/ --project <slug> [--apply] …   # §5 도그푸딩

nerv import rebuild-map --profile <p> --root <경로> --project <slug> --map <출력 경로>
```

| 옵션 | 의미 | 기본값 |
| --- | --- | --- |
| `--apply` | 실제 적재. 없으면 dry-run — DB 쓰기 0, 리포트·매니페스트 초안만 산출 | off |
| `--map` | 멱등 매니페스트 파일(§3.3) | `./nerv-import.map.json` |
| `--report-dir` | 리포트 출력 위치(§4.1 — `report.md` + `report.jsonl`) | `./nerv-import-report/` |
| `--owner-map` | plan `owner:` 라벨 → 사용자 이메일 수동 매핑(yaml). 없으면 전건 unassigned | 없음 |
| `--as-user` | 적재 레코드의 `author_user_id`가 될 실행자 계정 | 필수 |
| `--rewrite-links` | 원문 버전 위에 링크 재작성 버전을 추가(§2.4) | off |
| `--split-checkboxes` | plan 체크박스를 하위 Task로 분해 | off |

종료 코드: `0` = 실패 0건 완료 · `1` = 완료했으나 실패·수동 확인 항목 존재(리포트 확인) · `2` = 중단(abort — §4.1).

### 3.2 실행 컨텍스트 — 같은 코드베이스, 도메인 서비스 직결

임포터는 별도 서비스가 아니라 API와 **같은 코드베이스의 CLI 엔트리**다(빌드·배치는 [4.2 코드베이스와 배포](codebase.md) 소관). REST·MCP·WS가 같은 도메인 서비스를 DI로 공유하는 것(D-05)과 같은 구조로, 임포터도 그 저장 계층을 주입받아 실행한다. 단 두 가지가 다르다:

1. **워크플로 전이 검사는 우회한다.** 소급 적재는 상태 전이가 아니라 초기 적재다 — `approved` 버전을 승인 절차 없이 만들고, `done` Task를 게이트 판정 없이 만든다. "모든 상태 전이는 Event를 남긴다"(데이터 모델 §5.5-6)와 충돌하지 않는다: 전이가 없으므로 전이 이벤트도 없다. 임포트 이후의 첫 편집부터는 정상 워크플로와 이벤트가 흐른다.
2. **무결성 제약은 그대로 받는다.** approved 본문 불변 트리거, `UNIQUE (project_id, ref)`, partial unique 등 스키마 제약([4.3 데이터베이스 스키마](database.md))은 임포터에게도 예외가 없다. 제약 위반은 그 파일 트랜잭션의 실패로 리포트에 남는다.

DB 접속은 서버와 같은 `DATABASE_URL`을 쓰며, 로컬 compose에서는 api 컨테이너 안에서, 운영 k8s에서는 일회성 Job으로 실행한다(배포 형태는 codebase.md 정본).

### 3.3 멱등 키와 매니페스트

멱등의 단위는 **(프로파일, 소스 경로, frontmatter id)** 다. 실행 결과는 매니페스트(JSON)에 기록되고, 재실행은 매니페스트를 먼저 읽는다.

| 매니페스트 필드 | 내용 |
| --- | --- |
| `profile` · `project` · `root_commit` | 프로파일, 대상 프로젝트, 스캔 시점 원본의 git HEAD SHA |
| `items[]` | 항목별: `source_path`, `kind`(spec/plan), 원본 frontmatter `id`, 생성된 `spec.id`/`task.id`(UUID), 최신 `spec_version.id`, `content_hash`, 추출된 `requirement.ref` → UUID 맵 |
| `unresolved` | 미해소 `pending_plans` 경로 목록(P1에서 해소), 해소 실패 링크 |
| `aliases` | 원본 경로·id → NERV UUID 별칭 표 — 이후 링크 재작성·plan `spec_impact` 경로 변환이 이 표를 쓴다 |

**서버가 진실이고 매니페스트는 캐시다.** 매니페스트를 잃어버려도 중복 적재로 이어지지 않는다 — `--apply` 시 임포터는 자연 키(`(project, spec.key)`, `(project_id, requirement.ref)`)로 서버를 먼저 조회하고, 매니페스트 없이 동일 키가 이미 존재하면 **중단**하며 `nerv import rebuild-map`을 안내한다. `rebuild-map`은 자연 키 대조로 매니페스트를 서버에서 재구성한다(Task는 자연 키가 없어 제목 매칭으로 후보를 제시하고, 모호 항목은 수동 확인 큐로).

### 3.4 재실행 규칙 — 변경분만

| 재실행 시점의 원본 상태 | 동작 |
| --- | --- |
| `content_hash` 동일(무변경) | **건드리지 않는다** — 신규 레코드 0(로드맵 0-7의 정의 그대로) |
| 본문 변경 | 그 스펙에 새 SpecVersion을 추가하고 `current_version_id` 갱신. 요구사항 표 델타는 `requirement_version.change_kind`(`added`/`modified`/`removed`/`unchanged`)로 기록 |
| 파일 이동(경로 변경, id 동일) | 매니페스트의 id 매칭으로 같은 Spec으로 인식, `source_path`만 갱신(트리 위치 변경은 수동 확인 큐 — 부모 추정 금지) |
| 파일 삭제 | Spec을 삭제하지 않는다 — 리포트에 "원본 소멸" 표기만. 아카이브 여부는 사람이 결정 |
| plan `in-progress/` → `complete/` 이동 | 같은 Task의 `status`를 `done`으로 갱신(basename 동일 + 매니페스트 매칭) |

### 3.5 트랜잭션 단위와 실행 패스

```mermaid
flowchart LR
  A["① 스캔<br/>글롭·제외·기대 집계 대조"] --> B["② 파싱<br/>frontmatter · 본문 · REQ 추출"]
  B --> C["③ 검증<br/>규칙 판정 · 리포트 행 축적"]
  C -->|"dry-run (기본)"| R1["리포트 + 매니페스트 초안<br/>DB 쓰기 0"]
  C -->|"--apply"| D["④ 구조 패스<br/>스펙 트리 upsert · 트랜잭션 1건"]
  D --> E["⑤ 문서 패스<br/>파일 1건 = 트랜잭션 1건"]
  E --> F["⑥ 링크 패스<br/>spec_relation · pending_plans 해소"]
  F --> R2["⑦ 리포트 + 매니페스트 확정"]
```

- **문서 패스의 트랜잭션 단위는 파일 1건**이다 — 한 spec 파일이 만드는 `spec_version` + `requirement` + `requirement_version` + `evidence` 행 전부가 한 트랜잭션이고, 실패하면 그 파일만 롤백하고 다음 파일을 계속한다(리포트 skip).
- 구조 패스(트리 노드 upsert)와 링크 패스는 각각 트랜잭션 1건이다. 링크 해소 실패는 트랜잭션을 깨지 않고 행 생성만 건너뛴다.
- 중단(abort) 발생 시 이미 커밋된 파일 트랜잭션은 남는다 — 멱등 재실행이 이어서 처리하는 것이 복구 절차다.

---

## 4. 실패 리포트와 수용 기준

### 4.1 리포트 형식

리포트는 두 판으로 나온다 — 사람용 `report.md`(분류별 표)와 기계용 `report.jsonl`(행 단위 JSON). 행 스키마:

```json
{"file": "spec/…​.md", "line": 12, "rule": "req-id-duplicate",
 "class": "manual", "detail": "…", "hint": "…"}
```

| 필드 | 의미 |
| --- | --- |
| `file` · `line` | 원본 파일 경로(루트 상대)와 줄 번호(파일 단위 문제는 line null) |
| `rule` | 규칙 슬러그(아래 표) |
| `class` | **`abort`(중단)** / **`skip`(건너뜀)** / **`manual`(수동 확인)** / **`warn`(경고)** 4분류. abort는 실행 전체를 멈추고, skip은 그 항목만 제외하고 계속하며, manual은 적재는 하되 사람 확정이 필요한 큐, warn은 정보성이다 |
| `detail` · `hint` | 사유와 권장 조치 |

규칙 전표:

| 규칙 슬러그 | class | 조건 |
| --- | --- | --- |
| `count-mismatch` | abort | 적재 대상 총수 ≠ 기대치 135(§2.1) |
| `map-conflict` | abort | 매니페스트 없이 서버에 동일 자연 키 실존(§3.3) |
| `id-collision` | abort | 같은 프로젝트에서 frontmatter `id` 충돌(§2.2) |
| `dist-mismatch` | warn | status 분포 ≠ 117/17/1 |
| `frontmatter-missing` / `frontmatter-unparsable` | skip | 제외 글롭 밖 파일에 선두 frontmatter 블록이 없거나 YAML 파싱 실패 |
| `status-unknown` | skip | 5값(`backlog`/`spec-only`/`partial`/`implemented`/`archived`) 외의 값 |
| `impl-status-doc-copied` | manual | `partial` 문서 유래 Requirement 전건 — 문서 status 복사값의 요구사항 단위 확정 필요(§2.3) |
| `req-id-duplicate` | manual | `UNIQUE (project_id, ref)` 충돌 — 첫 정의만 적재(§2.5) |
| `req-priority-missing` | manual | 우선순위 미표기 — NULL 적재(§2.5) |
| `req-ears-nonconforming` | manual | EARS 정규화 후보 — 자동 변환 금지(§2.5) |
| `adr-candidate` | manual | Rationale 단독 결정 문서(§2.2) |
| `link-unresolved` | manual | 상대링크 해소 실패(§2.4) |
| `code-glob-no-match` | manual | `code:` glob 실존 검사 미매치 — `evidence.stale=true`(§2.3) |
| `pending-plan-unresolved` | manual | `pending_plans` 경로가 아직 Task로 해소되지 않음(P0에서는 전건 발생, P1에서 해소) |
| `owner-unmapped` | manual | `--owner-map`에 없는 owner 라벨 — assignee NULL 적재(§2.6) |
| `worktree-dead` | warn | plan `worktree:` 디렉터리가 현재 실존하지 않음(§2.6) |
| `source-deleted` | warn | 재실행 시 원본 파일 소멸(§3.4) |
| `research-doc` | warn | `plan/research/` — Task 미생성, 참고 문서 분류(§2.6) |
| `title-missing` | warn | 첫 `# ` 헤딩 없음 — 파일명으로 대체(§2.2) |

이 슬러그들은 임포터 리포트 어휘이며, REST의 `NERV_*` 에러 코드 체계([4.4 API 명세](api.md) 정본)와는 다른 층이다 — 리포트는 실행 산출물이지 API 응답이 아니다.

### 4.2 수용 기준 (REQ-IMP-*)

행동 요구는 EARS로 쓴다. 검증 방법이 명시되지 않은 항목은 통합 테스트가 clemvion 체크아웃 사본(또는 §5의 docs/ 트리)을 입력으로 실행해 확인한다.

| ID | 수용 기준 (EARS) |
| --- | --- |
| **REQ-IMP-001** | WHEN clemvion 프로파일의 spec 임포트가 완료되면, THE SYSTEM SHALL 스캔한 384 md 각각을 적재·제외(카탈로그 249)·실패·수동 확인 중 정확히 하나로 분류해 리포트에 남기고, 적재+실패+수동 확인의 합을 135로 계정한다 |
| **REQ-IMP-002** | WHEN spec md 1건이 적재되면, THE SYSTEM SHALL frontmatter 블록을 제외한 본문을 바이트 동일하게 `spec_version.body_md`에 저장하고 `content_hash = sha256(body_md)`를 만족시킨다 |
| **REQ-IMP-003** | WHEN 파서가 spec 스캔을 마치면, THE SYSTEM SHALL 문서 선두 frontmatter 블록만 집계해 기대 총수 135와 대조하고, 불일치 시 적재를 중단(abort)한다. 분포(117/17/1) 불일치는 경고로 남긴다 |
| **REQ-IMP-004** | WHEN 동일 입력으로 임포터를 연속 2회 실행하면, THE SYSTEM SHALL 두 번째 실행에서 신규 레코드를 0건 생성한다(로드맵 Phase 0 종료 조건 0-7과 동일 문구) |
| **REQ-IMP-005** | WHEN 재실행 시점에 원본 파일의 content_hash가 매니페스트 기록과 다르면, THE SYSTEM SHALL 해당 스펙에만 새 SpecVersion을 추가하고 무변경 파일의 기존 레코드를 수정하지 않는다 |
| **REQ-IMP-006** | WHEN `--apply` 없이 실행되면, THE SYSTEM SHALL DB 쓰기 0건으로 리포트와 매니페스트 초안만 산출한다 |
| **REQ-IMP-007** | WHEN 항목 1건이 자동 변환에 실패하면, THE SYSTEM SHALL 파일·줄·규칙·분류(abort/skip/manual/warn)를 리포트에 남기고, skip이면 다음 항목 처리를 계속한다 |
| **REQ-IMP-008** | WHEN plan의 `owner:` 라벨이 `--owner-map`에 없으면, THE SYSTEM SHALL `assignee_user_id`를 NULL로 적재하고 추정 배정하지 않는다 |
| **REQ-IMP-009** | WHEN 과거 plan을 Task로 적재하면, THE SYSTEM SHALL `claim`·`agent_session` 레코드를 생성하지 않고 `ready` 상태로 적재하지 않는다 |
| **REQ-IMP-010** | WHEN nerv-docs 프로파일로 `docs/`를 임포트하면, THE SYSTEM SHALL 4부 8편을 frontmatter `status: draft` 그대로 draft SpecVersion으로 적재하고, 본문에 정의된 `REQ-*` ID를 requirement로 추출한다 |

### 4.3 Phase 0 종료 조건과의 관계

로드맵 §2.4의 종료 조건 두 개가 이 임포터를 직접 측정한다 — **0-6** "`spec/` frontmatter 추적 대상 135개 문서 변환 — ≥ 95% 자동 변환, 실패 항목 전건 목록화", **0-7** "임포터 2회 연속 실행 — 두 번째 실행의 신규 생성 레코드 0". 관계를 명확히 하면: Phase 0 게이트는 **자동 변환 ≥95%** 로 통과하고, 나머지(≤5%의 실패·수동 확인 항목)는 리포트 큐를 사람이 처리해 최종적으로 **135 전수 적재**(REQ-IMP-001의 계정 완결)에 도달한다. 즉 0-6은 착수 게이트, REQ-IMP-001은 완료 정의다 — 둘은 모순이 아니라 시점이 다르다.

---

## 5. 도그푸딩 — 이 문서 세트가 첫 임포트 대상이다

### 5.1 nerv-docs 프로파일

NERV의 제안서·MVP 문서(`docs/`)는 NERV가 가동되면 **첫 번째로 임포트될 스펙**이다. clemvion 프로파일과 같은 엔진에 매핑 표만 다른 `nerv-docs` 프로파일을 둔다:

| 항목 | 규칙 |
| --- | --- |
| 스캔 | `docs/**/*.md`(html 판은 파생본이므로 제외 — md가 관리 원본) |
| 트리 | 디렉터리 구조 그대로 — `01-problem/`·`02-research/`·`03-proposal/`·`04-mvp/` → `area` 노드 4개, `README.md` → `vision`, 각 문서 → `design` |
| frontmatter | 4부 공통 규격 `id`(`SPC-MVP-<SLUG>`) / `status` / `updated` — `id` → `spec.key`, `status: draft` → `spec_version.status='draft'`, `updated` → 매니페스트 보존(서버 시각을 위조하지 않는다) |
| frontmatter 없는 기존 13편 | `frontmatter-missing`을 skip이 아니라 **warn**으로 낮추고 문서 버전 줄(`문서 버전 v0.1 · …`)에서 메타를 읽는 보조 규칙 적용, `status`는 `approved`(합의 완료된 제안서) |
| 요구사항 | §2.5와 같은 휴리스틱 — `REQ-CB-###`·`REQ-DB-###`·`REQ-API-###`·`REQ-WEB-###`·`REQ-PLG-###`·`REQ-IMP-###`가 전부 `[A-Z]+-[A-Z]+-\d+`에 매칭된다. 이 문서의 REQ-IMP-001~010도 자기 자신에 의해 추출된다 |
| 상호 링크 | 상대링크 → `spec_relation(kind='references')` — 아직 없는 형제 문서 링크는 `link-unresolved`로 리포트에 남고, 문서 세트가 완성되면 재실행이 해소한다 |
| backlog | [4.8 백로그](backlog.md)의 스토리(`E01-S01` 형식)는 Task 적재 후보다 — 스토리 블록 파싱 규칙은 백로그 문서의 형식 정의를 따르고, P1 plan 임포터와 같은 경로로 적재한다 |

### 5.2 frontmatter가 이 규격인 이유

4부 문서 머리의 `id: SPC-MVP-<SLUG>` / `status: draft` / `updated:` 세 필드는 장식이 아니라 **임포터 입력 규격**이다. clemvion frontmatter(`id`/`status`/`code`/`pending_plans`)가 그 하네스의 기계 강제 대상이었듯, 이 문서 세트의 frontmatter는 nerv-docs 프로파일의 파싱 대상이다. 문서를 쓰는 순간 임포트 가능성이 확보되고, 임포트 후에는 이 문서들의 개정이 NERV의 정상 워크플로(draft → in_review → approved)를 타게 된다 — 스펙 플랫폼의 스펙이 스펙 플랫폼 안에서 관리되는 상태가 도그푸딩의 완성이다.

### 5.3 매니페스트 실물 예시 (nerv-docs)

```json
{
  "profile": "nerv-docs",
  "project": "nerv",
  "root_commit": "<git HEAD sha>",
  "items": [
    {
      "source_path": "docs/04-mvp/importer.md",
      "kind": "spec",
      "source_id": "SPC-MVP-IMPORTER",
      "spec_id": "<서버 발급 UUID>",
      "spec_version_id": "<UUID>",
      "content_hash": "sha256:<본문 해시>",
      "requirements": { "REQ-IMP-001": "<UUID>", "REQ-IMP-010": "<UUID>" }
    }
  ],
  "unresolved": { "links": [], "pending_plans": [] },
  "aliases": { "docs/04-mvp/importer.md": "<spec UUID>" }
}
```

---

## 참고 자료

이 문서는 clemvion 저장소를 직접 조사하지 않았다 — 모든 실측 수치·규약 인용은 [1.1 clemvion 하네스 분석](../01-problem/clemvion-analysis.md)의 2026-08-13 READ-ONLY 실측(135 분포는 2026-08-14 재검증)과 [3.7 로드맵](../03-proposal/roadmap.md) §7의 재인용이다. 외부 URL 인용은 없다.

### 정본 (이 문서가 인용만 하는 것)

- [3.3 데이터 모델](../03-proposal/data-model.md) §3 — clemvion frontmatter → NERV 필드 매핑의 의미 정본. §3.1 spec, §3.2 plan, §3.3 review. 엔티티 29종 필드 정의(§2)와 ID 전략(§5.1)
- [3.7 로드맵](../03-proposal/roadmap.md) §7 — 이관 대상 실측(§7.1), 임포트/컷오버 구분과 M1~M4(§7.2), 임포터 상세(§7.3), 병행 운영·컷오버 체크리스트(§7.4~7.5), Phase 0 종료 조건 0-6·0-7(§2.4)
- [1.2 문제 정의와 요구사항](../01-problem/pain-points.md) — FR-17(임포터), FR-03(Requirement 2축), FR-05(위임 명세 4요소와 ready), FR-13(관계 기반 커버리지)
- [3.5 스펙 워크플로우와 거버넌스](../03-proposal/spec-workflow.md) — 임포트 이후 문서가 타게 되는 상태 머신·게이트의 정본

### clemvion 실측 근거 (1.1 분석의 재인용)

- `clemvion:spec/` 384 md·9.3MB, 순수 스펙 135 md·49,383줄, status 분포 117/17/1, Rationale 105개, 최대 문서 1,750줄 × 2 — §1.1·§2.1
- `clemvion:spec/conventions/spec-impl-evidence.md` — frontmatter 스키마(`id`/`status`/`code`/`pending_plans`/`user_guide`), 5값 라이프사이클, 본문 예시 frontmatter가 grep 집계를 부풀리는 함정(5회), 자기 인정 약점 R-1·R-10 — §2.1·§2.3
- `clemvion:spec/conventions/swagger.md` — 본문 예시 frontmatter 2회(같은 함정) — §2.1
- `clemvion:spec/2-navigation/_product-overview.md` 외 — 요구사항 ID(`NAV-WF-01`·`ED-CV-01`·`ND-AG-24`·`CCH-SE-02`) 표기와 ✅ 마크 131개 vs 상태 컬럼 부재 — §2.5
- `clemvion:.claude/docs/plan-lifecycle.md` — plan 필수 3필드(`worktree`/`started`/`owner`), sentinel `(unstarted)`, Gate C `spec_impact`와 sentinel 어휘(`none`/`없음`/`n/a`/`na`), 종료값 4종 — §2.6
- `clemvion:plan/in-progress/` — owner 자유 텍스트 분포(최상위 34건: developer 17 / project-planner 8 / planner 5 / developer (TBD) 2 / 사용자 본인 / planner 1 / developer (다음 진입자) 1), 미착수 13/34, priority 15/34 — §2.6
- `clemvion:plan/in-progress/retry-turn-terminal-guard.md` — worktree 스칼라 필드의 무장 해제 사고 — §2.6
- `clemvion:review/**` — 13,777 md·131MB, `_prompts/` ~70%, `meta.json`의 커밋 필드 부재(표본 200개 중 47개만 산문 해시) — §2.7

### 4부 형제 문서

- [4.1 MVP 범위와 스택 확정](scope.md) — 이 임포터가 속한 MVP 범위(FR-17 P0·P1 배정)
- [4.2 코드베이스와 배포](codebase.md) — CLI 엔트리의 모노레포 배치·빌드·실행 형태
- [4.3 데이터베이스 스키마](database.md) — 임포터가 그대로 받는 DDL 제약(트리거·유니크)과 개발 시드
- [4.4 API 명세](api.md) — `NERV_*` 에러 코드 체계(리포트 어휘와 다른 층임을 §4.1이 명시)
- [4.8 백로그](backlog.md) — 임포터 스토리 분해와 E2E 수용 시나리오(135 md 전수), 스토리 자체가 임포트 대상(§5.1)
