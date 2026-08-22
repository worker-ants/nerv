---
id: SPC-MVP-DATABASE
status: draft
updated: 2026-08-22
---
# 데이터베이스 스키마

> **요약** — [3.3 데이터 모델](../03-proposal/data-model.md)이 정의한 29개 엔티티를 Postgres DDL 전문으로 옮긴다. 의미(필드가 왜 존재하는가)의 정본은 data-model.md이고, 이 문서는 그 **DDL 표현의 정본**이다 — 테이블·컬럼 이름은 1:1이며, 여기서 다르게 쓰인 이름은 결함이다. 본문은 enum 38종 → 29개 `CREATE TABLE`(FK·CHECK·partial unique 포함) → 인덱스 → 트리거(approved 본문 불변·updated_at) → `event`·`activity` 월 파티션 순서의 실행 가능한 DDL, `nerv_events` 이벤트 방송 규약(Valkey pub/sub), 예시 데이터 한 벌의 개발 시드, 그리고 마이그레이션 왕복·무결성 테스트의 수용 기준(REQ-DB-*)으로 구성된다. 목표는 하나다 — 이 문서의 SQL을 그대로 실행하면 MVP 스키마가 선다.
>
> 문서 버전 v0.4 · 2026-08-22 · HTML 판: [database.html](../html/database.html)
>
> v0.4 변경(2026-08-22 — 하이브리드 검색 MVP 확정, [4.1 MVP 범위와 스택 확정](scope.md) §2.1): ① 확장 2종 추가 — `pg_trgm`(한국어·부분 일치)·`vector`(pgvector) ② **검색 인덱스 테이블 `spec_chunk_embedding` 신설**(§2.15) — 도메인 엔티티가 아니라 재생성 가능한 파생 데이터라 **엔티티 29종 카운트에 들지 않는다** ③ trigram GIN 인덱스·HNSW 인덱스·검색 랭킹 규정(§2.12a) ④ REQ-DB-014~017. 검색 파이프라인 정본은 [4.4 API 명세](api.md) §2.2b.

---

## 1. 원칙

### 1.1 정본 관계 — 의미는 data-model, 표현은 이 문서

| 무엇 | 정본 | 이 문서의 역할 |
| --- | --- | --- |
| 엔티티 29종 필드의 **의미**·상태 머신·관계 | [3.3 데이터 모델](../03-proposal/data-model.md) | 재서술하지 않는다. 각 절에 원문 § 링크만 남긴다 |
| 테이블·컬럼·타입·제약의 **DDL 표현** | **이 문서** | §2 전문. 컬럼명은 data-model 필드 표와 1:1 — 예: `review_session`은 `head_sha`/`base_sha`, `spec_version`은 `edit_lease_user_id`/`edit_lease_session_id`/`edit_lease_expires_at` 3필드와 `author_session_id` |
| 이벤트 이름(`<리소스>.<동사>`) | [3.5 스펙 워크플로우](../03-proposal/spec-workflow.md) §6 | `event.type` 값으로 인용만 한다(`spec.approved` · `task.claimed` · `session.stale` …) |
| `nerv_*` 도구가 읽고 쓰는 계약 | [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) §2 | DDL 주석에서 도구 이름을 인용만 한다 |
| REST·WS가 반환하는 필드 | [4.4 API 명세](api.md) | api.md가 이 문서의 컬럼명을 그대로 쓴다(교차 정합 규칙) |

두 가지 예외만 이 문서가 추가한다. 어느 쪽도 data-model 필드의 이름·의미를 바꾸지 않는다.

1. **`claim.project_id`** — data-model §2.4 필드 표에는 없지만, §1.1 규칙 1("모든 도메인 테이블은 `project_id`를 갖는다")과 §5.5 규칙 8, 그리고 spec-workflow §4.4 클레임 의사코드(`WHERE c.project_id = task.project_id`)가 요구한다. 겹침 검사가 `task` 조인 없이 프로젝트 범위의 활성 클레임을 훑어야 하기 때문이다.
2. **junction 테이블의 `project_id` 생략** — `requirement_version` · `task_dependency` · `finding_occurrence` · `reviewer_report` · `resolution` · `spec_baseline_item`은 data-model 필드 표 그대로 부모 FK를 통해 프로젝트가 결정되므로 `project_id`를 갖지 않는다(규칙 8의 문서화된 예외).

### 1.2 마이그레이션 전략 — drizzle-kit, 0001 스냅샷

스키마는 `packages/schema`에 TypeScript(Drizzle)로 선언하고 drizzle-kit이 SQL 마이그레이션을 생성한다(확정 스택 — [4.1 MVP 범위와 스택 확정](scope.md), 모노레포 배치는 [4.2 코드베이스와 배포](codebase.md)).

| 규칙 | 내용 |
| --- | --- |
| **0001 스냅샷** | 첫 마이그레이션 `0001_init.sql` = 이 문서 §2~§3의 DDL 전문. drizzle-kit `generate`가 만든 테이블 DDL에, drizzle가 표현하지 못하는 것(트리거·plpgsql 함수·표현식 unique·파티션 함수)을 raw SQL로 동봉한다 |
| **스냅샷 불변** | 적용된 마이그레이션 파일은 수정하지 않는다. 이후 변경은 항상 새 `NNNN_*.sql` — approved SpecVersion을 고치지 않고 새 버전을 만드는 것과 같은 원리다 |
| **실행 시점** | 로컬 compose는 기동 시 1회, 운영 k8s는 배포 파이프라인의 마이그레이션 Job([4.2 코드베이스와 배포](codebase.md)) |
| **왕복 멱등** | 적용 이력 테이블(drizzle 기본) 기준으로 이미 적용된 파일은 건너뛴다 — 같은 명령을 두 번 실행해도 변경 0건(REQ-DB-001) |
| **드리프트 금지** | 운영 DB에 손으로 DDL을 치지 않는다. `drizzle-kit check`가 TS 선언과 마이그레이션 파일의 불일치를 CI에서 잡는다 |
| **expand-contract** | 하위호환(additive) 변경 우선 — 롤링 배포 중 구버전 파드가 새 스키마 위에서 잠시 돌 수 있어야 한다([4.2 코드베이스와 배포](codebase.md) 배포 절차와 한 몸). 컬럼 삭제·rename 같은 파괴적 변경은 2회 릴리스(확장 → 수축)로 나눈다 |

### 1.3 전역 규약

- **타입 표기는 Postgres**(`uuid` · `text` · `timestamptz` · `jsonb` · `text[]` · `bytea` · `citext`). 확장 `citext`(user.email), `pgcrypto`(시드의 sha256 계산)를 사용한다.
- **모든 테이블은 별도 표기가 없으면** `id uuid PRIMARY KEY`(서버 발급 UUIDv7, 클라이언트 발급 금지 — data-model §5.1)와 `created_at timestamptz NOT NULL DEFAULT now()`를 갖는다. `id`에 DB DEFAULT를 두지 않는 것은 의도다 — 발급 주체는 앱 계층 하나뿐이어야 한다.
- **예외**: `requirement_version`·`task_dependency`는 복합 PK, `event`는 `PRIMARY KEY (id, occurred_at)`(월 파티션 키 포함, `created_at` 없음 — `occurred_at`이 그 역할), `activity`는 `PRIMARY KEY (id, created_at)`(같은 이유).
- **삭제는 아카이브**(`archived_at` 류)가 원칙이므로 모든 FK는 `ON DELETE` 기본(NO ACTION)이다. CASCADE는 한 곳도 없다.
- **이름 규약**: 테이블은 snake_case 단수(data-model 표기 그대로, `user`는 예약어라 `"user"`로 인용), enum 타입은 `<의미>_<축>`(예: `spec_version_status`), 제약은 `<테이블>_<의미>_uq/ck/fk`.
- **enum 값 문자열은 data-model 필드 표와 문자 단위로 일치**한다 — `claude-code`처럼 하이픈이 든 값도 그대로 enum 라벨이다.

---

## 2. 전체 DDL

서술 순서는 data-model §2의 그룹 순서를 따른다: §2.1 확장·enum → §2.2~§2.10 테이블 29종 → §2.11 순환 FK → §2.12 인덱스 → §2.13 함수·트리거 → §2.14 파티션(이벤트 방송 규약은 §3). 실행 순서도 이와 같되 한 가지 예외가 있다 — `agent_session`(§2.6)은 `spec_version`·`task`·`claim`·`change_request`가 FK로 참조하므로 0001에서는 테넌시(§2.2) 직후로 전진 배치한다. 순서만 다르고 내용은 동일하다.

### 2.1 확장과 enum 38종

```sql
-- 0001_init.sql · §1 — 확장
CREATE EXTENSION IF NOT EXISTS citext;    -- user.email 대소문자 무시 유니크
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- 시드·테스트의 digest(sha256)
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- 한국어·부분 문자열 검색(trigram — 4.4 §2.2b). 표준 contrib
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector — 임베딩 HNSW (§2.15). 이미지 요건: 4.2 §5.3

-- enum — 값 문자열은 data-model.md §2 필드 표와 1:1
CREATE TYPE user_state              AS ENUM ('invited', 'active', 'disabled');
CREATE TYPE member_role             AS ENUM ('admin', 'planner', 'designer', 'developer', 'qa', 'viewer');
CREATE TYPE spec_type               AS ENUM ('vision', 'area', 'feature', 'design', 'convention', 'adr');
CREATE TYPE spec_version_status     AS ENUM ('draft', 'in_review', 'approved', 'superseded', 'deprecated');
CREATE TYPE requirement_priority    AS ENUM ('must', 'should', 'could');
CREATE TYPE impl_status             AS ENUM ('unimplemented', 'in_progress', 'implemented', 'verified');
CREATE TYPE change_kind             AS ENUM ('added', 'modified', 'removed', 'unchanged');
CREATE TYPE spec_relation_kind      AS ENUM ('references', 'refines', 'depends_on', 'duplicates', 'supersedes');
CREATE TYPE comment_status          AS ENUM ('open', 'resolved');
CREATE TYPE change_request_status   AS ENUM ('open', 'in_review', 'approved', 'rejected', 'withdrawn');
CREATE TYPE change_risk             AS ENUM ('low', 'normal', 'high');
CREATE TYPE change_origin           AS ENUM ('human', 'agent', 'spec_drift');
CREATE TYPE task_status             AS ENUM ('backlog', 'ready', 'claimed', 'in_progress', 'in_review', 'done', 'blocked');
CREATE TYPE task_priority           AS ENUM ('P0', 'P1', 'P2', 'P3');
CREATE TYPE dependency_kind         AS ENUM ('blocks', 'relates');
CREATE TYPE claim_status            AS ENUM ('active', 'released', 'expired', 'revoked');
CREATE TYPE claim_release_reason    AS ENUM ('done', 'manual', 'expired', 'conflict');
CREATE TYPE agent_type              AS ENUM ('claude-code', 'codex', 'web', 'other');
CREATE TYPE session_state           AS ENUM ('pending', 'active', 'awaiting_input', 'complete', 'error', 'stale');
CREATE TYPE session_end_reason      AS ENUM ('complete', 'error', 'stopped', 'stale');
CREATE TYPE activity_type           AS ENUM ('thought', 'action', 'elicitation', 'response', 'error');
CREATE TYPE review_kind             AS ENUM ('code', 'consistency', 'spec_coverage', 'merge');
CREATE TYPE review_trigger          AS ENUM ('auto', 'manual', 'gate');
CREATE TYPE review_state            AS ENUM ('running', 'complete', 'failed');
CREATE TYPE review_risk             AS ENUM ('none', 'low', 'medium', 'high', 'critical');
CREATE TYPE finding_severity        AS ENUM ('critical', 'warning', 'info');
CREATE TYPE finding_status          AS ENUM ('open', 'fixed', 'dismissed', 'wont_fix');
CREATE TYPE resolution_kind         AS ENUM ('fixed', 'deferred', 'dismissed', 'escalated', 'spec_change');
CREATE TYPE escalate_reason         AS ENUM ('no', 'spec', 'user-decision', 'infra', 'e2e-fail-3x', 'sensitive-fix');
CREATE TYPE approval_subject_type   AS ENUM ('spec_version', 'change_request', 'plan', 'question', 'gate_bypass');
CREATE TYPE approval_decision       AS ENUM ('approve', 'reject', 'comment');
CREATE TYPE question_urgency        AS ENUM ('blocking', 'normal');
CREATE TYPE question_status         AS ENUM ('open', 'answered', 'cancelled', 'expired');
CREATE TYPE evidence_kind           AS ENUM ('code_path', 'test', 'pr', 'commit', 'review', 'user_guide');
CREATE TYPE evidence_source         AS ENUM ('agent', 'human', 'ci');
CREATE TYPE notification_importance AS ENUM ('immediate', 'digest');
CREATE TYPE notification_channel    AS ENUM ('inapp', 'slack', 'email');
CREATE TYPE notification_state      AS ENUM ('unread', 'read', 'archived');
```

`event.type`은 enum이 아니라 `text`다 — 이벤트 어휘(`<리소스>.<동사>`)는 열려 있고 정본은 spec-workflow §6이다. `escalate_reason`의 하이픈 값(`user-decision` · `e2e-fail-3x` · `sensitive-fix`)은 clemvion에서 5개월 검증된 ESCALATE 어휘 그대로다(data-model §2.6).

### 2.2 테넌시 — organization · user · project · membership · api_token

근거: data-model §2.1.

```sql
CREATE TABLE organization (
  id         uuid PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  settings   jsonb NOT NULL DEFAULT '{}',   -- 기본 게이트 정책·보존 기간(프로젝트가 덮어쓴다)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "user" (                        -- 예약어라 항상 따옴표. 사람 계정만(D-08)
  id           uuid PRIMARY KEY,
  email        citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url   text,
  state        user_state NOT NULL DEFAULT 'invited',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project (
  id             uuid PRIMARY KEY,           -- 전 도메인 테이블의 파티션 키
  org_id         uuid NOT NULL REFERENCES organization(id),
  slug           text NOT NULL,              -- URL·MCP project 인자용 식별자(소문자 kebab) — data-model §2.1
  key            text NOT NULL,              -- 사람이 읽는 짧은 키. 표시 ID 접두사
  name           text NOT NULL,
  description    text,
  repo_url       text,
  default_branch text,
  gate_policy    jsonb NOT NULL DEFAULT '{}', -- 위험도별 게이트 임계(D-06), fail-open 격상 임계(D-14)
  retention      jsonb NOT NULL DEFAULT '{}', -- Activity·프롬프트 보존 기간(data-model §5.4)
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_org_key_uq UNIQUE (org_id, key),
  CONSTRAINT project_org_slug_uq UNIQUE (org_id, slug)
);

CREATE TABLE membership (
  id         uuid PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organization(id),
  project_id uuid REFERENCES project(id),   -- NULL = 조직 전역 역할
  user_id    uuid NOT NULL REFERENCES "user"(id),
  role       member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 중복 배정 차단은 표현식 unique — §2.12 membership_user_scope_uq

CREATE TABLE api_token (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES project(id),  -- 토큰은 항상 프로젝트 스코프
  user_id      uuid NOT NULL REFERENCES "user"(id),   -- 위임자. 권한은 이 사용자의 부분집합
  name         text NOT NULL,                          -- 예: "노트북 Claude Code"
  token_hash   bytea NOT NULL UNIQUE,                  -- 원문 미저장
  prefix       text NOT NULL,                          -- 앞 8자(식별·감사용)
  scopes       text[] NOT NULL DEFAULT '{}',           -- 'spec:read' 'spec:write' 'task:claim' …
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

### 2.3 스펙 — spec · spec_version · requirement · requirement_version · spec_relation · spec_comment · spec_baseline

근거: data-model §2.2. `spec_version.author_session_id`·`edit_lease_session_id` 등이 `agent_session`을 참조한다 — §2 첫머리의 전진 배치 예외가 여기서 필요해진다.

```sql
CREATE TABLE spec (
  id                 uuid PRIMARY KEY,       -- 안정 ID. 이동·개명해도 참조 불변(D-09)
  project_id         uuid NOT NULL REFERENCES project(id),
  parent_id          uuid REFERENCES spec(id),
  type               spec_type NOT NULL,
  key                text NOT NULL,          -- 사람이 읽는 slug(예: channel-web-chat). 참조 키 아님
  title              text NOT NULL,
  sort_key           text NOT NULL DEFAULT '', -- clemvion의 0-/1- 정수 접두 규약을 데이터로 흡수
  current_version_id uuid,                   -- FK는 §2.11(순환)
  owner_role         member_role,            -- 기본 리뷰어 자동 지정 힌트
  archived_at        timestamptz,            -- 삭제 대신 아카이브
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spec_version (                  -- 불변 스냅샷. 가변 구간은 draft뿐
  id                        uuid PRIMARY KEY,
  spec_id                   uuid NOT NULL REFERENCES spec(id),
  version_no                int  NOT NULL,
  status                    spec_version_status NOT NULL DEFAULT 'draft',
  body_md                   text NOT NULL,
  content_hash              bytea NOT NULL,  -- sha256(body_md). 무변경 저장 차단
  base_version_id           uuid REFERENCES spec_version(id), -- 낙관적 동시성. 불일치 = 409
  change_summary_md         text,
  author_user_id            uuid NOT NULL REFERENCES "user"(id),
  author_session_id         uuid REFERENCES agent_session(id), -- 에이전트 작성이면 세션(D-08 쌍 기록)
  change_request_id         uuid,            -- FK는 §2.11(순환)
  submitted_at              timestamptz,
  approved_at               timestamptz,
  approved_by_user_id       uuid REFERENCES "user"(id),
  superseded_by_version_id  uuid REFERENCES spec_version(id),
  edit_lease_user_id        uuid REFERENCES "user"(id),        -- 초안 편집 리스 보유자
  edit_lease_session_id     uuid REFERENCES agent_session(id), -- 보유 표면. NULL = 웹
  edit_lease_expires_at     timestamptz,                        -- TTL 30분(공용 상수)
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_version_no_uq UNIQUE (spec_id, version_no),
  CONSTRAINT spec_version_no_positive_ck CHECK (version_no >= 1),
  -- data-model §5.5 규칙 9: 편집 리스는 draft에서만 non-NULL
  CONSTRAINT spec_version_lease_draft_only_ck CHECK (
    status = 'draft'
    OR (edit_lease_user_id IS NULL AND edit_lease_session_id IS NULL
        AND edit_lease_expires_at IS NULL))
);

CREATE TABLE requirement (                   -- 구현 추적의 단위(D-03)
  id                       uuid PRIMARY KEY,
  project_id               uuid NOT NULL REFERENCES project(id),
  spec_id                  uuid NOT NULL REFERENCES spec(id),
  ref                      text NOT NULL,    -- 안정 표시 ID(예: REQ-CWC-031)
  statement_md             text NOT NULL,    -- EARS 권장
  acceptance_md            text,
  priority                 requirement_priority NOT NULL,
  impl_status              impl_status NOT NULL DEFAULT 'unimplemented',
  introduced_in_version_id uuid NOT NULL REFERENCES spec_version(id),
  current_version_id       uuid NOT NULL REFERENCES spec_version(id),
  removed_in_version_id    uuid REFERENCES spec_version(id),  -- 묘비. 이력은 지우지 않는다
  verified_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requirement_ref_uq UNIQUE (project_id, ref)
);

CREATE TABLE requirement_version (           -- 버전×요구사항 델타. CR 델타 뷰의 원천(FR-04)
  requirement_id  uuid NOT NULL REFERENCES requirement(id),
  spec_version_id uuid NOT NULL REFERENCES spec_version(id),
  change_kind     change_kind NOT NULL,
  statement_md    text NOT NULL,             -- 그 버전 시점의 스냅샷
  ordinal         int  NOT NULL,             -- 문서 내 표시 순서
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requirement_id, spec_version_id)
);

CREATE TABLE spec_relation (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES project(id),
  from_spec_id uuid NOT NULL REFERENCES spec(id),
  to_spec_id   uuid NOT NULL REFERENCES spec(id),
  kind         spec_relation_kind NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_relation_self_ck CHECK (from_spec_id <> to_spec_id),
  CONSTRAINT spec_relation_uq UNIQUE (from_spec_id, to_spec_id, kind)
);

CREATE TABLE spec_comment (                  -- 앵커 스레드 코멘트(FR-11). 편집·해소되는 협업 개체
  id                     uuid PRIMARY KEY,
  project_id             uuid NOT NULL REFERENCES project(id),
  spec_id                uuid NOT NULL REFERENCES spec(id),
  spec_version_id        uuid NOT NULL REFERENCES spec_version(id),
  anchor                 text NOT NULL,      -- 헤딩 slug 또는 requirement.ref(예: REQ-CWC-031)
  author_user_id         uuid NOT NULL REFERENCES "user"(id),
  author_session_id      uuid REFERENCES agent_session(id),
  body_md                text NOT NULL,
  status                 comment_status NOT NULL DEFAULT 'open',
  resolved_by_user_id    uuid REFERENCES "user"(id),
  resolved_in_version_id uuid REFERENCES spec_version(id), -- 어느 draft에서 반영됐나
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz
);

-- 베이스라인 — 프로젝트 단위 승인 스냅샷 세트(FR-02 확장, 2026-08-21 MVP 포함.
-- 규약 정본: spec-workflow §3.6). 생성 후 불변 — 항목 UPDATE/DELETE 경로를 만들지 않는다.
CREATE TABLE spec_baseline (
  id                 uuid PRIMARY KEY,
  project_id         uuid NOT NULL REFERENCES project(id),
  name               text NOT NULL,          -- 예: 'R1', '2026-09-릴리스'
  note_md            text,
  created_by_user_id uuid NOT NULL REFERENCES "user"(id),  -- 사람 전용 — 에이전트 생성 도구 없음
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_baseline_name_uq UNIQUE (project_id, name)
);

CREATE TABLE spec_baseline_item (            -- junction — project_id 생략 예외(§1.1)
  baseline_id     uuid NOT NULL REFERENCES spec_baseline(id),
  spec_id         uuid NOT NULL REFERENCES spec(id),
  spec_version_id uuid NOT NULL REFERENCES spec_version(id), -- approved만 — 생성 트랜잭션에서 검증(REQ-DB-008)
  PRIMARY KEY (baseline_id, spec_id)         -- 스펙당 1개 핀
);
```

### 2.4 변경 요청 — change_request

근거: data-model §2.3.

```sql
CREATE TABLE change_request (
  id                    uuid PRIMARY KEY,
  project_id            uuid NOT NULL REFERENCES project(id),
  spec_id               uuid NOT NULL REFERENCES spec(id),
  base_version_id       uuid NOT NULL REFERENCES spec_version(id), -- 어느 approved에 대한 변경인가
  proposed_version_id   uuid NOT NULL REFERENCES spec_version(id), -- 제안을 담은 draft
  title                 text NOT NULL,
  rationale_md          text,
  status                change_request_status NOT NULL DEFAULT 'open',
  risk                  change_risk NOT NULL DEFAULT 'normal',      -- 저위험 자동 통과(D-06)
  origin                change_origin NOT NULL DEFAULT 'human',     -- spec_drift = 역류 경로
  created_by_user_id    uuid NOT NULL REFERENCES "user"(id),
  created_by_session_id uuid REFERENCES agent_session(id),
  decided_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
```

### 2.5 작업 — task · task_dependency · claim

근거: data-model §2.4. `task`의 CHECK 3개는 data-model §5.5 규칙 3·4의 "CHECK 또는 전이 API 검증" 중 CHECK로 내릴 수 있는 부분을 내린 것이다 — 게이트 판정(해소된 리뷰 존재)은 질의가 필요하므로 API에 남는다.

```sql
CREATE TABLE task (
  id                     uuid PRIMARY KEY,
  project_id             uuid NOT NULL REFERENCES project(id),
  key                    text NOT NULL,      -- 표시 ID. 서버 발급(data-model §5.1)
  title                  text NOT NULL,
  body_md                text,
  status                 task_status NOT NULL DEFAULT 'backlog',
  priority               task_priority NOT NULL DEFAULT 'P2',
  source_spec_version_id uuid REFERENCES spec_version(id),  -- 기준 버전(agent-integration §2.4). NULL은 임포트 레거시 전용 — 신규 생성 표면(REST·MCP)의 zod는 필수
  source_requirement_id  uuid REFERENCES requirement(id),
  baseline_id            uuid REFERENCES spec_baseline(id), -- 기준 베이스라인(§2.3) — 주변 문서를 읽는 세트
  rebrief_required_at    timestamptz,        -- 기준 버전 superseded 시 서버 세팅, 재브리핑(기준 갱신) 시 해제 — spec-workflow §3.3
  assignee_user_id       uuid REFERENCES "user"(id),        -- 사람 책임자(D-08)
  delegate_session_id    uuid REFERENCES agent_session(id), -- 에이전트 수행 세션
  goal_md                text,               -- 위임 명세 ① 목표
  output_format_md       text,               -- 위임 명세 ② 산출물 형식
  tools_sources_md       text,               -- 위임 명세 ③ 도구·출처
  boundaries_md          text,               -- 위임 명세 ④ 경계
  spec_impact            jsonb,              -- done 전제조건: 영향 스펙 목록 또는 {"none": true}
  blocked_reason         text,               -- 어휘: awaiting_answer/dependency_broken/spec_conflict/external
  done_at                timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_key_uq UNIQUE (project_id, key),
  -- 규칙 3: backlog·blocked 밖으로 나가려면 위임 명세 4요소 전부 NOT NULL
  CONSTRAINT task_delegation_spec_ck CHECK (
    status IN ('backlog', 'blocked')
    OR (goal_md IS NOT NULL AND output_format_md IS NOT NULL
        AND tools_sources_md IS NOT NULL AND boundaries_md IS NOT NULL)),
  -- 규칙 4의 CHECK 절반: done이면 spec_impact 선언 필수(Gate C 이식)
  CONSTRAINT task_done_spec_impact_ck CHECK (status <> 'done' OR spec_impact IS NOT NULL),
  CONSTRAINT task_done_at_ck          CHECK (status <> 'done' OR done_at IS NOT NULL),
  -- 사유 없는 blocked는 백로그 부패의 씨앗(spec-workflow §1.4)
  CONSTRAINT task_blocked_reason_ck   CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);

CREATE TABLE task_dependency (
  task_id            uuid NOT NULL REFERENCES task(id),
  depends_on_task_id uuid NOT NULL REFERENCES task(id),
  kind               dependency_kind NOT NULL DEFAULT 'blocks', -- blocks만 ready 판정에 영향
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT task_dependency_self_ck CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE claim (                          -- D-04의 실체. nerv_task_claim이 쓰는 테이블
  id               uuid PRIMARY KEY,
  project_id       uuid NOT NULL REFERENCES project(id), -- §1.1 예외 1 — 겹침 검사의 스캔 축
  task_id          uuid NOT NULL REFERENCES task(id),
  agent_session_id uuid REFERENCES agent_session(id),    -- 사람이 직접 잡으면 NULL
  user_id          uuid NOT NULL REFERENCES "user"(id),  -- 책임자(세션 소유자)
  status           claim_status NOT NULL DEFAULT 'active',
  scope_spec_ids   uuid[]  NOT NULL DEFAULT '{}',        -- 이 작업이 건드릴 스펙
  scope_file_globs text[]  NOT NULL DEFAULT '{}',        -- 이 작업이 건드릴 파일
  acquired_at      timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,                 -- TTL 30분, 하트비트 60초로 연장
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  released_at      timestamptz,
  release_reason   claim_release_reason,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- "한 Task에 활성 클레임은 하나"는 §2.12의 partial unique — claim_task_active_uq
```

### 2.6 세션 — agent_session · activity

근거: data-model §2.5. `activity`는 월 파티션(§2.14)이므로 PK가 `(id, created_at)` 복합이다 — `event`가 `(id, occurred_at)`인 것과 같은 이유(파티션 키는 PK에 포함돼야 한다).

```sql
CREATE TABLE agent_session (
  id                  uuid PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES project(id),
  user_id             uuid NOT NULL REFERENCES "user"(id), -- 소유자(권한 상속 원천)
  agent_type          agent_type NOT NULL,
  agent_version       text,
  hostname            text NOT NULL,          -- 누구의 어느 머신인가 — P8의 핵심 필드
  cwd                 text,
  worktree_path       text,
  branch              text,
  external_session_id text,                   -- 하네스 발급 세션 ID(훅 페이로드 조인 키)
  state               session_state NOT NULL DEFAULT 'pending',
  model               text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at   timestamptz,
  ended_at            timestamptz,
  end_reason          session_end_reason,
  diff_added          int NOT NULL DEFAULT 0, -- 세션 카드의 +N −M
  diff_removed        int NOT NULL DEFAULT 0,
  token_usage         jsonb NOT NULL DEFAULT '{}',
  current_task_id     uuid,                   -- 조회 편의 비정규화(진실은 claim). FK는 §2.11
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity (                       -- 타입드 불변 로그. 편집 가능한 코멘트와 분리
  id         uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES agent_session(id),
  project_id uuid NOT NULL REFERENCES project(id),
  seq        bigint NOT NULL,                 -- 세션 내 단조 증가
  type       activity_type NOT NULL,
  title      text,
  body_md    text,
  tool_name  text,                            -- type='action'일 때 도구 이름
  payload    jsonb NOT NULL DEFAULT '{}',
  ephemeral  boolean NOT NULL DEFAULT false,  -- 다음 활동이 오면 UI에서 접힘
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

`UNIQUE (session_id, seq)`(data-model §2.5)는 파티션 테이블의 전역 unique로 선언할 수 없다(파티션 키가 포함돼야 하므로). 의미(세션 내 seq 유일)는 두 겹으로 지킨다 — ① 파티션마다 `(session_id, seq)` unique 인덱스를 생성하고(§2.14의 파티션 생성 함수가 자동으로 만든다), ② 월 경계를 넘는 재전송은 ingest 경로의 멱등 키(`nerv_session_event`의 `(session_id, event_seq)` — agent-integration §2)가 막는다.

### 2.7 리뷰 — review_session · reviewer_report · finding · finding_occurrence · resolution

근거: data-model §2.6. `head_sha`·`base_sha`·`branch`의 NOT NULL이 이 스키마에서 가장 값싼 개선이다 — clemvion `meta.json`에는 이 필드 자체가 없어 표본 SUMMARY 200개 중 47개만 산문에 해시를 남겼다(data-model §3.3).

```sql
CREATE TABLE review_session (
  id                  uuid PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES project(id),
  kind                review_kind NOT NULL,
  "trigger"           review_trigger NOT NULL,   -- 키워드 충돌 회피용 인용 — 컬럼명은 trigger
  agent_session_id    uuid REFERENCES agent_session(id),
  task_id             uuid REFERENCES task(id),
  branch              text NOT NULL,
  head_sha            text NOT NULL,             -- 필수 입력 스냅샷 — 검토한 커밋
  base_sha            text NOT NULL,             -- 필수 diff 기준 커밋
  changeset_hash      bytea NOT NULL,            -- 라운드 동일성 판정
  file_count          int NOT NULL DEFAULT 0,
  round_no            int NOT NULL DEFAULT 1,
  previous_session_id uuid REFERENCES review_session(id), -- 라운드 체인
  routing             jsonb NOT NULL DEFAULT '{}',
  forced_roles        text[] NOT NULL DEFAULT '{}',
  forced_coverage_ok  boolean NOT NULL DEFAULT false,
  state               review_state NOT NULL DEFAULT 'running',
  risk                review_risk,               -- 완료 시 산출, running 동안 NULL
  block               boolean NOT NULL DEFAULT false, -- consistency의 BLOCK: YES/NO 계승
  prompt_blob_uri     text,                      -- 재생성 가능 입력 → 오브젝트 스토리지
  prompt_expires_at   timestamptz,               -- TTL 30일(data-model §5.4)
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviewer_report (
  id                uuid PRIMARY KEY,
  review_session_id uuid NOT NULL REFERENCES review_session(id),
  role              text NOT NULL,               -- security·requirement·cross-spec 등 역할 키
  risk              review_risk NOT NULL,
  body_md           text,
  has_report        boolean NOT NULL DEFAULT true,  -- 커버리지 무결성 판정용 3필드
  forced            boolean NOT NULL DEFAULT false,
  recovered         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewer_report_role_uq UNIQUE (review_session_id, role)
);

CREATE TABLE finding (                        -- 라운드를 넘어 하나로 유지되는 지적
  id               uuid PRIMARY KEY,
  project_id       uuid NOT NULL REFERENCES project(id),
  fingerprint      bytea NOT NULL,            -- 라운드 불변 dedup 키(data-model §5.2)
  severity         finding_severity NOT NULL,
  tags             text[] NOT NULL DEFAULT '{}', -- 'spec_drift' 등
  category         text NOT NULL,
  title            text NOT NULL,
  detail_md        text,
  suggestion_md    text,
  file_path        text,
  line_start       int,
  symbol           text,
  spec_version_id  uuid REFERENCES spec_version(id), -- 출처: 어느 스펙 근거인가
  requirement_id   uuid REFERENCES requirement(id),
  status           finding_status NOT NULL DEFAULT 'open',
  first_session_id uuid NOT NULL REFERENCES review_session(id),
  last_session_id  uuid NOT NULL REFERENCES review_session(id),
  occurrence_count int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finding_fingerprint_uq UNIQUE (project_id, fingerprint)
);

CREATE TABLE finding_occurrence (             -- 어느 라운드에서 몇 번으로 보였는가(구 SUMMARY#n)
  id                 uuid PRIMARY KEY,
  finding_id         uuid NOT NULL REFERENCES finding(id),
  review_session_id  uuid NOT NULL REFERENCES review_session(id),
  reviewer_report_id uuid REFERENCES reviewer_report(id),
  round_no           int NOT NULL,
  display_no         int NOT NULL,
  raw_severity       finding_severity NOT NULL, -- 하향 모순 감사용 원값(24/732 실측)
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finding_occurrence_uq UNIQUE (finding_id, review_session_id)
);

CREATE TABLE resolution (
  id                uuid PRIMARY KEY,
  finding_id        uuid NOT NULL REFERENCES finding(id),
  kind              resolution_kind NOT NULL,
  commit_sha        text,
  change_request_id uuid REFERENCES change_request(id),
  escalate_reason   escalate_reason,
  rationale_md      text NOT NULL,             -- 유예 근거는 1급 데이터
  actor_user_id     uuid NOT NULL REFERENCES "user"(id),
  actor_session_id  uuid REFERENCES agent_session(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resolution_fixed_commit_ck    CHECK (kind <> 'fixed' OR commit_sha IS NOT NULL),
  CONSTRAINT resolution_spec_change_cr_ck  CHECK (kind <> 'spec_change' OR change_request_id IS NOT NULL)
);
```

### 2.8 사람 개입 — approval · question

근거: data-model §2.7. **지시자≠승인자(규칙 5)는 CHECK로 내리지 않는다** — spec-workflow §2.3의 소규모 완화(멤버 2인 미만이면 차단 대신 배너+감사 이벤트)가 있어 하드 제약이면 안 되고, 정본대로 "저장 시 검증 + 질의 필터"(앱 계층)로 강제한다.

```sql
CREATE TABLE approval (
  id                      uuid PRIMARY KEY,
  project_id              uuid NOT NULL REFERENCES project(id),
  subject_type            approval_subject_type NOT NULL,
  subject_id              uuid NOT NULL,       -- 다형 참조 — 물리 FK 없음(앱 검증)
  requested_by_user_id    uuid NOT NULL REFERENCES "user"(id),
  requested_by_session_id uuid REFERENCES agent_session(id),
  assignee_user_id        uuid REFERENCES "user"(id),
  assignee_role           member_role,         -- 역할 큐로 열어두는 경우
  decision                approval_decision,   -- NULL = 대기
  comment_md              text,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  due_at                  timestamptz,
  decided_at              timestamptz,
  is_bypass               boolean NOT NULL DEFAULT false, -- 게이트 면제도 결재 레코드(FR-10)
  bypass_reason           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_bypass_reason_ck CHECK (NOT is_bypass OR bypass_reason IS NOT NULL)
);

CREATE TABLE question (                        -- 세션은 awaiting_input으로 대기(P7의 핵심)
  id                  uuid PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES project(id),
  agent_session_id    uuid NOT NULL REFERENCES agent_session(id),
  task_id             uuid REFERENCES task(id),
  title               text NOT NULL,
  body_md             text,
  options             jsonb NOT NULL DEFAULT '[]', -- 선택지(있으면 원클릭 응답)
  urgency             question_urgency NOT NULL DEFAULT 'normal',
  status              question_status NOT NULL DEFAULT 'open',
  answer_key          text,
  answer_md           text,
  answered_by_user_id uuid REFERENCES "user"(id),
  asked_at            timestamptz NOT NULL DEFAULT now(),
  answered_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

### 2.9 증적 — evidence

근거: data-model §2.8.

```sql
CREATE TABLE evidence (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES project(id),
  requirement_id  uuid REFERENCES requirement(id),
  spec_version_id uuid REFERENCES spec_version(id),
  task_id         uuid REFERENCES task(id),
  kind            evidence_kind NOT NULL,
  locator         text NOT NULL,              -- 경로 glob·PR URL·커밋 SHA·테스트 이름
  repo            text,                       -- 멀티 저장소 대비
  source          evidence_source NOT NULL,
  verified_at     timestamptz,
  verified_by     uuid REFERENCES "user"(id),
  stale           boolean NOT NULL DEFAULT false, -- clemvion R-1(stale glob)의 교훈
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 셋 중 최소 1개 필수(data-model §2.8 CHECK)
  CONSTRAINT evidence_anchor_ck CHECK (
    requirement_id IS NOT NULL OR spec_version_id IS NOT NULL OR task_id IS NOT NULL)
);
```

### 2.10 이벤트·알림 — event · notification

근거: data-model §2.9. `event`는 append-only(D-10), 월 파티션. `notification.event_id`는 **논리 FK**다 — 파티션 부모의 유일 키가 `(id, occurred_at)` 복합이라 단일 컬럼 물리 FK를 걸 수 없고, notification 생성 경로가 워커 하나뿐이므로 무결성은 그 경로가 진다.

```sql
CREATE TABLE event (
  id               uuid NOT NULL,
  project_id       uuid NOT NULL REFERENCES project(id),
  occurred_at      timestamptz NOT NULL DEFAULT now(),  -- 파티션 키
  type             text NOT NULL,             -- 'spec.approved' 'task.claimed' 'session.stale' 'gate.failopen' …
  actor_user_id    uuid REFERENCES "user"(id),
  actor_session_id uuid REFERENCES agent_session(id),
  is_agent         boolean NOT NULL DEFAULT false, -- 감사에서 사람/에이전트 구분(FR-16)
  subject_type     text NOT NULL,
  subject_id       uuid NOT NULL,
  from_state       text,
  to_state         text,
  payload          jsonb NOT NULL DEFAULT '{}', -- 개인정보 금지 — ID 참조만(data-model §5.4)
  request_id       text,                       -- 요청 단위 상관관계
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE notification (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES project(id),
  user_id         uuid NOT NULL REFERENCES "user"(id),
  event_id        uuid NOT NULL,               -- 논리 FK → event.id (본문 위 설명)
  importance      notification_importance NOT NULL,
  channel         notification_channel NOT NULL DEFAULT 'inapp',
  state           notification_state NOT NULL DEFAULT 'unread',
  digest_batch_id uuid,
  delivered_at    timestamptz,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 2.11 순환 참조 FK

세 쌍이 서로를 가리키므로 테이블 생성 뒤 ALTER로 건다.

```sql
ALTER TABLE spec
  ADD CONSTRAINT spec_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES spec_version(id);

ALTER TABLE spec_version
  ADD CONSTRAINT spec_version_change_request_fk
  FOREIGN KEY (change_request_id) REFERENCES change_request(id);

ALTER TABLE agent_session
  ADD CONSTRAINT agent_session_current_task_fk
  FOREIGN KEY (current_task_id) REFERENCES task(id);
```

### 2.12 인덱스

data-model §5.3 표의 전량 + 보조 인덱스(표에 없는 것은 주석에 `보조`로 표기). 도메인 조회 인덱스는 예외 없이 `(project_id, …)` 복합으로 시작한다.

```sql
-- 테넌시
CREATE UNIQUE INDEX membership_user_scope_uq ON membership (user_id, coalesce(project_id, org_id));
CREATE INDEX api_token_project_user ON api_token (project_id, user_id);            -- 보조: S8 토큰 목록

-- 스펙
CREATE INDEX spec_tree ON spec (project_id, parent_id, sort_key);                  -- 보조: 트리 렌더
CREATE INDEX spec_version_spec_status ON spec_version (spec_id, status);           -- 최신 approved 조회
CREATE INDEX requirement_spec_impl ON requirement (spec_id, impl_status);          -- 커버리지 집계(§4.1)
CREATE INDEX spec_comment_open ON spec_comment (spec_id, status);                  -- 보조: open 코멘트 수

-- 검색 — data-model §5.3(하이브리드)의 렉시컬 축. 파이프라인 정본은 4.4 §2.2b.
-- ① FTS: 영문·안정 ID 토큰. title은 spec에 있으므로 두 인덱스로 나눈다(본문은 버전, 제목은 노드).
CREATE INDEX spec_version_body_fts ON spec_version USING gin (to_tsvector('simple', body_md));
CREATE INDEX spec_title_fts        ON spec         USING gin (to_tsvector('simple', title));
-- ② trigram: 한국어 조사 변형·부분 문자열. 'simple' 토크나이저는 공백 분리라 한국어에서
--    "위젯"≠"위젯을"이 된다 — trigram이 이 갭을 막는다(REQ-DB-016). 형태소 분석기는 도입하지 않는다.
CREATE INDEX spec_version_body_trgm ON spec_version USING gin (body_md gin_trgm_ops);
CREATE INDEX spec_title_trgm        ON spec         USING gin (title gin_trgm_ops);
CREATE INDEX requirement_text_trgm  ON requirement  USING gin (text gin_trgm_ops);   -- EARS 문장 검색(4.4 §2.2b)

-- 작업·클레임
CREATE INDEX task_ready_queue ON task (project_id, status, priority);              -- ready 큐(§4.5)
CREATE UNIQUE INDEX claim_task_active_uq ON claim (task_id) WHERE status = 'active'; -- 중복 클레임 차단(규칙 2)
CREATE INDEX claim_scope_specs_gin ON claim USING gin (scope_spec_ids);            -- 겹침 검사(§4.6)
CREATE INDEX claim_scope_globs_gin ON claim USING gin (scope_file_globs);
CREATE INDEX claim_project_active  ON claim (project_id) WHERE status = 'active';  -- 보조: 겹침 스캔 축

-- 세션·활동
CREATE INDEX agent_session_board ON agent_session (project_id, state, last_heartbeat_at); -- S5 보드 + stale 스캔
CREATE UNIQUE INDEX agent_session_external_uq ON agent_session (project_id, external_session_id)
  WHERE external_session_id IS NOT NULL;                                           -- 보조: 훅 조인 키
CREATE INDEX activity_session_time ON activity (session_id, created_at);           -- 보조: 타임라인
CREATE INDEX activity_project_time ON activity (project_id, created_at DESC);      -- 보조: 피드

-- 리뷰
CREATE INDEX review_session_gate  ON review_session (project_id, head_sha);        -- 게이트 판정(§4.4)
CREATE INDEX review_session_round ON review_session (changeset_hash, round_no);
CREATE INDEX finding_queue ON finding (project_id, status, severity);              -- dedup + 리뷰 큐

-- 승인·이벤트·알림
CREATE INDEX approval_inbox ON approval (project_id, assignee_user_id) WHERE decision IS NULL; -- 승인함(§4.7)
CREATE INDEX event_project_time ON event (project_id, occurred_at DESC);           -- 피드
CREATE INDEX event_subject      ON event (subject_type, subject_id, occurred_at);  -- 감사(§4.8)
CREATE INDEX notification_inbox ON notification (user_id, state, created_at DESC); -- 보조: 수신함
CREATE INDEX question_open ON question (project_id, status);                       -- 보조: 열린 질문 수
CREATE INDEX evidence_requirement ON evidence (requirement_id) WHERE NOT stale;    -- 보조: 커버리지(§4.1)
```

### 2.13 함수·트리거

data-model §5.5의 무결성 규칙 중 DB로 내릴 수 있는 것의 실물이다. 규칙별 구현 위치는 §5.2 표에서 전수 대조한다.

```sql
-- 규칙 1 — approved 본문 불변. 실제 동결 시점은 in_review 진입(spec-workflow §1.2:
-- "가변 구간은 draft 하나뿐")이므로 draft가 아니면 본문·해시 UPDATE를 거부한다(상위 집합 강제).
CREATE OR REPLACE FUNCTION nerv_spec_version_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft'
     AND (NEW.body_md IS DISTINCT FROM OLD.body_md
          OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    RAISE EXCEPTION 'spec_version % is frozen (status=%): body_md/content_hash are immutable',
      OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER spec_version_freeze
  BEFORE UPDATE ON spec_version
  FOR EACH ROW EXECUTE FUNCTION nerv_spec_version_freeze();

-- updated_at 자동 갱신 (updated_at 컬럼을 가진 테이블은 task 하나)
CREATE OR REPLACE FUNCTION nerv_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER task_touch_updated_at
  BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION nerv_touch_updated_at();

-- scope 겹침 검사의 glob 교차 판정 — data-model §4.6이 호출하는 nerv_glob_overlap의 MVP 구현.
-- spec-workflow §4.4 globs_can_intersect 의사코드의 직역: 보수적 판정(과검출은 경고, 미검출은 사고).
CREATE OR REPLACE FUNCTION nerv_glob_overlap(g1 text, g2 text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  p1 text[] := string_to_array(g1, '/');
  p2 text[] := string_to_array(g2, '/');
  n  int    := least(array_length(p1, 1), array_length(p2, 1));
  a  text;  b text;
BEGIN
  IF g1 = g2 THEN RETURN true; END IF;
  FOR i IN 1..n LOOP
    a := p1[i];  b := p2[i];
    IF a = '**' OR b = '**' THEN RETURN true; END IF;          -- 이후 임의 깊이 → 교차 가능
    IF position('*' in a) = 0 AND position('*' in b) = 0 AND a <> b THEN
      RETURN false;                                            -- 리터럴 세그먼트 불일치 → 교차 불가
    END IF;
    -- 세그먼트 내 '*'는 보수적으로 매치 가능으로 본다
  END LOOP;
  RETURN true;                                                 -- 접두 전부 호환 → 보수적으로 true
END $$;
```

### 2.14 event · activity 월 파티션

data-model §5.3 — 이 둘이 유일하게 선형 성장하는 테이블이다(clemvion 실측: 73일간 리뷰 세션 1,891개, 일평균 26개). 파티션 부모의 행 트리거·인덱스는 파티션에 자동 전파된다(선언적 파티션 전제, PG 13+).

```sql
-- 대상 월과 다음 달 파티션을 보장한다. 0001이 현재+다음 달을 만들고,
-- 이후는 nerv-worker가 매일 1회 호출(advisory lock 하에 — codebase.md 워커 잡 규약).
CREATE OR REPLACE FUNCTION nerv_ensure_month_partitions(target_month date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  m_start date := date_trunc('month', target_month)::date;
  m_end   date := (m_start + interval '1 month')::date;
  suffix  text := to_char(m_start, '"y"YYYY"m"MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS event_%s PARTITION OF event FOR VALUES FROM (%L) TO (%L)',
    suffix, m_start, m_end);
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS activity_%s PARTITION OF activity FOR VALUES FROM (%L) TO (%L)',
    suffix, m_start, m_end);
  -- §2.6 — activity의 세션 내 seq 유일성은 파티션 단위 unique로 강제
  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS activity_%s_session_seq_uq ON activity_%s (session_id, seq)',
    suffix, suffix);
END $$;

SELECT nerv_ensure_month_partitions(current_date);
SELECT nerv_ensure_month_partitions((current_date + interval '1 month')::date);
```

보존 정책(data-model §5.4)과의 연결: `event`는 영구 보존하되 12개월 지난 파티션을 `DETACH PARTITION` 후 콜드 스토리지로 내리고, `activity`는 프로젝트 설정(기본 90일)에 따라 워커가 세션 요약으로 압축한 뒤 파티션을 드랍한다. 두 동작 모두 워커 잡이며 이 문서의 범위는 "파티션이 존재하고 분리 가능하다"까지다.

---

### 2.15 검색 인덱스 테이블 — `spec_chunk_embedding` (도메인 엔티티 아님)

**이 테이블은 데이터 모델의 엔티티가 아니다.** 원문(`spec_version.body_md`)에서 언제든 재생성 가능한 **검색 인덱스의 물리 테이블**이며(D-07 "결론 영구·입력 휘발"과 같은 축 — 이쪽은 "원본 영구·인덱스 파생"), 엔티티 29종 카운트·[3.3 데이터 모델](../03-proposal/data-model.md)의 ERD에 들지 않는다. 백업 대상에서도 제외 가능하다([4.2](codebase.md) §6.5 — 유실 시 재임베딩).

```sql
CREATE TABLE spec_chunk_embedding (
  id               uuid PRIMARY KEY,
  spec_version_id  uuid NOT NULL REFERENCES spec_version(id) ON DELETE CASCADE,
  anchor           text NOT NULL,            -- 헤딩 slug — 코멘트 앵커와 동일 규약(D-09). 청크 = 헤딩 단위
  chunk_hash       bytea NOT NULL,           -- sha256(청크 본문) — 무변경 재임베딩 차단
  embedding        vector(1024) NOT NULL,    -- BGE-m3 1024차원(모델 정본: 4.1 §2.1)
  model            text NOT NULL,            -- 모델 식별자 — 교체 시 재임베딩 관리 축
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chunk_embedding_uq UNIQUE (spec_version_id, anchor, model)
);

CREATE INDEX spec_chunk_embedding_hnsw
  ON spec_chunk_embedding USING hnsw (embedding vector_cosine_ops);
```

운영 규칙(집행 주체는 워커 `embedding.job` — [4.2](codebase.md) §2.2):

1. **인덱싱 대상은 최신 판만** — 스펙별 최신 approved 버전 + 현재 draft 버전. supersede·draft 폐기 시 해당 버전 행은 삭제한다(전 버전 임베딩은 비용 대비 무가치 — 과거 판 검색은 렉시컬로 충분).
2. **갱신 트리거** — draft 저장 커밋·승인·임포트 배치 후 이벤트를 워커가 소비해 청크 해시 비교 후 변경분만 임베딩한다. approved 본문은 불변이므로 버전당 최대 1회다.
3. **모델 교체** — `model` 컬럼이 다른 행을 새로 쓰고, 전량 재임베딩 완료 후 구 모델 행을 드랍한다(검색은 단일 모델만 질의).

## 3. 이벤트 방송 규약 — Valkey `nerv_events`

### 3.1 원천은 event 행, 방송 버스는 Valkey pub/sub

실시간 팬아웃의 **원천은 `event` 행**(도메인 트랜잭션 안 INSERT — 규칙 6)이고, **방송 버스는 Valkey pub/sub 채널 `nerv_events`**다(확정 스택 — [4.1 MVP 범위와 스택 확정](scope.md) §2, 2026-08-21). 발행 주체는 `EventService` 하나다 — 도메인 트랜잭션이 커밋된 직후 봉투를 PUBLISH한다([4.2 코드베이스와 배포](codebase.md) REQ-CB-004). 각 `nerv-api` 파드는 SUBSCRIBE 후 자기에게 붙은 WS 룸·SSE 스트림에만 emit하므로 크로스파드 어댑터가 필요 없다.

> **결정 이력.** v0.1(2026-08-20)은 `event` AFTER INSERT 트리거의 `pg_notify`("경로 무관 보장")를 택했다. 2026-08-21 실시간 채널 확정(WebSocket + SSE 다중 채널)과 함께 방송 버스를 Valkey로 옮기며 트리거 방식은 폐기한다 — PG NOTIFY는 페이로드 8000B 한도, 파드·워커마다의 `LISTEN` 전용 커넥션 점유, 트랜잭션 풀러(PgBouncer 류) 비호환, 재연결 구간 유실이라는 운영 제약을 안고 있었고, 채널이 2종(WS·SSE)으로 늘면서 방송 부하를 DB 밖으로 격리하는 쪽이 확장에 유리하다. 트리거가 주던 "경로 무관 보장"은 세 겹으로 대체한다: ① `event` INSERT 경로가 `EventService` 하나뿐이라는 구조 강제(표면의 drizzle 직접 import 금지 — REQ-CB-003의 lint 표현) ② 커밋 후 PUBLISH를 같은 메서드에 묶는 REQ-CB-004 ③ 워커의 폴링 폴백(§3.3).

### 3.2 채널·페이로드

```text
채널:    nerv_events            (단일 채널 — 필터링은 수신측 몫. 상수 정본: @nerv/schema EVENTS_CHANNEL)
발행:    EventService — event 행 INSERT를 담은 트랜잭션 커밋 직후 PUBLISH.
         롤백된 트랜잭션은 발행 지점에 도달하지 않으므로 방송되지 않는다.
페이로드: JSON — 참조만 담는다. 상세는 수신자가 재조회한다(개인정보 금지 유지).
```

```json
{ "id": "01991f2a-…", "type": "spec.approved", "project_id": "…" }
```

### 3.3 수신자 계약

| 수신자 | 동작 |
| --- | --- |
| `nerv-api` 각 파드 | 기동 시 `SUBSCRIBE nerv_events` → 페이로드의 `project_id`로 자기 파드에 붙은 `project:{id}` 룸·`/sse/projects/{p}` 스트림을 찾아 emit. 이벤트 이름·본문 계약은 [4.4 API 명세](api.md) §3 |
| `nerv-worker` | 같은 채널 `SUBSCRIBE` → 알림 파생(notification INSERT)·다이제스트 배칭 트리거. 유실 대비 폴백은 `event_project_time` 인덱스 폴링(마지막 처리 `occurred_at` 이후) |
| 재연결 클라이언트 | 방송은 유실 허용이다(D-14 — 진실은 DB). 끊겼던 클라이언트는 화면 데이터를 재조회하고(WS·SSE 공통, replay 없음), 워커는 폴링 폴백으로 따라잡는다 |

---

## 4. 개발 시드

예시 데이터 한 벌은 기존 문서 세트와 동일하다(vision §2·ui-wireframes §S4/S5) — 프로젝트 clemvion, 스펙 `SPC-CWC-007`(웹챗 위젯 임베드)·`SPC-CWC-012`(세션 복원 API), `REQ-CWC-031`, `TSK-3f77`=하나/mac-07, `TSK-a3f8`=도현/mac-02, `TSK-b904`=유나/linux-ci-01/codex, 세션 `S-b7e9` 등. 표시 문자열은 각 테이블의 `key`(spec·task) · `ref`(requirement) · `external_session_id`(agent_session)로 심는다. 시드는 **개발 전용**이며 `pnpm db:seed`가 TRUNCATE 후 재삽입하므로 몇 번을 실행해도 같은 상태다(REQ-DB-002). UUID는 가독성을 위한 고정값(UUIDv7 형식)이다.

```sql
BEGIN;
TRUNCATE organization, "user" CASCADE;   -- FK 연쇄로 전 도메인 테이블 초기화

-- 월초 실행 대비 — 시드 이벤트의 과거 시각(최대 2일 전)이 지난달 파티션에 떨어질 수 있다
SELECT nerv_ensure_month_partitions((current_date - interval '1 month')::date);

-- 테넌시 ---------------------------------------------------------------
INSERT INTO organization (id, slug, name) VALUES
  ('01990a66-0000-7000-8000-000000000001', 'nerv', 'NERV');

INSERT INTO "user" (id, email, display_name, state) VALUES
  ('01990a66-0000-7000-8000-000000000011', 'jimin@example.com',  '지민', 'active'),
  ('01990a66-0000-7000-8000-000000000012', 'seoyeon@example.com','서연', 'active'),
  ('01990a66-0000-7000-8000-000000000013', 'dohyun@example.com', '도현', 'active'),
  ('01990a66-0000-7000-8000-000000000014', 'yuna@example.com',   '유나', 'active'),
  ('01990a66-0000-7000-8000-000000000015', 'hana@example.com',   '하나', 'active');

INSERT INTO project (id, org_id, slug, key, name, repo_url, default_branch) VALUES
  ('01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000001',
   'clemvion', 'CLV', 'clemvion', 'https://git.example.com/nerv/clemvion.git', 'main');

INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
  ('01990a66-0000-7000-8000-000000000031', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000011', 'planner'),
  ('01990a66-0000-7000-8000-000000000032', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000012', 'designer'),
  ('01990a66-0000-7000-8000-000000000033', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000013', 'developer'),
  ('01990a66-0000-7000-8000-000000000034', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000014', 'developer'),
  ('01990a66-0000-7000-8000-000000000035', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000015', 'developer');

INSERT INTO api_token (id, project_id, user_id, name, token_hash, prefix, scopes) VALUES
  ('01990a66-0000-7000-8000-000000000036', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000015', '노트북 Claude Code',
   digest('dev-seed-token-hana', 'sha256'), 'nrv_dev1',
   ARRAY['spec:read', 'spec:write', 'task:claim', 'review:write', 'session:write']);

-- 세션 (S5 보드 한 벌: S-8f31 도현/mac-02, S-2d04 유나/linux-ci-01, S-b7e9 하나/mac-07) --
INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, branch,
                           external_session_id, state, started_at, last_heartbeat_at,
                           diff_added, diff_removed) VALUES
  ('01990a66-0000-7000-8000-000000000081', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000013', 'claude-code', 'mac-02', 'feature/widget-v2',
   'S-8f31', 'active', now() - interval '151 minutes', now() - interval '12 seconds', 218, 34),
  ('01990a66-0000-7000-8000-000000000082', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000014', 'codex', 'linux-ci-01', 'feat/session-restore',
   'S-2d04', 'awaiting_input', now() - interval '80 minutes', now() - interval '44 seconds', 64, 5),
  ('01990a66-0000-7000-8000-000000000083', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000015', 'claude-code', 'mac-07', 'fix/loader-cache',
   'S-b7e9', 'active', now() - interval '48 minutes', now() - interval '41 seconds', 12, 0);

-- 스펙 트리 ------------------------------------------------------------
INSERT INTO spec (id, project_id, parent_id, type, key, title, sort_key) VALUES
  ('01990a66-0000-7000-8000-000000000041', '01990a66-0000-7000-8000-000000000021', NULL,
   'area', 'channel-web-chat', '채널 · 웹챗', '7'),
  -- 표시 ID(SPC-*)를 key로 심는다 — 웹 라우트 /p/clemvion/specs/SPC-CWC-007 정합
  ('01990a66-0000-7000-8000-000000000042', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000041', 'feature', 'SPC-CWC-007', '웹챗 위젯 임베드 v2', '2'),
  ('01990a66-0000-7000-8000-000000000043', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000041', 'feature', 'SPC-CWC-012', '세션 복원 API', '3');

INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash,
                          author_user_id, approved_at, approved_by_user_id,
                          superseded_by_version_id) VALUES
  -- SPC-CWC-007 v3 (superseded) → v4 (approved) — S3 diff v3..v4의 재료
  ('01990a66-0000-7000-8000-000000000051', '01990a66-0000-7000-8000-000000000042', 3,
   'superseded', E'# 웹챗 위젯 임베드\n\n(v3 본문)', digest(E'# 웹챗 위젯 임베드\n\n(v3 본문)', 'sha256'),
   '01990a66-0000-7000-8000-000000000011', now() - interval '9 days',
   '01990a66-0000-7000-8000-000000000012', '01990a66-0000-7000-8000-000000000052'),
  ('01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000042', 4,
   'approved',
   E'# 웹챗 위젯 임베드 v2\n\n## 요구사항\n\n- REQ-CWC-031 WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다\n',
   digest(E'# 웹챗 위젯 임베드 v2\n\n## 요구사항\n\n- REQ-CWC-031 WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다\n', 'sha256'),
   '01990a66-0000-7000-8000-000000000011', now() - interval '2 days',
   '01990a66-0000-7000-8000-000000000012', NULL),
  ('01990a66-0000-7000-8000-000000000053', '01990a66-0000-7000-8000-000000000043', 1,
   'approved', E'# 세션 복원 API\n\n(v1 본문)', digest(E'# 세션 복원 API\n\n(v1 본문)', 'sha256'),
   '01990a66-0000-7000-8000-000000000011', now() - interval '5 days',
   '01990a66-0000-7000-8000-000000000012', NULL);

UPDATE spec SET current_version_id = '01990a66-0000-7000-8000-000000000052'
  WHERE id = '01990a66-0000-7000-8000-000000000042';
UPDATE spec SET current_version_id = '01990a66-0000-7000-8000-000000000053'
  WHERE id = '01990a66-0000-7000-8000-000000000043';

INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority, impl_status,
                         introduced_in_version_id, current_version_id) VALUES
  ('01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000042', 'REQ-CWC-031',
   'WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다', 'must', 'in_progress',
   '01990a66-0000-7000-8000-000000000051', '01990a66-0000-7000-8000-000000000052');

INSERT INTO requirement_version (requirement_id, spec_version_id, change_kind, statement_md, ordinal) VALUES
  ('01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000051', 'added',
   'WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다', 1),
  ('01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000052', 'unchanged',
   'WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다', 1);

-- 작업 + 클레임 (S4 보드 한 벌) ------------------------------------------
INSERT INTO task (id, project_id, key, title, status, priority,
                  source_spec_version_id, source_requirement_id,
                  assignee_user_id, delegate_session_id,
                  goal_md, output_format_md, tools_sources_md, boundaries_md, blocked_reason) VALUES
  ('01990a66-0000-7000-8000-000000000071', '01990a66-0000-7000-8000-000000000021',
   'TSK-a3f8', '위젯 상태별 렌더링', 'in_progress', 'P1',
   '01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000061',
   '01990a66-0000-7000-8000-000000000013', '01990a66-0000-7000-8000-000000000081',
   'SPC-CWC-007 v4의 위젯 상태별(로딩·빈·오프라인) 렌더링 구현 — REQ-CWC-031 연계',
   'PR 1건 + 상태별 스냅샷 테스트', 'nerv_spec_get으로 SPC-CWC-007 v4 본문·REQ 로드',
   '프론트엔드 위젯 코드만. 서버 세션 API는 별도 Task.', NULL),
  ('01990a66-0000-7000-8000-000000000072', '01990a66-0000-7000-8000-000000000021',
   'TSK-b904', '세션 복원 API', 'blocked', 'P1',
   '01990a66-0000-7000-8000-000000000053', NULL,
   '01990a66-0000-7000-8000-000000000014', '01990a66-0000-7000-8000-000000000082',
   'SPC-CWC-012 v1의 세션 복원 API 구현', 'PR 1건 + 통합 테스트',
   'nerv_spec_get으로 SPC-CWC-012 v1 로드', '백엔드 세션 복원 경로만.', 'awaiting_answer'),
  ('01990a66-0000-7000-8000-000000000073', '01990a66-0000-7000-8000-000000000021',
   'TSK-3f77', '스니펫 로더 캐시 헤더', 'in_progress', 'P2',
   '01990a66-0000-7000-8000-000000000052', NULL,
   '01990a66-0000-7000-8000-000000000015', '01990a66-0000-7000-8000-000000000083',
   'SPC-CWC-007 위젯 스니펫 로더의 캐시 헤더 정정', 'PR 1건',
   'nerv_spec_get으로 SPC-CWC-007 v4 로드', '로더 배포 경로만. 위젯 런타임 금지.', NULL);

UPDATE agent_session SET current_task_id = '01990a66-0000-7000-8000-000000000071' WHERE external_session_id = 'S-8f31';
UPDATE agent_session SET current_task_id = '01990a66-0000-7000-8000-000000000072' WHERE external_session_id = 'S-2d04';
UPDATE agent_session SET current_task_id = '01990a66-0000-7000-8000-000000000073' WHERE external_session_id = 'S-b7e9';

INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status,
                   scope_spec_ids, scope_file_globs, lease_expires_at) VALUES
  ('01990a66-0000-7000-8000-000000000091', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000071', '01990a66-0000-7000-8000-000000000081',
   '01990a66-0000-7000-8000-000000000013', 'active',
   ARRAY['01990a66-0000-7000-8000-000000000042']::uuid[],
   ARRAY['codebase/frontend/src/widget/**'], now() + interval '8 minutes'),
  ('01990a66-0000-7000-8000-000000000092', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000072', '01990a66-0000-7000-8000-000000000082',
   '01990a66-0000-7000-8000-000000000014', 'active',
   ARRAY['01990a66-0000-7000-8000-000000000043']::uuid[],
   ARRAY['codebase/backend/src/session-restore/**'], now() + interval '22 minutes'),
  ('01990a66-0000-7000-8000-000000000093', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000073', '01990a66-0000-7000-8000-000000000083',
   '01990a66-0000-7000-8000-000000000015', 'active',
   ARRAY['01990a66-0000-7000-8000-000000000042']::uuid[],
   ARRAY['codebase/frontend/src/loader/**'], now() + interval '21 minutes');

-- 질문 (S-2d04는 awaiting_input — S7 승인함 카드) --------------------------
INSERT INTO question (id, project_id, agent_session_id, task_id, title, body_md,
                      options, urgency, status) VALUES
  ('01990a66-0000-7000-8000-0000000000a1', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000082', '01990a66-0000-7000-8000-000000000072',
   '스토리지 선택',
   '임베드 위젯의 세션 복원을 localStorage로 할지 서버 세션으로 할지 — 스펙에 명시 없음',
   '["localStorage", "서버 세션", "스펙에 남길 질문"]', 'blocking', 'open');

-- 이벤트 (커밋 후 EventService가 §3 규약으로 nerv_events에 PUBLISH) ---------
INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, actor_session_id,
                   is_agent, subject_type, subject_id, from_state, to_state) VALUES
  ('01990a66-0000-7000-8000-0000000000b1', '01990a66-0000-7000-8000-000000000021',
   now() - interval '2 days', 'spec.approved', '01990a66-0000-7000-8000-000000000012', NULL,
   false, 'spec_version', '01990a66-0000-7000-8000-000000000052', 'in_review', 'approved'),
  ('01990a66-0000-7000-8000-0000000000b2', '01990a66-0000-7000-8000-000000000021',
   now() - interval '151 minutes', 'task.claimed', '01990a66-0000-7000-8000-000000000013',
   '01990a66-0000-7000-8000-000000000081', true, 'task',
   '01990a66-0000-7000-8000-000000000071', 'ready', 'claimed'),
  ('01990a66-0000-7000-8000-0000000000b3', '01990a66-0000-7000-8000-000000000021',
   now() - interval '22 minutes', 'question.created', '01990a66-0000-7000-8000-000000000014',
   '01990a66-0000-7000-8000-000000000082', true, 'question',
   '01990a66-0000-7000-8000-0000000000a1', NULL, NULL);

-- 알림 (question.created → 지민 승인함, critical 티어라 immediate) ----------
INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state) VALUES
  ('01990a66-0000-7000-8000-0000000000c1', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000011', '01990a66-0000-7000-8000-0000000000b3',
   'immediate', 'inapp', 'unread');

COMMIT;
```

이 한 벌로 S1 홈(질문 배지 1), S3 스펙 상세(SPC-CWC-007 v4 approved + REQ-CWC-031), S4 작업 보드(in_progress 2 · blocked 1), S5 세션 모니터(active 2 · awaiting_input 1), S7 승인함(질문 카드 1)이 전부 비어 있지 않게 뜬다 — 화면 개발([4.5 화면 명세](screens.md))의 로딩/빈/에러 3상태 중 "데이터 있음" 경로를 즉시 확인할 수 있다.

---

## 5. 수용 기준 (REQ-DB-*)

### 5.1 수용 기준 표

행동 요구는 EARS로 쓴다. 검증은 전부 자동화 가능하다(테스트 위치·계층은 [4.2 코드베이스와 배포](codebase.md) 컨벤션 절).

| ID | 수용 기준 (EARS) | 검증 방법 |
| --- | --- | --- |
| REQ-DB-001 | WHEN 빈 데이터베이스에 마이그레이션을 실행하면 THE SYSTEM SHALL 오류 없이 0001 스냅샷을 적용하고, 직후 같은 명령을 재실행하면 변경 0건으로 종료한다 | CI 잡: 새 컨테이너에 `migrate` 2회 실행, 두 번째 출력에 적용 파일 0 확인 |
| REQ-DB-002 | WHEN 스키마 적용 후 `pnpm db:seed`를 2회 실행하면 THE SYSTEM SHALL 두 번 모두 성공하고 §4의 동일한 데이터 상태를 재현한다 | 시드 2회 후 행 수·키 스냅샷 비교 |
| REQ-DB-003 | WHEN `status <> 'draft'`인 `spec_version`의 `body_md` 또는 `content_hash`를 UPDATE하면 THE SYSTEM SHALL 예외를 발생시키고 변경을 거부한다 | 트리거 테스트(approved·in_review·superseded 각 1건) |
| REQ-DB-004 | WHEN 한 `task`에 `status='active'`인 `claim`이 있는 상태에서 두 번째 active claim을 INSERT하면 THE SYSTEM SHALL unique 위반으로 거부한다 | 동시 INSERT 2건 경쟁 테스트 — 정확히 1건 성공 |
| REQ-DB-005 | WHEN `event`에 행이 INSERT되고 트랜잭션이 커밋되면 THE SYSTEM SHALL Valkey `nerv_events` 채널로 `{id, type, project_id}` JSON을 PUBLISH하고, 롤백 시 발행하지 않는다(§3) | SUBSCRIBE 클라이언트 붙인 통합 테스트(커밋/롤백 각 1건) |
| REQ-DB-006 | WHEN 위임 명세 4요소 중 하나라도 NULL인 `task`를 `backlog`·`blocked` 밖의 상태로 UPDATE하면 THE SYSTEM SHALL CHECK 위반으로 거부한다 | 4요소 각각 NULL로 4케이스 |
| REQ-DB-007 | WHEN `spec_impact IS NULL`인 `task`를 `done`으로 UPDATE하면 THE SYSTEM SHALL CHECK 위반으로 거부한다 | 부정 1건 + `{"none": true}` 통과 1건 |
| REQ-DB-008 | WHEN 베이스라인 생성 트랜잭션에 `approved`가 아닌 `spec_version` 항목이 포함되면 THE SYSTEM SHALL 생성 전체를 거부하고, WHEN 생성된 베이스라인의 항목 변경(UPDATE/DELETE)이 시도되면 THE SYSTEM SHALL 거부한다 — 세트 변경은 새 베이스라인 생성으로만 한다 | draft 항목 포함 생성 거부 1건 + 항목 변경 거부 1건 + 핀 대상 superseded 후 조회 불변 1건 |
| REQ-DB-008 | WHEN `requirement_id`·`spec_version_id`·`task_id`가 전부 NULL인 `evidence`를 INSERT하면 THE SYSTEM SHALL CHECK 위반으로 거부한다 | 부정 1건 + 각 앵커 단독 통과 3건 |
| REQ-DB-009 | WHEN `nerv_ensure_month_partitions(대상 월)`을 호출하면 THE SYSTEM SHALL `event`·`activity`의 해당 월 파티션과 activity 파티션별 `(session_id, seq)` unique 인덱스를 생성하고, 재호출 시 오류 없이 통과한다 | 함수 2회 호출 후 카탈로그 조회 |
| REQ-DB-010 | WHEN 같은 사용자를 같은 스코프(`coalesce(project_id, org_id)` 동일)에 두 번 배정하면 THE SYSTEM SHALL unique 위반으로 거부한다 | 프로젝트 중복·조직 전역 중복 각 1건 |
| REQ-DB-011 | WHEN `status <> 'draft'`인 `spec_version`에 `edit_lease_user_id`·`edit_lease_session_id`·`edit_lease_expires_at` 중 하나라도 non-NULL을 쓰면 THE SYSTEM SHALL CHECK 위반으로 거부한다 | 3필드 각각 1건 |
| REQ-DB-012 | WHEN `commit_sha` 없이 `kind='fixed'`인 `resolution`을 INSERT하면 THE SYSTEM SHALL CHECK 위반으로 거부한다 | 부정 1건 + `spec_change`에 `change_request_id` 누락 1건 |
| REQ-DB-013 | WHEN `nerv_glob_overlap`에 두 glob을 넘기면 THE SYSTEM SHALL 보수적 교차 판정을 반환한다 — 최소: (`a/**`, `a/b/c`)=true, (`a/b/**`, `a/c/**`)=false, (`a/*/c`, `a/x/c`)=true | 함수 단위 테스트(위 3케이스 + 동일 문자열 케이스) |
| REQ-DB-014 | WHEN 마이그레이션이 완료되면 THE SYSTEM SHALL `pg_trgm`·`vector` 확장과 §2.12의 trigram GIN 3종·§2.15의 HNSW 인덱스를 카탈로그에서 조회 가능하게 한다 | 마이그레이션 후 `pg_extension`·`pg_indexes` 조회 |
| REQ-DB-015 | WHEN 같은 (spec_version_id, anchor, model)로 임베딩이 재기록되면 THE SYSTEM SHALL 유니크 제약으로 중복 행을 차단하고, `spec_version` 삭제 시 임베딩 행을 CASCADE로 제거한다 | 중복 INSERT 1건 + 버전 삭제 후 잔존 행 0 확인 |
| REQ-DB-016 | WHEN 한국어 질의(예: "위젯")로 trigram 검색을 실행하면 THE SYSTEM SHALL 조사 변형 본문("위젯을 처음 열면")을 포함한 행을 반환한다 — `simple` FTS 단독으로는 매칭되지 않는 케이스가 통과 기준이다 | 조사 변형 3케이스 질의 |
| REQ-DB-017 | WHEN 스펙의 새 버전이 approved되거나 draft가 폐기되면 THE SYSTEM SHALL 이전 판의 `spec_chunk_embedding` 행을 제거해 스펙당 인덱싱 판을 최신 approved + 현재 draft 2개 이하로 유지한다 | supersede 후 행 수 확인 |

### 5.2 무결성 규칙 ↔ 구현 위치 전수 대조

data-model §5.5의 9규칙이 어디서 강제되는지의 최종 답이다. "앱"으로 남는 것은 질의·정책 판단이 필요해 스키마로 내릴 수 없는 것뿐이다.

| # | 규칙 (data-model §5.5) | 구현 위치 | 이 문서의 § |
| --- | --- | --- | --- |
| 1 | approved 버전 본문 불변 | 트리거 `spec_version_freeze` (draft 아니면 동결 — 상위 집합) | §2.13 |
| 2 | 한 Task에 활성 클레임 하나 | partial unique `claim_task_active_uq` | §2.12 |
| 3 | ready 전이는 위임 명세 4요소 | CHECK `task_delegation_spec_ck` (+ 전이 API의 의존성 검사) | §2.5 |
| 4 | done 전이는 게이트 + spec_impact | CHECK `task_done_spec_impact_ck` + 게이트 판정은 API(질의 필요) | §2.5 |
| 5 | 지시자 ≠ 승인자 | **앱** — 소규모 완화(spec-workflow §2.3) 때문에 하드 제약 불가 | §2.8 |
| 6 | 모든 상태 전이는 Event를 남긴다 | **앱**(도메인 서비스, 같은 트랜잭션) + §3 트리거가 "남긴 것은 반드시 방송" 보장 | §3 |
| 7 | severity 변경은 감사 대상 | **앱**(변경 시 event 기록) + 원값은 `finding_occurrence.raw_severity`에 보존 | §2.7 |
| 8 | 모든 도메인 행은 project_id | NOT NULL 컬럼(전 도메인 테이블) + junction 예외는 §1.1 | §2 전체 |
| 9 | 편집 리스는 draft에서만 | CHECK `spec_version_lease_draft_only_ck` | §2.3 |

---

## 참고 자료

### 정본 문서 (이 문서가 인용만 하는 것)

- [3.3 데이터 모델](../03-proposal/data-model.md) — 엔티티 29종 필드 의미·상태 머신·인덱스 §5.3·무결성 규칙 §5.5·보존 정책 §5.4. **이 문서의 모든 테이블·컬럼 이름의 원천**
- [3.5 스펙 워크플로우와 거버넌스](../03-proposal/spec-workflow.md) — 이벤트 이름 정본(§6), 클레임 의사코드(§4.4), 초안 편집 리스 규약(§1.2), 소규모 완화(§2.3)
- [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) — DDL 주석이 인용한 `nerv_*` 도구 계약(§2)과 ingest 멱등 키
- [3.2 시스템 아키텍처](../03-proposal/architecture.md) — Valkey pub/sub 팬아웃 구조(§4.4), 저장 전략 D-01, 보존 2층 구조(§2.5)
- [1.2 문제 정의와 요구사항](../01-problem/pain-points.md) — FR·NFR·P 번호의 정의

### 4부 형제 문서

- [4.1 MVP 범위와 스택 확정](scope.md) — Postgres + Drizzle 스택 확정과 재검토 트리거
- [4.2 코드베이스와 배포](codebase.md) — `packages/schema` 배치, 마이그레이션 실행 시점(compose 기동 시 / k8s Job), 워커 잡·advisory lock 규약
- [4.4 API 명세](api.md) — 이 스키마의 컬럼명을 그대로 쓰는 REST·WS 계약
- [4.7 스펙 임포터](importer.md) — §4 시드가 아닌 실데이터 적재 경로(frontmatter → 필드 매핑)

### 외부 출처 (기존 문서에서 접속 확인된 URL의 재인용)

- [Herding elephants: sharding Postgres at Notion — Notion](https://www.notion.com/blog/sharding-postgres-at-notion) — (2021-10-06) workspace ID 파티션 키. `(project_id, …)` 인덱스 규칙과 파티션 전략의 근거(data-model §5.3 재인용)
- [Confluence Cloud REST API — Content versions](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-versions/) — (2026-08-13 확인) 정수 버전·복원은 새 버전·이력 불변. `spec_version_freeze` 트리거가 강제하는 인터페이스(data-model §2.2 재인용)
- [Event Sourcing Pattern — Microsoft Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) — (2026-03-27 갱신) 이벤트 로그와 개인정보의 충돌 경고 — `event.payload`에 ID 참조만 두는 근거(data-model §5.4 재인용)
