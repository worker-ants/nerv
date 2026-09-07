# NERV — AI 에이전트 협업 개발 플랫폼

**스펙 문서를 단일 진실로 관리하고, Claude Code·Codex를 MCP·훅·스킬로 연동하며, 사람은 승인/거절/코멘트 게이트를 지키는 멀티 프로젝트 × 멀티 유저 플랫폼.**

파일 기반 1인용 SDD 하네스(clemvion)가 로컬 git 아키텍처의 상한에 막혀 포기한 것 — 다른 머신·세션의 스펙 충돌 검출, 살아 있는 세션 레지스트리, 리뷰 이력의 저장소 비대화 — 이 그대로 이 제품의 기능 목록이다. 근거와 실측은 [1.1 clemvion 분석](docs/01-problem/clemvion-analysis.md)·[1.2 문제 정의](docs/01-problem/pain-points.md)에 있다.

- 문서 22편(1~3부 13편 + 4부 MVP 명세 8편 + [용어 사전](docs/glossary.md)): [docs/README.md](docs/README.md) — 사람이 읽기 좋은 HTML 파생본은 [docs/html/index.html](docs/html/index.html)
- 에이전트 작업 규약 정본: [AGENTS.md](AGENTS.md) (Claude Code는 [CLAUDE.md](CLAUDE.md)가 이 파일을 import한다)
- 문서·커밋 메시지 언어는 **한국어**다.

## 저장소 구조 — 네 구역

| 구역 | 무엇이 있나 |
| --- | --- |
| [`docs/`](docs/) | 제안서·MVP 명세. **md가 원본, `docs/html/`은 파생본** — 한쪽만 고치면 결함이다. 문서 간 인용은 인라인 링크로, 역참조는 각 문서 frontmatter `referenced_by` 가 든다(도구가 계산한다 — [AGENTS.md](AGENTS.md) 문서 작업 규약 7) |
| [`codebase/`](codebase/) | 애플리케이션·패키지 코드. **pnpm 모노레포 루트가 여기다**(REQ-CB-015) — `pnpm`·`docker compose` 명령은 이 디렉터리에서 실행한다 |
| [`deploy/`](deploy/) | 배포 산출물 — compose · Dockerfile · nginx · kustomize(base/overlays) |
| 루트 | 이 README와 규약·메타 파일(`AGENTS.md`·`CLAUDE.md`·`.github/`·`LICENSE`·`NOTICE`)만 둔다 |

트리·배치의 정본은 [4.2 코드베이스와 배포](docs/04-mvp/codebase.md) §1이다.

### `codebase/` 워크스페이스

| 워크스페이스 | 무엇을 하나 |
| --- | --- |
| `apps/web` | Vite + React SPA — 홈·프로젝트·스펙·작업 보드·세션 모니터·**받은 요청**·리뷰 센터·설정, 제품 매뉴얼(`src/content/manual/`, ko·en 두 벌) |
| `apps/api` | NestJS(Fastify) — REST `/api/v1` · MCP 게이트웨이 · WebSocket · SSE · 훅 수집기. **표면 넷이 같은 도메인 서비스를 DI로 공유한다**(D-05) |
| `apps/cli` | `nerv import …` — 프로파일 기반 스펙 임포터. 컨테이너가 아니라 **원본 체크아웃이 있는 장비에 설치되는 클라이언트**다 |
| `packages/schema` | 타입·상수의 단일 정본 — drizzle 테이블 · zod · 이벤트 이름 · 에러 코드 · 문구 카탈로그. 상수를 다른 곳에 하드코딩하지 않는다 |
| `plugin` | Claude Code 플러그인 — 스킬 5종(`/nerv:next`·`/nerv:spec`·`/nerv:impl`·`/nerv:question`·`/nerv:review`) · hooks(기본은 `command` 변형) · statusline · Codex 초안. **`.mcp.json` 은 담지 않는다** — 서버 주소·토큰은 프로젝트마다 다르고 플러그인은 여러 프로젝트가 공유하는 물건이라, 그 파일은 쓰는 쪽 저장소가 갖는 템플릿이다(REQ-PLG-001) |

## 빠른 시작

Node 24 · pnpm 10 · Docker가 필요하다. 절차의 정본은 [4.2 §5.1](docs/04-mvp/codebase.md)이다.

```bash
cd codebase                     # 모노레포 루트는 codebase/ 다
corepack enable
cp .env.example .env            # 필수 3개만 채운다: POSTGRES_PASSWORD · MINIO_ROOT_PASSWORD · NERV_AUTH_SECRET
pnpm install
pnpm compose:up                 # postgres·minio·valkey(+embed) → migrate → api·worker → web
open http://localhost:8080      # 로그인 화면
```

HMR이 필요한 개발 루프는 인프라만 컨테이너로 띄우고 앱은 로컬 프로세스로 돈다:

```bash
pnpm compose:infra              # postgres · minio · valkey · embed 만
pnpm build                      # db:migrate·db:seed 는 빌드 산출물(dist)을 실행한다
pnpm db:migrate
pnpm db:seed                    # 개발 시드 — 로그인 자격증명도 함께 심는다
pnpm dev                        # 빌드 감시 + API(:8080) + 웹(:5173). 워커까지면 pnpm dev:all
```

시드 사용자는 `jimin`·`seoyeon`·`dohyun`·`yuna`·`hana`@example.com이고 비밀번호는 `nerv-dev-1234`다(`NERV_SEED_PASSWORD`로 바꾼다).

**구성요소를 따로 띄울 때도 `pnpm dev:api`·`dev:web`·`dev:worker`를 쓴다.** 워크스페이스의 `dev`를 직접 부르면 빌드 감시가 없어 `dist`만 보므로 소스를 고쳐도 아무 일이 일어나지 않는다.

## 자주 쓰는 명령 (전부 `codebase/`에서)

| 명령 | 내용 |
| --- | --- |
| `pnpm test` | L1 단위 — 전 워크스페이스 |
| `pnpm test:integration` | L2 통합 — **실제 Postgres 상대**. 무게중심이 여기다 |
| `pnpm test:e2e` | L3 — E2E 전용 스택을 띄우고 API 시나리오 A~E + 브라우저 |
| **`pnpm preflight`** | **push 전에 이것 하나.** CI 의 `check` 잡 여덟 단계를 같은 순서로 돈다(`--l2` 로 L2 까지) — [AGENTS.md](AGENTS.md) 구현 규약 7 |
| `pnpm hooks:install` | 위 검사를 push 때 자동으로 (옵트인 · 해제는 `-u`). **훅은 게이트가 아니다** — 진짜 게이트는 CI 다 |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` · `format:check` | eslint · `tsc -b` · prettier |
| `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` | 마이그레이션 생성·적용·시드 |
| `pnpm e2e:up` · `pnpm e2e:down` | E2E 전용 스택(세션마다 포트를 잡는다 — 개발 데이터를 건드리지 않는다) |
| `pnpm compose:up` · `compose:infra` · `compose:down` | 로컬 스택 |

## 스택

TypeScript · pnpm workspace / Vite + React SPA · TanStack Router·Query · Tailwind / NestJS(Fastify) · MCP TypeScript SDK / Postgres + Drizzle(FTS + pg_trgm + pgvector 하이브리드 검색) · better-auth · WebSocket + SSE(Valkey pub/sub 팬아웃) · TipTap · Cytoscape.js / Vitest + Playwright / docker-compose(로컬) · kustomize(운영).

**확정 스택은 재논의하지 않는다.** 정본과 결정일·재검토 트리거는 [4.1 MVP 범위와 스택 확정](docs/04-mvp/scope.md) §2다.

## 문서를 읽는 순서

구현에 착수한다면 4부만 읽어도 되도록 쓰였다 — [4.1 범위](docs/04-mvp/scope.md) → [4.2 코드베이스](docs/04-mvp/codebase.md) → [4.3 데이터베이스](docs/04-mvp/database.md) → [4.4 API](docs/04-mvp/api.md) → [4.5 화면](docs/04-mvp/screens.md) → [4.6 플러그인](docs/04-mvp/plugin.md) → [4.7 임포터](docs/04-mvp/importer.md) → [4.8 백로그](docs/04-mvp/backlog.md). **이 문서 세트만 보고 추가 질문 없이 첫 PR을 낼 수 있어야 한다**는 것이 4부의 목표 기준이다.

배경부터 읽는다면 [문제 정의](docs/01-problem/pain-points.md) → [비전](docs/03-proposal/vision.md) → [로드맵](docs/03-proposal/roadmap.md). 전체 목차는 [docs/README.md](docs/README.md)에 있다.

## 기여 규약

작업 규약의 정본은 [AGENTS.md](AGENTS.md)다. 사람도 에이전트도 같은 규약을 따른다. 요지만 옮기면:

- **정본(single source) 원칙** — 각 주제는 정본 문서 한 곳에서만 정의하고 나머지는 링크로 인용한다. 용어·상태값·결정 번호(D-01~14)·요구사항 번호(FR/NFR)는 [1.2 문제 정의](docs/01-problem/pain-points.md)가 단일 기준이다.
- **문서와 코드가 어긋나면 문서(명세)가 우선** — 단, 문서 쪽 결함이 명백하면 코드를 끼워 맞추지 말고 문서 수정을 먼저 제안한다.
- **경계 규칙** — `apps/*` 간 직접 import 금지(공유는 `packages/schema` 경유), 표면은 번역만 하고 판정은 도메인 서비스 한 곳에서, 상수·이벤트 이름·에러 코드는 `@nerv/schema`에서만 가져온다.
- **동시성은 mock으로 검증하지 않는다** — 클레임 원자성·scope 겹침·리스 만료는 L2(실제 Postgres)가 본다.
- **도움말은 변경과 같은 커밋에서 갱신한다** — 화면의 동작·상태값·단축키·CLI 명령·역할과 권한·기본값이 바뀌었는데 매뉴얼(`apps/web/src/content/manual/`, ko·en)이 그대로면 결함이다. 없는 문서는 사람을 헤매게 하지만 **틀린 문서는 확신을 준다**.
- **git** — Conventional Commits(`feat|fix|docs|refactor|test|chore(scope)`), 구현 코드는 브랜치 + PR이고 `main` 직접 push 금지. PR 본문에 Task 표시 키(`<PRJ>-T-…`)와 스펙 키·요구사항 ref 를 남긴다(접두는 프로젝트가 정한다 — [3.3](docs/03-proposal/data-model.md) §5.1).
- **임의 결정 금지** — 스택 변경·범위 조정·새 결정(D-번호·FR/NFR 추가)은 사람의 확인 없이 하지 않는다.

## 라이선스

[Apache License 2.0](LICENSE). 저작권 표기는 [NOTICE](NOTICE)에 있다.
