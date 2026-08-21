# AGENTS.md — NERV 저장소 에이전트 작업 규약

이 파일은 이 저장소에서 작업하는 모든 AI 에이전트(Claude Code·Codex 등)의 **공통 작업 규약 정본**이다.
어느 머신·어느 세션에서 작업해도 동일한 방식으로 작업하기 위해 존재한다. Claude Code는 `CLAUDE.md`가 이 파일을 import하고, Codex는 이 파일을 직접 읽는다.

## 프로젝트 정체

NERV(가칭)는 **AI 에이전트 협업 개발 플랫폼**이다 — 스펙 문서를 단일 진실로 관리하고, Claude Code·Codex를 MCP·훅·스킬로 연동하며, 사람은 승인/거절/코멘트 게이트를 지키는 멀티 프로젝트 × 멀티 유저 플랫폼.

- **현 단계**: 제안서·MVP 명세 완결([docs/README.md](docs/README.md)가 목차), 구현 착수 전.
- 문서·커밋 메시지 언어는 **한국어**다.

## 저장소 구조 — 세 구역

```text
nerv/
  AGENTS.md      # 이 파일 — 에이전트 규약 정본
  CLAUDE.md      # Claude Code 진입점 — @AGENTS.md import만 한다
  docs/          # 제안서·명세 (md 원본 + html/ 파생본)
  codebase/      # 구현 코드 전체 (pnpm 모노레포 루트)
```

**구현 코드는 반드시 `codebase/` 하위에만 작성한다**(REQ-CB-015). `docs/`에는 문서와 html 파생본만, 저장소 루트에는 규약·메타 파일만 둔다. 모노레포 트리·배치의 정본은 [docs/04-mvp/codebase.md](docs/04-mvp/codebase.md) §1이다.

## 문서 작업 규약

문서를 수정할 때는 [docs/README.md](docs/README.md)의 "관리 규약" 절을 따른다. 핵심:

1. **md가 원본, html은 파생본.** `docs/**/*.md`를 먼저 수정하고, 대응하는 `docs/html/*.html`을 반드시 같이 갱신한다(사이드바 순서·`assets/style.css` 공통 사용). 어느 한쪽만 고치면 결함이다.
2. **정본(single source) 원칙.** 각 주제는 정본 문서 한 곳에서만 정의하고 나머지 문서는 링크로 인용한다. 용어·상태값·결정 번호(D-01~D-14)·요구사항 번호(FR-01~17 / NFR-01~05)는 [docs/01-problem/pain-points.md](docs/01-problem/pain-points.md)가 단일 기준이다. 정본이 아닌 문서에서 재정의하지 않는다.
3. **근거 규율.** 외부 URL은 실제 접속 확인된 것만 싣는다. clemvion 실측 근거는 `clemvion:경로` 표기를 쓴다. 수치는 정본 문서의 값을 인용하고 새 값을 만들지 않는다.
4. **결정 기록.** 확정 결정을 바꾸거나 추가하면 결정일을 명기하고, 점화된 재검토 트리거는 "점화 기록"으로 남기며, `docs/README.md`의 문서 버전을 올리고 수정한 문서 머리의 버전 표기를 동기화한다.
5. **EARS 수용 기준.** 행동 요구는 `REQ-<영역>-NNN` + EARS 문형(WHEN/WHILE … THE SYSTEM SHALL …)으로 쓴다. 기존 번호는 재사용·재배치하지 않고 끝번호에 추가한다.

## 구현 작업 규약

구현에 착수할 때는 4부 문서를 이 순서로 읽는다 — [4.1 scope](docs/04-mvp/scope.md) → [4.2 codebase](docs/04-mvp/codebase.md) → [4.3 database](docs/04-mvp/database.md) → [4.4 api](docs/04-mvp/api.md) → [4.5 screens](docs/04-mvp/screens.md) → [4.6 plugin](docs/04-mvp/plugin.md) → [4.7 importer](docs/04-mvp/importer.md) → [4.8 backlog](docs/04-mvp/backlog.md). 이 문서 세트만 보고 추가 질문 없이 첫 PR을 낼 수 있어야 한다는 것이 4부의 목표 기준이다.

1. **확정 스택은 재논의하지 않는다.** 스택·범위의 정본은 [docs/04-mvp/scope.md](docs/04-mvp/scope.md) §2다. 재검토는 그 문서의 "재검토 트리거"가 점화됐을 때만 시작하고, 점화 사실을 문서에 기록한다.
2. **경계 규칙**(정본: codebase.md — REQ-CB-001~015): `apps/*` 간 직접 import 금지(공유는 `packages/schema` 경유), 표면(컨트롤러·게이트웨이·도구)은 번역만 하고 판정은 도메인 서비스 한 곳(D-05), 상수·이벤트 이름·에러 코드는 `@nerv/schema`에서만 import(하드코딩 금지).
3. **명령 실행 위치.** `pnpm`·`docker compose` 명령은 `codebase/`에서 실행한다. 부트스트랩 절차는 codebase.md §5.1.
4. **테스트.** 3계층(L1 단위 / L2 통합 — 실제 Postgres / L3 E2E)이며 무게중심은 L2다. 동시성(클레임 원자성·겹침·리스 만료)은 mock으로 검증하지 않는다.

## git 규약

- 커밋: Conventional Commits — `feat|fix|docs|refactor|test|chore(scope)`. scope는 워크스페이스 이름(`api`·`web`·`schema`·`deploy`), 문서 작업은 `docs:`.
- 구현 코드는 브랜치(`feat/…`·`fix/…`) + PR 필수, `main` 직접 push 금지(codebase.md §4.4). 문서 커밋은 현행 관례상 `main` 직접 커밋을 허용한다.
- PR 본문에 관련 Task ID(`TSK-…`)와 스펙 안정 ID(`SPC-…`·`REQ-…`)를 남긴다.

## 에이전트 행동 원칙

- **모르면 정본을 찾는다.** 문서 간 서술이 다르면 각 문서가 선언한 정본 관계를 따르고, 정본이 아닌 쪽을 정본에 맞춰 고친 뒤 그 사실을 보고한다.
- **임의 결정 금지.** 스택 변경·범위 조정·새 결정(D-번호·FR/NFR 추가)은 사람의 확인 없이 하지 않는다.
- **문서와 코드가 어긋나면 문서(명세)가 우선**이다 — 단, 문서 쪽 결함이 명백하면 코드를 문서에 끼워 맞추지 말고 먼저 문서 수정을 제안한다.
