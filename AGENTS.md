# AGENTS.md — NERV 저장소 에이전트 작업 규약

이 저장소에서 작업하는 모든 AI 에이전트(Claude Code·Codex)의 **공통 작업 규약 정본**이다. 어느 머신·어느 세션에서든 같은 방식으로 작업하기 위해 존재한다. Claude Code 는 `CLAUDE.md` 가 이 파일을 import 하고, Codex 는 이 파일을 직접 읽는다 — 규약은 이 파일에만 쓴다.

## 프로젝트 정체

NERV(가칭)는 **AI 에이전트 협업 개발 플랫폼**이다 — 스펙 문서를 단일 진실로 관리하고, Claude Code·Codex 를 MCP·훅·스킬로 연동하며, 사람은 승인/거절/코멘트 게이트를 지키는 멀티 프로젝트 × 멀티 유저 플랫폼.

- **현 단계: 구현 중.** 명세의 목차는 [docs/README.md](docs/README.md), **어디까지 왔는지는 [4.8 백로그](docs/04-mvp/backlog.md) §1.4 가 정본**이다 — 새로 만들기 전에 거기서 이미 있는 것을 찾는다.
- 문서·커밋 메시지 언어는 **한국어**다.

## 저장소 구조 — 네 구역

```text
nerv/
  AGENTS.md      # 이 파일 — 규약 정본 (CLAUDE.md 는 @AGENTS.md import 만 한다)
  docs/          # 제안서·명세 (md 원본 + html/ 파생본)
  codebase/      # 애플리케이션·패키지 코드 — pnpm 모노레포 루트
  deploy/        # 배포 산출물 (compose · Dockerfile · kustomize)
```

코드는 `codebase/`, 배포 산출물은 `deploy/`, 문서는 `docs/` 에만 둔다(REQ-CB-015). 트리의 정본은 [4.2 코드베이스](docs/04-mvp/codebase.md) §1 이다.

## 문서 작업 규약

정본은 [docs/README.md](docs/README.md) "관리 규약" 절이다. 핵심:

1. **md 가 원본, html 은 파생본.** `docs/**/*.md` 를 고치면 같은 커밋에서 대응하는 `docs/html/*.html` 도 고친다(사이드바 순서·`assets/style.css` 공용). CI 가 파일 짝·버전·절 번호·고정 ID 를 대조한다(`check-md-html.mjs`).
2. **정본(single source) 원칙.** 주제마다 정본 문서 한 곳에서만 정의하고 나머지는 링크로 인용한다. 상태값·결정 번호(D-01~D-14)·요구사항 번호(FR/NFR)는 [1.2 문제 정의](docs/01-problem/pain-points.md)가, 그 값들의 한국어·영어 이름과 말투(화면은 합쇼체, 에이전트·CLI·생성 문서는 해라체 · §3)·영어 규칙(§2.6)은 [용어 사전](docs/glossary.md)이 정본이다. 새 용어를 들이거나 채택어를 바꾸면 사전을 같은 커밋에서 고친다.
3. **근거 규율.** 외부 URL 은 접속 확인된 것만 싣고(야간 CI 의 lychee 가 죽은 URL 을 잡는다), clemvion 실측은 `clemvion:경로` 로 표기하며, 수치는 정본의 값을 인용하고 새 값을 만들지 않는다.
4. **결정 기록.** 확정 결정을 바꾸거나 더하면 결정일을 적고, 점화된 재검토 트리거는 "점화 기록"으로 남기며, `docs/README.md` 의 버전과 고친 문서 머리의 버전을 함께 올린다(목차의 `버전` 열이 대조표다).
5. **EARS 수용 기준.** 행동 요구는 `REQ-<영역>-NNN` + EARS 문형(WHEN/WHILE … THE SYSTEM SHALL …)으로 쓴다. 번호는 재사용·재배치하지 않고 끝번호에 더한다.
6. **구현 현황은 백로그가 기록한다.** 스토리를 끝냈으면 **같은 커밋에서** [4.8](docs/04-mvp/backlog.md) §1.4 를 고친다 — 부분이면 *남은 것*을 함께 적고, 스토리 없는 구현은 셋째 표에 한 줄 남긴다. 백로그는 첫 임포트 대상이라 거기 적힌 상태가 Task 의 초기 상태가 된다. CI 가 대조한다(`check-backlog-status.mjs` · REQ-CB-029).
7. **문서 간 참조는 링크로 잇고, 역참조는 frontmatter 가 든다.** 다른 문서나 외부 페이지를 인용하면 **인라인 링크**로 잇는다 — `[4.4 API](docs/04-mvp/api.md) §1.6` 처럼 링크 글자는 문서 번호(와 제목), 절은 링크 뒤에 `§`. `4.4 §1.6`·`4.4 v0.87` 처럼 번호만 적지 않고 참조식 링크(`[글자][라벨]`)도 쓰지 않는다(도구가 따라갈 수 없는 인용은 깨져도 아무도 모른다). 각 md 의 frontmatter `references` 는 **그 문서를 링크하는 문서의 목록**이고 도구가 쓴다 — 사람은 적지 않는다. 문서의 절·제목·사실을 바꿨으면 `codebase/` 에서 `node scripts/check-doc-links.mjs --where <문서>` 로 인용한 자리를 받아 함께 고치고, `--fix` 로 목록과 파생본 머리를 다시 쓴다. CI 가 죽은 링크·역참조·파생본 머리·맨 참조·절 실재를 대조한다(REQ-CB-030).

## 구현 작업 규약

구현에 착수할 때는 4부를 이 순서로 읽는다 — [4.1 scope](docs/04-mvp/scope.md) → [4.2 codebase](docs/04-mvp/codebase.md) → [4.3 database](docs/04-mvp/database.md) → [4.4 api](docs/04-mvp/api.md) → [4.5 screens](docs/04-mvp/screens.md) → [4.6 plugin](docs/04-mvp/plugin.md) → [4.7 importer](docs/04-mvp/importer.md) → [4.8 backlog](docs/04-mvp/backlog.md). 이 세트만 보고 추가 질문 없이 첫 PR 을 낼 수 있어야 한다.

1. **확정 스택은 재논의하지 않는다.** 정본은 [4.1](docs/04-mvp/scope.md) §2. 재검토는 그 문서의 재검토 트리거가 점화됐을 때만, 점화 사실을 문서에 기록하고 시작한다.
2. **경계 규칙**(정본: [4.2](docs/04-mvp/codebase.md) §2 · REQ-CB-001~015): `apps/*` 간 직접 import 금지(공유는 `packages/schema` 경유), 표면(컨트롤러·게이트웨이·도구)은 번역만 하고 판정은 도메인 서비스 한 곳(D-05), 상수·이벤트 이름·에러 코드는 `@nerv/schema` 에서만 import(하드코딩 금지).
3. **명령은 `codebase/` 에서 돌린다.** `pnpm`·`docker compose` 모두. 부트스트랩은 [4.2](docs/04-mvp/codebase.md) §5.1.
4. **테스트는 3계층**(L1 단위 / L2 통합 — 실제 Postgres / L3 E2E)이고 무게중심은 L2 다. 동시성(클레임 원자성·겹침·리스 만료)은 mock 으로 검증하지 않는다.
5. **매뉴얼은 변경과 같은 커밋에서 갱신한다.** 제품 매뉴얼 정본은 `codebase/apps/web/src/content/manual/<로케일>/<장>.md` 이고 **ko·en 두 벌**이다(목차·화면 대응은 `apps/web/src/lib/manual.ts`, 장 제목은 `@nerv/schema` 카탈로그 `help.ch.*`). 사람이 보는 것 — 동작·상태값·단축키·CLI 명령·역할과 권한·기본값 — 이 바뀌었는데 매뉴얼이 그대로면 **결함이다**(틀린 문서는 확신을 준다). 화면 명세 정본은 [4.5](docs/04-mvp/screens.md) §2.10.
6. **서버가 바뀌면 플러그인도 검증한다.** 스킬(`codebase/plugin/skills/*/SKILL.md`)은 **모델이 읽는 규약**이라 서버와 어긋나면 그대로 에이전트 행동의 결함이 된다. 도구·인자·응답 필드·권한·훅 계약을 건드렸으면 같은 커밋에서 다섯을 확인한다 — 새 인자·응답 필드를 스킬이 *쓰라고* 말하는가 · 없어진 사실을 스킬이 아직 말하지 않는가 · 스킬이 지시하는 인자가 도구 스키마에 실재하는가(없는 인자는 `ignored_args` 로 조용히 버려진다) · 스킬이 쓰라는 응답 필드가 응답에 실재하는가 · `allowed-tools` 에 그 도구가 있는가. `SKILL.md` 와 [4.6 플러그인](docs/04-mvp/plugin.md)은 바이트 대조된다(`plugin-package.spec.ts`) — **같이, 같은 내용으로** 고친다. 배달되는 파일(`skills/`·`hooks/`·`agents/`·매니페스트)을 건드렸으면 `plugin.json` 의 `version` 을 올리고 카탈로그 둘·`plugin/README.md`·매뉴얼 ko·en 을 맞춘다(REQ-PLG-017). **버전이 곧 배달이다** — 같은 버전이면 설치한 쪽은 옛 사본을 계속 읽는다.
7. **커밋·push 전에 `codebase/` 에서 `pnpm preflight` 를 돌리고, 나온 것은 고친다.** CI 의 `check` 잡을 **같은 열·같은 순서로** 비춘다 — lint·typecheck·format:check, 게이트 일곱(플러그인 버전 · 배포 산출물 · 백로그 현황 · md ↔ html · `.env` 전표 · 문서 간 참조 · schema drift), L1. 넷만 돌리고 초록을 본 사람은 게이트를 한 번도 돌리지 않은 채 push 한다. L2 는 `pnpm preflight --l2`(실제 Postgres · `.env`) — 동시성을 건드렸으면 건너뛰지 않는다. L3 는 `preflight` 에 없고 CI 가 매 PR 에서 본다 — 표면·CLI·계약을 건드렸으면 로컬에서도 `pnpm e2e:up && pnpm test:e2e && pnpm e2e:down`. `pnpm hooks:install` 은 옵트인이고 **훅은 게이트가 아니다** — 게이트는 CI 다.
   - **로컬 초록이 CI 초록을 뜻하지 않는다.** 느린 러너에서만 넘는 고정 상한, PR 레인에서 skip 인 잡 — 둘 다 겪었다. 비용이 자라는 검사에 고정 상한을 두지 않고, 검사는 머지 전에 도는 것만 검사로 친다.
   - **남의 빨강도 고친다.** 빨간 채로 두면 다음 사람의 새 빨강이 그 속에 숨는다. 고쳤으면 커밋 메시지에 무엇을 왜 고쳤는지 적는다(서식만 바뀐 변경은 내용 변경과 섞지 않는 편이 낫다).
   - **검사를 만족시키려고 사실을 바꾸지 않는다.** 실패가 정당하면 코드를, 규칙이 틀렸으면 규칙을 고치자고 **제안**한다. `eslint-disable` 은 이유를 같은 줄에 적을 때만.
   - **고칠 수 없는 실패가 남으면 남았다고 보고한다.** 조용히 두고 "통과했다" 고 말하는 것이 이 규약이 막으려는 단 하나다.

## git 규약

- 커밋: Conventional Commits — `feat|fix|docs|refactor|test|chore(scope)`. scope 는 워크스페이스 이름(`api`·`web`·`schema`·`deploy`), 문서 작업은 `docs:`.
- 구현 코드는 브랜치(`feat/…`·`fix/…`) + PR 필수, `main` 직접 push 금지([4.2](docs/04-mvp/codebase.md) §4.4). 문서 커밋은 현행 관례상 `main` 직접 커밋을 허용한다.
- PR 본문에 관련 Task ID(`TSK-…`)와 스펙 고정 ID(`SPC-…`·`REQ-…`)를 남긴다.

## 에이전트 행동 원칙

- **모르면 정본을 찾는다.** 문서 간 서술이 다르면 각 문서가 선언한 정본 관계를 따르고, 정본이 아닌 쪽을 정본에 맞춰 고친 뒤 그 사실을 보고한다.
- **임의 결정 금지.** 스택 변경·범위 조정·새 결정(D-번호·FR/NFR 추가)은 사람의 확인 없이 하지 않는다.
- **문서와 코드가 어긋나면 문서(명세)가 우선**이다 — 단, 문서 쪽 결함이 명백하면 코드를 문서에 끼워 맞추지 말고 먼저 문서 수정을 제안한다.
