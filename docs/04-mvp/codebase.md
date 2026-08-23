---
id: SPC-MVP-CODEBASE
status: draft
updated: 2026-08-22
---
# 코드베이스와 배포

> **요약** — NERV MVP의 저장소 구조와 배포 산출물의 정본이다. **애플리케이션·패키지 코드 전체를 저장소 `codebase/` 하위에 두는** pnpm 모노레포(`apps/web` · `apps/api` · `apps/cli` · `packages/schema`)와 **저장소 루트의 배포 트리**(`deploy/compose` · `deploy/docker` · `deploy/k8s`)를 확정하고, REST·MCP·WebSocket·SSE·ingest 다섯 표면이 **같은 도메인 서비스를 DI로 주입받는** NestJS 모듈 맵(D-05의 실물)을 그린다. 실시간 팬아웃의 방송 버스는 **Valkey pub/sub**(`nerv_events`)다. 개발 환경은 docker-compose.yml 전문과 `.env` 변수 전표, 명령 순서로 "신규 장비에서 명령 몇 개로 로그인 화면까지" 도달하게 하고, 운영 배포는 Dockerfile 2종·kustomize base/overlays 트리·Deployment/Job/Ingress 스켈레톤(WebSocket 업그레이드·타임아웃, SSE 버퍼링 해제, 워커 replica 1, 마이그레이션 Job)으로 확정한다. 임포터 CLI(`apps/cli`)는 **컨테이너가 아니라 배포되는 클라이언트**다 — 원본 체크아웃이 있는 장비에서 돌며 서버에는 API로만 붙는다(§1.3). 행동 요구는 REQ-CB-001~021로 번호를 부여했다.
>
> 문서 버전 v1.2 · 2026-08-23 · HTML 판: [codebase.html](../html/codebase.html)
>
> v1.1 변경(2026-08-23): ① **문구 카탈로그와 로케일 §3.4 신설** — 웹·API·CLI 가 `@nerv/schema` 의 한 벌을 쓴다(ko 기본 · en). §1.2 의 "런타임 로직 없음"에 번역기 예외를 마이그레이터와 같은 등급으로 기록. 신설 요구 REQ-CB-022~024. ② **로컬 임베딩 프로필 이미지 교체**(§5.2a — TEI → ollama). TEI 가 arm64 이미지를 내지 않아 Apple Silicon 에서 기동되지 않는다(실측·점화 기록 §5.2a). 계약·모델·차원·외부 전송 0 은 그대로이고 바뀐 것은 개발자 기계에서 도는가뿐이다. 다른 결정·요구는 불변.
>
> v0.9 변경(2026-08-22 — 구현 중 확인 태스크 착지): **운영 Postgres 위치를 클러스터 외부로 확정**(§6.0 신설 — E06-S05). 근거는 NFR-01의 compose 자가호스팅과 운영 k8s가 같은 접속 모델을 써야 한다는 것이다. §6.5 백업 절차의 "관리형이면 ①을 스냅샷+PITR로 대체" 조건이 이 판정으로 확정됐다.
>
> v1.0 변경(2026-08-23 — 실행 중 발견): **L3 E2E 전용 compose 스택 분리**(§4.3 · §5.1 — `deploy/compose/docker-compose.e2e.yml`). 개발 스택을 공유하니 테스트가 개발 DB를 고치고(계정 15건 축적 실측) 실행 간 상태가 쌓였다. 다른 프로젝트 이름·다른 포트·tmpfs·시드 자동 적재로 분리하고, 개발 스택을 향해 돌면 거부하는 가드를 양쪽(웹·API)에 뒀다.
>
> v0.9 변경(2026-08-22 — 구현 착수 중 발견): **플러그인 패키지 배치 확정**(§1.1·§1.2 — `codebase/plugin/`). [4.6 플러그인과 온보딩](plugin.md) §1.1이 `nerv-plugin/` 트리를 정의하면서도 저장소 어느 구역에 두는지는 어느 문서도 말하지 않아 구현이 막혔다. REQ-CB-015의 2구역 규칙(코드 = `codebase/`, 배포 산출물 = `deploy/`)에서 플러그인은 **코드 구역**이다 — 에이전트 호스트에서 실행되는 규약·스크립트이지 이 시스템의 배포 산출물이 아니다. pnpm 워크스페이스로 등록하되 빌드는 없고, 문서 전문 대조 테스트(REQ-PLG-001)를 `pnpm test`에 태우는 것이 워크스페이스로 두는 유일한 이유다. 다른 결정·요구는 불변.
>
> v0.8 변경(2026-08-22 — **배포 산출물 위치 개정, REQ-CB-015 변경**): 배포 트리를 `codebase/deploy/`에서 **저장소 루트 `deploy/`**로 옮긴다. 근거: 배포 산출물은 pnpm 워크스페이스가 아니고(`pnpm-workspace.yaml` glob 밖) 저장소 전체의 운영 자산이라 "모노레포 루트 = `codebase/`"라는 한 가지 뜻과 섞이지 않는 편이 낫다. ① REQ-CB-015를 2구역 규칙으로 개정(코드 = `codebase/`, 배포 산출물 = `deploy/`) ② 경로 표기 기준 분리 — `apps/*`·`packages/*`는 `codebase/` 기준, `deploy/*`는 저장소 루트 기준(§1.1) ③ **이미지 빌드 컨텍스트를 저장소 루트로 통일**(§5.3 `context: ../..`) — 웹 이미지가 `codebase/` 소스와 `deploy/docker/nginx/` 템플릿을 함께 봐야 하기 때문. Dockerfile `COPY`에 `codebase/` 접두, 저장소 루트 `.dockerignore` 신설(§6.1) ④ compose 실행은 `codebase/`에서 `-f ../deploy/compose/...`(§5.1·§4.5), kustomize는 저장소 루트에서(§6.3). 다른 결정·요구는 불변.
>
> v0.7 변경(2026-08-22 — 임베딩 제공자 추상화, [4.1](scope.md) v0.7과 짝): 임베딩 호출을 **OpenAI 호환 `/v1/embeddings` 단일 계약**으로 전환 — 환경 프로필 §5.2a 신설(로컬 TEI / 스테이징 LM Studio / 운영 OpenAI), `NERV_EMBED_API_KEY` 추가, compose `embed`는 **로컬 프로필 전용**(profiles로 선택 기동), k8s `base/embed/`는 외부 제공자 오버레이에서 제외. REQ-CB-020 개정("자가호스팅만" 폐기 → 단일 계약 + env 결정), REQ-CB-021(1024차원 강제) 추가.
>
> v0.6 변경(2026-08-22 — 하이브리드 검색 MVP 확정, [4.1](scope.md) §2.1): ① 인프라 서비스 4종 — **`embed`(TEI + BGE-m3, 자가호스팅 임베딩 서빙)** 추가, postgres 이미지를 pgvector 동봉판(`pgvector/pgvector:pg17`)으로 교체 ② 워커 잡 `embedding.job.ts` 추가(§2.2) ③ `.env`에 `NERV_EMBED_URL`·`NERV_EMBED_MODEL`(§5.2) ④ k8s `base/embed/`(§6.2) ⑤ REQ-CB-020. **REQ-CB-017(빌드 이미지 3종)과 충돌 없음** — embed는 빌드 산출물이 아니라 postgres·valkey와 같은 기성 인프라 이미지다.
>
> v0.5 변경(2026-08-22): ① 테스트 러너 확정 반영(§4.3 — Vitest + Playwright, 결정 정본은 [4.1](scope.md) §2.1) ② **CI 파이프라인 전문 신설**(§4.5 — REQ-CB-007 스키마 드리프트 검사의 실행 실물, REQ-CB-018) ③ **백업·복구 절차 신설**(§6.5 — NFR-01·성공 기준 1-9의 실행 실물, REQ-CB-019) ④ 쿼터 상수 3종 추가(§3.2 — [4.4 API 명세](api.md) §1.8과 짝).
>
> v0.4 변경(2026-08-22): **`apps/cli`(`@nerv/cli`) 워크스페이스 신설**(§1.1·§1.3)과 `apps/api`의 `ImportModule`(§2.2·§2.3) — 임포터 실행 모델이 DB 직결에서 API 클라이언트로 확정된 데 따른 배치 확정([4.7 스펙 임포터](importer.md) §3.2). REQ-CB-016~018 추가.

---

## 1. 모노레포 구조

### 1.1 확정 트리 전문

언어·저장소 구조는 TypeScript + pnpm workspace로 확정됐다([3.2 시스템 아키텍처](../03-proposal/architecture.md) §4.1, 스택 확정 전문은 [4.1 MVP 범위와 스택 확정](scope.md)). Turborepo는 빌드 시간이 아플 때 도입한다 — 트리거만 기록하고 지금은 넣지 않는다.

**애플리케이션·패키지 코드는 저장소 루트가 아니라 `codebase/` 하위에 쓰고, 배포 산출물은 저장소 루트의 `deploy/`에 쓴다**(REQ-CB-015 — 2026-08-22 개정). 저장소 루트는 문서(`docs/`)·에이전트 규약(`AGENTS.md`·`CLAUDE.md`)·구현(`codebase/`)·배포(`deploy/`)의 네 구역으로 나뉘고, 모노레포 루트는 `codebase/`다.

경로 표기의 기준이 구역마다 다르다 — 이 문서를 포함한 전 문서에서 **`apps/*`·`packages/*`는 `codebase/` 기준 상대 경로**이고 **`deploy/*`는 저장소 루트 기준 상대 경로**다. `pnpm` 명령은 `codebase/`에서 실행하고(§5.1), `docker compose`는 `pnpm compose:*` 래퍼가 `-f ../deploy/compose/docker-compose.yml`로 가리키므로 역시 `codebase/`에서 실행한다. `kustomize`·`kubectl` 명령만 저장소 루트에서 실행한다(§6.3).

```text
nerv/                           # 저장소 루트 — 애플리케이션 코드 없음
  AGENTS.md                     # 에이전트 공통 작업 규약 (Codex·Claude Code 공용)
  .dockerignore                 # 이미지 빌드 컨텍스트(= 저장소 루트) 제외 목록 (§5.3·§6.1)
  CLAUDE.md                     # Claude Code 진입점 — @AGENTS.md import만 한다
  docs/                         # 이 제안서 원문 — NERV 가동 후 첫 임포트 대상 (4.7 스펙 임포터 §5)
  codebase/                     # ★ 구현 코드 전체 = 모노레포 루트 (REQ-CB-015)
    package.json                # 워크스페이스 스크립트 허브 (§5.1 명령 표)
    pnpm-workspace.yaml         # packages: ["plugin", "apps/*", "packages/*"]
    pnpm-lock.yaml
    .nvmrc                      # Node LTS 핀 — 로컬·CI·이미지가 같은 값을 쓴다 (REQ-CB-002)
    tsconfig.base.json          # strict 공통 옵션 (§4.1)
    eslint.config.js            # lint + import 경계 규칙 (§4.2)
    .prettierrc
    .env.example                # §5.2 전표의 실물 — 값 없는 키 목록 + 주석
    apps/
      web/                      # @nerv/web — Vite + React SPA (화면 명세는 4.5)
        index.html
        vite.config.ts          # dev proxy: /api·/mcp·/ingest·/ws·/sse → :8080 (§5.1)
        src/
          routes/               # TanStack Router 파일 라우트
          features/             # 화면 단위 모듈 (spec-editor · task-board · session-monitor …)
          components/           # 공용 UI — Tailwind + shadcn/ui 파생
          lib/                  # API 클라이언트 · WS 클라이언트 · 이벤트→쿼리 무효화 매핑
      api/                      # @nerv/api — NestJS(Fastify). REST·MCP·WS·SSE·ingest + 워커 엔트리 (§2)
        src/                    # 상세 트리는 §2.2
      cli/                      # @nerv/cli — 임포터 CLI. 원본 체크아웃이 있는 장비에서 실행 (§1.3)
        src/
          index.ts              # nerv import spec|plan|docs|rebuild-map 엔트리
          profiles/             # 내장 프로파일 — clemvion.yaml · nerv-docs.yaml (4.7 §1.4)
          parse/                # 스캔 · frontmatter · 요구사항 추출 · 링크 해소 (4.7 §2)
          report/               # report.md · report.jsonl · 매니페스트 (4.7 §3.3·§4.1)
          client/               # EP-IMP-01~05 HTTP 클라이언트 — PAT · Idempotency-Key 재시도
    packages/
      schema/                   # @nerv/schema — drizzle 테이블 · zod · 상수 · 이벤트 이름 · 에러 코드 (§3)
                                #   임포트 배치 · 프로파일 zod 스키마도 여기가 정본 (apps/api ↔ apps/cli 공유 계약)
    plugin/                     # @nerv/plugin — Claude Code 플러그인 패키지 (4.6 §1.1 전문의 실물)
      .claude-plugin/           #   plugin.json · marketplace.json
      .mcp.json                 #   MCP 서버 1개 (4.6 §3.3)
      hooks/hooks.json          #   훅 6종 — 텔레메트리 평면 (4.6 §3.1)
      skills/                   #   next · spec · impl · question · import (4.6 §2)
      agents/                   #   nerv-spec-writer — 코드 쓰기 도구 미보유
      bin/                      #   nerv-hook-forward(토큰 주입 폴백) · nerv-outbox(오프라인 큐)
      statusline/               #   nerv-statusline.sh — 네트워크 왕복 없음 (4.6 §3.2)
      plugin-package.spec.ts    #   문서 전문 대조 테스트 (REQ-PLG-001·003·006·008)
  deploy/                         # ★ 배포 산출물 — 저장소 루트 (REQ-CB-015, 2026-08-22 개정)
    compose/
      docker-compose.yml        # §5.3 전문 — 로컬·소규모 자가호스팅 정본
    docker/
      Dockerfile.server         # nerv-api · nerv-worker 이미지 (§6.1)
      Dockerfile.web            # nerv-web 이미지 (§6.1)
      nginx/
        default.conf.template   # §5.4 전문 — reverse-proxy · WebSocket 업그레이드 · SSE 버퍼링 해제 · /mcp Origin 1차 검증
    k8s/
      base/                     # §6.2 트리 — Deployment · Service · Job · Ingress
      overlays/
        dev/
        prod/
```

> **`deploy/`가 `codebase/` 밖인 이유**(2026-08-22 결정 — v0.1~v0.7의 `codebase/deploy/` 배치를 개정). 배포 산출물은 pnpm 워크스페이스가 아니다(`pnpm-workspace.yaml`의 glob `apps/*`·`packages/*` 밖). `codebase/`는 "모노레포 루트 = 노드 패키지들의 루트"라는 한 가지 뜻을 갖고, 저장소 전체를 어떻게 굴리느냐(compose·이미지·k8s)는 그 옆의 `deploy/`가 갖는다. 이미지 빌드 컨텍스트는 **저장소 루트**다(§5.3 `context: ../..`) — 세 이미지 모두 `codebase/`(소스)와 `deploy/docker/nginx/`(웹 이미지의 nginx 템플릿) 양쪽을 필요로 하므로 둘의 공통 조상이 유일한 일관 규칙이다. 그래서 Dockerfile 의 `COPY` 경로는 `codebase/` 접두를 갖고(§6.1), 컨텍스트 비대화는 저장소 루트 `.dockerignore` 가 막는다(`docs/`·`.git/`·`node_modules`·빌드 산출물 제외). 이 개정은 REQ-CB-015 한 줄과 경로 표기 기준·빌드 컨텍스트를 바꾸며, 다른 결정·요구는 건드리지 않는다.

### 1.2 패키지 책임

| 워크스페이스 | 패키지 이름 | 책임 | 하지 않는 일 |
| --- | --- | --- | --- |
| `apps/web` | `@nerv/web` | S1~S5·S7·S8 + 로그인 화면 렌더링, TipTap 에디터, WebSocket 구독 → TanStack Query 무효화 | 비즈니스 규칙 판정(전부 API에 위임 — [3.2](../03-proposal/architecture.md) §1.3) |
| `apps/api` | `@nerv/api` | REST + MCP + WebSocket + ingest 네 표면과 도메인 서비스, 워커 잡(같은 코드베이스, 엔트리 분리) | 스키마·타입 선언(`@nerv/schema`에서만 import) |
| `apps/cli` | `@nerv/cli` | 임포터 — 스캔·파싱·규칙 판정·리포트·매니페스트, EP-IMP-01~05 호출([4.7 스펙 임포터](importer.md) §3) | DB 접속(`DATABASE_URL` 미사용·DB 드라이버 미의존), 도메인 판정 |
| `packages/schema` | `@nerv/schema` | drizzle 테이블 선언, zod 스키마(임포트 배치·프로파일 포함), 도메인 상수·이벤트 이름·에러 코드, **문구 카탈로그와 번역기**(§3.4), 마이그레이션 파일 | 런타임 로직(순수 선언 + 마이그레이터 + 번역기만 — §3.4가 근거) |
| `plugin` | `@nerv/plugin` | 에이전트 호스트에 **배포되는 파일 묶음** — 스킬 5종·훅·MCP 설정·statusline·서브에이전트([4.6 플러그인과 온보딩](plugin.md) §1~§3 전문의 실물) | 빌드 산출물·런타임 코드(JS 번들 없음). 워크스페이스인 이유는 문서 대조 테스트를 `pnpm test`에 태우기 위해서다 |
| `deploy/*`(저장소 루트) | — | compose·Dockerfile·kustomize 산출물. 이 문서가 정본 | 애플리케이션 코드 |

의존 방향은 한쪽뿐이다: `apps/* → packages/schema`. `apps/web ↔ apps/api ↔ apps/cli` 간 직접 import는 금지하며 공유 계약(zod 스키마·타입·상수)은 전부 `@nerv/schema`를 거친다. `apps/cli`가 `apps/api`의 서비스를 import하지 않는다는 것이 REQ-CB-001의 적용례다 — CLI는 API의 클라이언트일 뿐 같은 프로세스가 아니다.

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-001** | WHEN `apps/*`의 코드가 다른 워크스페이스를 import할 때, THE SYSTEM SHALL `packages/*`만 허용하고 `apps/*` 간 import는 lint 에러로 차단한다(`eslint.config.js`의 `no-restricted-imports`). |
| **REQ-CB-002** | WHEN 로컬·CI·컨테이너 이미지가 Node/pnpm을 결정할 때, THE SYSTEM SHALL `.nvmrc`(Node LTS)와 루트 `package.json`의 `packageManager` 필드를 단일 정본으로 사용한다 — 버전이 세 곳에서 달라지는 순간이 결함이다. |
| **REQ-CB-015** | (2026-08-22 개정) WHEN 애플리케이션·패키지 코드와 그 스크립트가 저장소에 추가될 때, THE SYSTEM SHALL 저장소 루트의 `codebase/` 하위에만 배치한다. WHEN 배포 산출물(compose·Dockerfile·nginx 템플릿·kustomize)이 추가될 때, THE SYSTEM SHALL 저장소 루트의 `deploy/` 하위에 배치한다 — `docs/`에는 문서와 그 파생물(html)만, 저장소 루트에는 이 두 구역과 에이전트 규약 파일(`AGENTS.md`·`CLAUDE.md`)·저장소 메타 파일만 둔다. |

`pnpm-workspace.yaml` 전문:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 1.3 `apps/cli` — 컨테이너가 아니라 배포되는 클라이언트

임포터는 서버 옆이 아니라 **원본 파일 옆**에서 돈다. 운영 환경의 서버는 임포트 대상 저장소의 체크아웃에 접근할 수 없으므로(근거·전문은 [4.7 스펙 임포터](importer.md) §3.2), CLI는 이미지·Job이 아니라 실행 장비에 설치되는 산출물이다.

| 항목 | 확정 |
| --- | --- |
| 배포 형태 | `pnpm --filter @nerv/cli build` 산출물을 사내 npm 레지스트리에 게시(`npm i -g @nerv/cli`) 또는 tarball 직접 설치. 컨테이너 이미지·k8s Job으로 만들지 않는다 |
| 실행 위치 | 원본 체크아웃이 있는 장비 — 이관 담당자 워크스테이션·CI 러너 |
| 서버 접속 | `--server` + `import:write` 스코프 PAT(`--token`/env `NERV_TOKEN`). `DATABASE_URL`은 쓰지 않는다 |
| 원본 접근 | READ-ONLY. 임포터는 대상 저장소에 어떤 쓰기도 하지 않는다 |
| dry-run | 서버·네트워크 없이 완주(REQ-IMP-011) — CI에서 스펙 저장소 PR 검사로도 쓸 수 있다 |

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-016** | WHEN `apps/cli`가 빌드될 때, THE SYSTEM SHALL DB 드라이버(`pg`·drizzle 런타임)와 `apps/api` 코드를 의존성에서 제외하고 `@nerv/schema`의 타입·zod 스키마만 참조한다 — 임포터가 DB에 직접 붙는 경로를 컴파일 단계에서 없앤다. |
| **REQ-CB-017** | WHEN 운영 배포 산출물을 만들 때, THE SYSTEM SHALL 컨테이너 이미지를 `nerv-api`·`nerv-worker`·`nerv-web` 3종으로 유지하고 임포터용 이미지·k8s Job을 만들지 않는다. |

---

## 2. `apps/api` — 표면 5종이 같은 도메인 서비스를 공유한다 (D-05)

### 2.1 원칙 — 게이트 판정이 표면마다 갈라지는 것이 최악의 실패

REST·MCP·WebSocket·SSE가 **같은 도메인 서비스를 DI로 공유**한다(D-05, [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) §1). NestJS를 택한 이유가 이 구조의 강제였다([3.2](../03-proposal/architecture.md) §4.2). 표면(컨트롤러·게이트웨이)은 **번역만** 한다 — 인증 컨텍스트 추출, 입력의 zod 검증, 도메인 서비스 호출, 응답 포맷 변환. 상태 전이 규칙·게이트 판정·겹침 검사는 도메인 서비스 한 곳에만 있다.

```mermaid
flowchart TB
  subgraph SURF["표면 5종 — 번역만, 규칙 없음"]
    REST["REST 컨트롤러<br/>/api/v1/*"]
    MCP["MCP 게이트웨이<br/>POST /mcp · nerv_* 도구 16종"]
    WS["WS 게이트웨이<br/>/ws · 룸 join"]
    SSE["SSE 스트림<br/>GET /sse/* · 단방향"]
    ING["ingest 컨트롤러<br/>/ingest/hooks/* 5종"]
  end
  subgraph DOM["도메인 모듈 — 상태 전이·게이트 판정의 단일 구현"]
    SS["SpecService"]
    TS["TaskService · ClaimService"]
    SES["SessionService · ActivityService"]
    AP["ApprovalService · QuestionService"]
    EV["EventService"]
  end
  PG[("Postgres<br/>스키마 정본: packages/schema")]
  VK[("Valkey<br/>nerv_events pub/sub")]
  SUB["EventSubscriberService<br/>파드별 SUBSCRIBE nerv_events"]

  REST --> SS
  REST --> TS
  REST --> SES
  REST --> AP
  REST --> EV
  MCP --> SS
  MCP --> TS
  MCP --> SES
  MCP --> AP
  ING --> SES
  SS --> EV
  TS --> EV
  SES --> EV
  AP --> EV
  EV -->|"같은 트랜잭션에 event 행"| PG
  EV -->|"커밋 후 PUBLISH"| VK
  VK -->|"파드별 구독"| SUB
  SUB -->|"자기 파드의 소켓에만 emit"| WS
  SUB -->|"자기 파드의 스트림에만 송신"| SSE
```

팬아웃 경로가 곧 무상태 수평 확장의 근거다: **모든 emit의 원천이 Valkey `nerv_events` 방송**이므로(MQ — 확정 스택, [4.1 MVP 범위와 스택 확정](scope.md) §2) 파드마다 `SUBSCRIBE`를 걸면 크로스파드 socket.io 어댑터 없이 각 파드가 자기에게 붙은 WS 소켓·SSE 스트림에 밀어줄 수 있고, socket.io는 websocket 전송만 활성화해(폴링 폴백 off) k8s 스티키 세션이 필요 없다. 재연결 시 클라이언트는 화면 데이터를 재조회한다 — 이벤트 유실은 허용하고 진실은 DB다(D-14). 방송 채널 이름(`nerv_events`)과 페이로드 규약의 정본은 [4.3 데이터베이스 스키마](database.md) §3이다.

### 2.2 `apps/api/src` 트리 전문

```text
apps/api/src/
  main.ts                        # HTTP 엔트리 — Nest(Fastify) 부트스트랩: REST + MCP + WS + SSE + ingest
  worker.ts                      # 워커 엔트리 — 같은 AppModule 조립에서 HTTP 표면 제외, 잡 러너만 (REQ-CB-005)
  migrate.ts                     # drizzle 마이그레이션 적용 후 종료 — compose 기동·k8s Job 공용 엔트리 (§5.3·§6.3)
  app.module.ts
  common/                        # 횡단 관심사 — 가드 · 인터셉터 · 필터
    auth.guard.ts                # 세션 쿠키(better-auth) / PAT Bearer 2경로 판별
    project-scope.interceptor.ts # 요청 컨텍스트의 project_id 자동 주입 — 스코프 없는 질의 컴파일 불가 원칙
    mcp-origin.guard.ts          # /mcp Origin 검증의 최종 강제 지점 (REQ-CB-013)
    nerv-exception.filter.ts     # NERV_* 에러 코드 ↔ HTTP 상태 매핑 (코드 정본: @nerv/schema, §3.2)
  modules/
    auth/                        # AuthModule
      auth.module.ts
      auth.service.ts            # better-auth(organization·api-key 플러그인) 래핑, 멤버십·역할 조회
      auth.controller.ts         # REST — 조직 · 프로젝트 · 멤버 · 토큰(S8)
    spec/                        # SpecModule
      spec.module.ts
      spec.service.ts            # 초안 upsert · base_version 전제조건 · 편집 리스 · 전이 · 사전 검토
      spec-comment.service.ts
      baseline.service.ts        # 베이스라인 동결·조회 · as-of/baseline manifest (spec-workflow §3.6, REQ-API-015)
      spec.controller.ts         # REST — tree · get · 버전 · draft · check · submit · 코멘트 · baselines · manifest
      spec.tools.ts              # MCP — nerv_spec_* 7종 (§2.3 표)
    task/                        # TaskModule
      task.module.ts
      task.service.ts            # 상태 전이 · 위임 명세 · 증적(evidence)
      claim.service.ts           # 원자적 클레임 · scope 겹침 검사 · 리스 연장 (D-04)
      task.controller.ts
      task.tools.ts              # MCP — nerv_task_* 5종
    session/                     # SessionModule
      session.module.ts
      session.service.ts         # AgentSession 수명주기 (pending→active→…)
      activity.service.ts        # Activity 적재
      session.controller.ts      # REST — 보드 · 상세 · activity
      session.tools.ts           # MCP — nerv_bootstrap · nerv_session_event
      ingest.controller.ts       # POST /ingest/hooks/{session,tool,subagent,stop,session-end}
    approval/                    # ApprovalModule
      approval.module.ts
      approval.service.ts        # 승인함 — 결정 · 지시자≠승인자 검사
      question.service.ts        # 질문 생성 · 폴링 · awaiting_input 전이
      approval.controller.ts
      question.tools.ts          # MCP — nerv_question_create
    import/                      # ImportModule — EP-IMP-01~05 (4.4 §2.10). 소급 적재 전용 경로
      import.module.ts
      import.service.ts          # 자연 키 대조 · 배치 upsert · 전이 검사 우회(이 모듈에서만) · import.applied 이벤트
      import.controller.ts       # REST — preflight · specs · tasks · links · map
    review/                      # ReviewModule — 테이블·서비스 골격은 MVP 스키마에 포함, 도구 2종은 P2
      review.module.ts
      review.service.ts
    event/                       # EventModule
      event.module.ts
      event.service.ts           # event 행 삽입(도메인 트랜잭션 안) + 커밋 후 Valkey PUBLISH (REQ-CB-004)
      notification.service.ts
      event.controller.ts        # REST — 이벤트 피드 · 알림
      ws.gateway.ts              # @WebSocketGateway(socket.io) — project:{id} · user:{id} 룸, join 시 멤버십 검사
      sse.controller.ts          # GET /sse/projects/{p} · /sse/me — text/event-stream 단방향 (4.4 §3.5)
      valkey.service.ts          # Valkey 클라이언트 provider — PUBLISH·SUBSCRIBE 공용 커넥션 관리
      event-subscriber.service.ts # 파드별 SUBSCRIBE nerv_events → 자기 소켓·SSE 스트림 emit
  mcp/
    mcp.controller.ts            # POST /mcp — Streamable HTTP, 신·구 리비전 병행 협상
    tool-registry.ts             # modules/**/*.tools.ts 수집 · zod 입력 검증 · idempotency_key 공통 처리
  worker/
    worker.module.ts
    advisory-lock.ts             # pg_advisory_lock — 잡 루프 단일 실행 보장 (REQ-CB-011)
    jobs/
      lease-reaper.job.ts        # 만료 리스 회수 — claimed → ready
      session-stale.job.ts       # 무활동 30분(STALE) 세션 전이 + 클레임 회수 (D-13)
      notification.job.ts        # event → notification 라우팅 (인앱, Slack·메일은 P2)
      export.job.ts              # md 미러 (P1 후반) · read-only git export 는 P2 — M2 컷오버 (scope.md §5)
      retention.job.ts           # blob TTL 30일 · Activity 보존 정책 집행
      embedding.job.ts           # 검색 인덱스 — 헤딩 청크 임베딩 upsert·구판 정리 (4.3 §2.15, REQ-DB-017)
```

**ingest는 별도 프로세스가 아니라 컨트롤러다.** [3.2](../03-proposal/architecture.md) §4.4의 compose 그림은 `nerv-ingest`를 별도 서비스로 뒀지만, MVP 배포 단위는 이미지 3종(`nerv-api`·`nerv-worker`·`nerv-web`)으로 확정한다([4.1 MVP 범위와 스택 확정](scope.md)). ingest는 `SessionModule`의 컨트롤러로 `nerv-api`에 실리되 모듈 경계가 분리돼 있으므로, 훅 볼륨이 API 지연에 영향을 주는 시점(재검토 트리거)에 같은 이미지의 별도 Deployment로 뗀다 — 코드 변경 없이 라우팅만 바뀐다.

### 2.3 모듈 ↔ 테이블 ↔ 도구 ↔ 표면 대응표

테이블 이름의 의미 정본은 [3.3 데이터 모델](../03-proposal/data-model.md), DDL 정본은 [4.3 데이터베이스 스키마](database.md), 도구 정의 정본은 [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) §2, REST 경로 정본은 [4.4 API 명세](api.md)다. 이 표는 배치만 확정한다.

| Nest 모듈 | 소유 테이블 (29종 전수 배정) | MCP 도구 (Phase) | REST 프리픽스 |
| --- | --- | --- | --- |
| `AuthModule` | `organization` `user` `project` `membership` `api_token` | — | `/api/v1/auth` · `/api/v1/orgs` · `/api/v1/projects` |
| `SpecModule` | `spec` `spec_version` `requirement` `requirement_version` `spec_relation` `spec_comment` `change_request` `spec_baseline` `spec_baseline_item` | `nerv_spec_tree` `nerv_spec_search` `nerv_spec_get`(P0) · `nerv_spec_draft_upsert` `nerv_spec_submit_review` `nerv_spec_check` `nerv_spec_comment_resolve`(P1) | `…/projects/{p}/specs` · `…/projects/{p}/baselines` |
| `TaskModule` | `task` `task_dependency` `claim` `evidence` | `nerv_task_next` `nerv_task_claim` `nerv_task_heartbeat` `nerv_task_release`(P0) · `nerv_task_update`(P1) | `…/projects/{p}/tasks` |
| `SessionModule` | `agent_session` `activity` | `nerv_bootstrap`(P0) · `nerv_session_event`(P1) | `…/projects/{p}/sessions` + `/ingest/hooks/*` |
| `ApprovalModule` | `approval` `question` | `nerv_question_create`(P1) | `…/projects/{p}/approvals` · `…/questions` |
| `ReviewModule` | `review_session` `reviewer_report` `finding` `finding_occurrence` `resolution` | (P2 — `nerv_review_submit` `nerv_finding_resolve`) | (P2) |
| `EventModule` | `event` `notification` | — | `…/projects/{p}/events` + WebSocket · SSE(`/sse/*`) |
| `ImportModule` | (소유 테이블 없음 — Spec·Task 계열에 소급 적재) | — (도구 없음 — [4.7 스펙 임포터](importer.md) §3.6) | `…/projects/{p}/import/*` |

`ImportModule`은 테이블을 소유하지 않고 `SpecModule`·`TaskModule`의 저장 계층에 소급 적재만 한다 — 그래서 29종 배정은 변하지 않는다. 워크플로 전이 검사 우회가 이 모듈에서만 열린다는 것이 그 대가이며, admin + `import:write` 스코프가 그 문을 지킨다([4.4 API 명세](api.md) §2.10).

합계 검산: MVP 도구 = P0 8종 + P1 8종 = **16종**, 리뷰 2종은 P2(카탈로그 총 17종 — [3.4](../03-proposal/agent-integration.md) §2.3). 베이스라인은 새 도구 없이 기존 도구의 입력 확장(`nerv_spec_get`의 `baseline`)과 REST(EP-SPEC-11~14)로 노출된다. 테이블 5+9+4+2+2+5+2 = **29종**.

### 2.4 표면별 규약

| 표면 | 진입점 | 인증 | 비고 |
| --- | --- | --- | --- |
| REST | `/api/v1/*` | better-auth 세션 쿠키(웹) 또는 PAT Bearer | 계약 전표는 [4.4 API 명세](api.md) |
| MCP | `POST /mcp` | PAT Bearer(MVP) — OAuth 2.1은 Phase 2 | Streamable HTTP, 2026-07-28 리비전 + 구 리비전 병행([3.2](../03-proposal/architecture.md) §4.3). Origin 검증은 `mcp-origin.guard.ts`가 최종 강제(REQ-CB-013) — 전단 nginx는 1차 차단일 뿐이다 |
| WebSocket | `/ws` | 핸드셰이크에서 세션 쿠키 검증 | socket.io 어댑터를 `path: "/ws"`로 설정한다(계약 정본 [4.4 API 명세](api.md) §3.1 — 어댑터 기본 경로 `/socket.io`를 쓰지 않는다). websocket 전송만. 룸 `project:{id}`·`user:{id}`, join 시 멤버십 검사. 웹 SPA 전용 |
| SSE | `GET /sse/projects/{p}` · `GET /sse/me` | 세션 쿠키 또는 PAT Bearer | 단방향 `text/event-stream` — 브라우저 밖 소비자(CLI·외부 도구)용 구독 채널. replay 없음(D-14), 계약 정본은 [4.4 API 명세](api.md) §3.5 |
| ingest | `POST /ingest/hooks/*` | PAT Bearer(`Authorization` 헤더) — 토큰 없는 이벤트는 버린다 | 202 즉시 응답 후 적재. `Stop` 훅만 동기 판정 경로([3.2](../03-proposal/architecture.md) §1.3) |

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-003** | WHEN 같은 상태 전이(예: draft 저장, 클레임, done 시도)가 REST와 MCP 어느 표면에서 호출되든, THE SYSTEM SHALL 동일한 도메인 서비스 메서드 하나를 실행한다 — 표면 코드에 조건 분기·게이트 규칙이 들어가면 결함이다. |
| **REQ-CB-004** | WHEN 도메인 서비스가 상태 전이 트랜잭션을 커밋할 때, THE SYSTEM SHALL 같은 트랜잭션 안에서 `event` 행을 삽입하고 커밋 후에 Valkey `nerv_events` 채널로 PUBLISH한다(채널·페이로드 정본: [4.3](database.md) §3). |
| **REQ-CB-005** | WHEN `worker.ts` 엔트리로 기동되면, THE SYSTEM SHALL HTTP 리스너를 열지 않고 잡 러너만 구동한다 — 워커가 트래픽을 받는 순간 replica 1 규칙(§6.3)이 무의미해진다. |

---

## 3. `packages/schema` — 타입·상수의 단일 정본

### 3.1 구조

```text
packages/schema/
  package.json                   # @nerv/schema — sideEffects: false
  drizzle.config.ts              # drizzle-kit 설정 — out: ./drizzle
  drizzle/                       # 생성된 SQL 마이그레이션 (0000_init 스냅샷부터, 정본: 4.3 §1)
  src/
    index.ts
    enums.ts                     # pgEnum 선언 — 문서 상태 · Task 상태 · 세션 상태 · severity … (정본: 3.3)
    tables/                      # 29개 테이블 drizzle 선언 — §2.3 모듈 소유와 같은 분할
      tenancy.ts                 #   organization · user · project · membership · api_token
      spec.ts                    #   spec · spec_version · requirement · requirement_version · spec_relation · spec_comment · change_request · spec_baseline · spec_baseline_item
      task.ts                    #   task · task_dependency · claim · evidence
      session.ts                 #   agent_session · activity
      review.ts                  #   review_session · reviewer_report · finding · finding_occurrence · resolution
      approval.ts                #   approval · question
      event.ts                   #   event · notification
    zod/                         # 요청·응답·도구 입력 zod 스키마 — REST(4.4)와 MCP가 같은 것을 쓴다
    constants.ts                 # §3.2 상수 전표
    events.ts                    # 이벤트 이름 리터럴 유니온 — `<리소스>.<동사>` (정본: 3.5 §6)
    errors.ts                    # NERV_* 에러 코드 리터럴 유니온 (정본: 3.4 §2.7)
    i18n/                        # §3.4 문구 카탈로그 — 웹·API·CLI 공용
      ko.ts                      #   원본(키 집합의 정본) · en.ts 는 같은 키를 타입으로 강제받는다
      translator.ts              #   자리표시자 치환 + 타입 (순수 함수)
      locale.ts                  #   Accept-Language 협상
      domain.ts                  #   이벤트·상태값 → 문구 키 파생
    migrate.ts                   # drizzle 마이그레이터 — apps/api/src/migrate.ts 가 호출
    migrate-entry.ts             # `@nerv/schema/migrate` 서브패스 — 배럴에서 분리한 이유는 아래
```

**배럴(`@nerv/schema`)은 브라우저에서 평가된다** — `apps/web` 이 상수·에러 코드·이벤트 이름·문구를 거기서 가져오기 때문이다. 그래서 마이그레이터·시드는 배럴에서 내보내지 않고 `@nerv/schema/migrate` 서브패스로 뺀다(2026-08-23). 그 둘은 `pg` 드라이버를 import 하고, 배럴이 재수출하면 **브라우저가 Postgres 드라이버를 평가한다** — 웹 dev 서버가 `Buffer is not defined` 로 아무것도 렌더하지 못했다(실측). 프로덕션 번들은 tree-shaking 이 지워 줘서 증상이 안 보였고, **빌드가 살려 주는 실수는 개발 루프에서만 터진다** — 그래서 경계를 패키지 표면(`exports` 맵)에 박는다.

파생 타입 공유 규칙: 테이블 행 타입은 drizzle 선언에서(`InferSelectModel`), API·도구 입출력 타입은 zod 스키마에서(`z.infer`) 파생한다. **손으로 쓴 중복 인터페이스는 금지**다 — 웹 폼(react-hook-form + zod)·REST 컨트롤러·MCP 도구 레지스트리가 전부 `@nerv/schema`의 같은 zod 객체를 import하므로, 검증 규칙이 표면마다 갈라질 수 없다.

### 3.2 상수 전표 (`constants.ts`)

수치의 정본은 각 열의 문서다. 코드에서는 이 파일 외의 하드코딩을 금지한다.

| 상수 | 값 | 근거 정본 |
| --- | --- | --- |
| `LEASE_TTL_SECONDS` | `1800` (30분) | Task 클레임·초안 편집 리스 동일 상수 — [3.4](../03-proposal/agent-integration.md) §2.7 |
| `HEARTBEAT_INTERVAL_SECONDS` | `60` | [3.4](../03-proposal/agent-integration.md) §2.3 `nerv_task_heartbeat` |
| `SESSION_STALE_SECONDS` | `1800` (30분) | 리스 TTL과 같은 값으로 묶는 이유는 [3.4](../03-proposal/agent-integration.md) §5.2 |
| `REVIEW_PROMPT_BLOB_TTL_DAYS` | `30` | [3.2](../03-proposal/architecture.md) §2.5 |
| `EVENTS_CHANNEL` | `'nerv_events'` | Valkey pub/sub 방송 채널 — [4.3 데이터베이스 스키마](database.md) §3 |
| `WORKER_ADVISORY_LOCK_KEY` | 프로젝트 전역 단일 키(bigint 리터럴 1개) | §6.3 — 워커 단일 실행 |
| `RATE_LIMIT_PAT_PER_MIN` | `300` | [4.4 API 명세](api.md) §1.8 — PAT 토큰당, `/api/v1` + `/mcp` 공용 풀 |
| `RATE_LIMIT_WEB_PER_MIN` | `600` | 같은 곳 — 웹 세션 사용자당 |
| `RATE_LIMIT_INGEST_PER_MIN` | `120` | 같은 곳 — 세션당 `/ingest/hooks/*`. 셋 다 시작값 — 파일럿 실측(정상 트래픽 429)이 재검토 트리거 |

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-006** | WHEN 도메인 상수·이벤트 이름·에러 코드·검증 스키마가 코드에서 필요할 때, THE SYSTEM SHALL `@nerv/schema`의 선언만 import한다 — `apps/*` 안에서의 재선언·하드코딩은 lint로 차단한다. |
| **REQ-CB-007** | WHEN `src/tables/*` 선언이 변경된 PR이 열리면, THE SYSTEM SHALL 같은 PR에 `drizzle-kit generate` 산출물(`drizzle/*.sql`)을 포함하며, CI가 "스키마 변경 있음 + 마이그레이션 없음"을 실패로 판정한다. |

### 3.4 문구 카탈로그와 로케일 (2026-08-23 신설)

**표면 셋이 한 벌의 카탈로그를 쓴다.** 웹·API·CLI 가 각자 문구를 들고 있으면 같은 사건이
표면마다 다르게 불리고(에러 봉투의 `message` 와 화면의 토스트가 다른 말을 한다), 번역도 세 번
해야 한다. 그래서 카탈로그는 `packages/schema/src/i18n/` 에 있다.

§1.2 가 이 패키지에 "런타임 로직 없음"을 못박았는데, 번역기는 그 예외다 — 마이그레이터와 같은
등급으로 기록한다. 근거: 자리표시자 치환뿐인 순수 함수이고(I/O·상태 없음), 카탈로그 자체는
순수 선언이며, **그 둘이 붙어 있어야 키가 실재하는지 타입이 검사할 수 있다**.

| 지원 로케일 | 기본값 | 비고 |
| --- | --- | --- |
| `ko` · `en` | `ko` | `ko` 가 문구의 원본이자 키 집합의 정본. `en` 은 `Catalog<typeof ko>` 로 같은 키를 강제받는다 |

**로케일은 표면마다 다르게 정해진다.** 셋 다 같은 협상 함수(`negotiateLocale`)를 쓴다.

| 표면 | 어디서 오나 |
| --- | --- |
| 웹 | 사용자가 고른 값(`localStorage`) → `navigator.languages` → 기본값. 고른 값이 브라우저 언어를 이긴다 |
| API · MCP | 요청의 `Accept-Language`(q 값 존중, `ko-KR` → `ko`). 없거나 모르는 언어면 기본값 |
| CLI | `NERV_LANG` → `LC_ALL` → `LC_MESSAGES` → `LANG`. 서버 없이도 도는 명령이라 헤더가 없다 |

**번역하지 않는 것 셋.** ① 식별자(`spec.approved`·`ready`·`NERV_FORBIDDEN`) — 데이터이고 로그이고
API 값이라 로케일마다 달라지면 화면과 기록이 갈라진다. 번역되는 것은 그 옆의 라벨이다.
② 운영자용 로그·설정 오류 — 저장소 언어(한국어)로 고정한다. ③ DB 에 저장되는 콘텐츠 —
쓰는 시점의 로케일이 데이터에 굳는다.

**로케일을 모르는 자리는 키를 들고 있는다.** 도메인 서비스가 에러를 던지는 순간에는 요청
로케일을 모른다. 알아야 한다면 판정과 표현이 한 서비스에 섞이고, 그것이 D-05 가 금지하는
것이다. 그래서 `NervError` 는 문장이 아니라 `Message`(키 + 값)를 들고, 문장은 로케일을 아는
표면(HTTP 예외 필터·화면)이 마지막에 만든다. 같은 이유로 MCP 도구 정의는 `summaryKey` 를,
zod 스키마의 검증 메시지는 키를 담는다.

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-022** | WHEN 사용자·에이전트에게 보이는 문구가 코드에서 필요할 때, THE SYSTEM SHALL `@nerv/schema` 카탈로그의 키로만 참조한다 — 표면 코드의 문장 하드코딩을 금지한다(예외: 운영자용 로그·설정 오류). |
| **REQ-CB-023** | WHEN 카탈로그에 키가 추가되면, THE SYSTEM SHALL 모든 로케일이 같은 키 집합과 같은 자리표시자를 갖도록 강제한다 — 키 집합은 타입으로, 자리표시자는 테스트로 검사한다. |
| **REQ-CB-024** | WHEN 요청이 `Accept-Language` 를 실어 오면, THE SYSTEM SHALL 응답 봉투의 `message` 와 MCP 도구 설명을 그 로케일로 만든다. 협상에 실패하면 기본 로케일로 떨어지며, 그 실패가 오류가 되지 않는다. |

---

## 4. 컨벤션

### 4.1 TypeScript

`tsconfig.base.json`은 전 워크스페이스가 extends한다. 핵심 옵션: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"verbatimModuleSyntax": true`. 완화는 파일 단위 주석이 아니라 워크스페이스 tsconfig에서만, 사유 주석과 함께 한다.

### 4.2 lint · format

- ESLint(flat config) + Prettier. 규칙 조정은 루트 한 곳에서만.
- 경계 규칙 2종을 lint로 강제한다: ① `apps/*` 간 import 금지(REQ-CB-001) ② `apps/*` 안에서 도메인 상수·이벤트 이름 리터럴 하드코딩 금지(REQ-CB-006 — `no-restricted-syntax`로 `NERV_`·이벤트 이름 패턴 검사).
- 표면 파일(`*.controller.ts`·`*.tools.ts`·`*.gateway.ts`)에서 drizzle 객체 직접 import 금지 — 표면은 서비스만 호출한다(REQ-CB-003의 lint 표현).

### 4.3 테스트 3계층

#### L3은 전용 스택에서 돈다 (2026-08-23 분리)

E2E는 개발 스택과 **완전히 분리된 compose 파일**(`deploy/compose/docker-compose.e2e.yml`)에서 실행한다. 처음에는 개발 스택을 그대로 썼는데 두 가지가 깨졌다 — 실측이다.

| 증상 | 원인 |
| --- | --- |
| 개발 DB에 테스트 계정 15건이 쌓였다 | E2E가 실제로 가입·로그인·수정을 한다. 대상이 개발 스택이면 사람이 쓰던 데이터가 조용히 바뀐다 |
| 실행 간에 결과가 달라졌다 | 앞 실행이 만든 계정·소비한 인증 쿼터(§1.8)가 다음 실행의 전제를 바꾼다 |

분리의 실물은 넷이다.

1. **다른 프로젝트 이름**(`nerv-e2e-<세션>`) — 컨테이너·네트워크·볼륨이 갈린다. 개발 스택과 **동시에** 떠 있어도 서로를 모른다.
2. **다른 포트** — E2E 전용 대역 `19000~19999`(전부 127.0.0.1 한정). 개발 스택의 고정 포트(5432·6379·8080·8090·9000·9001)와 겹치지 않는다.
3. **tmpfs 저장소** — 영속이 없다. `pnpm e2e:down`이 곧 초기화이고, `up`은 언제나 빈 DB에서 시작한다. `fsync=off`도 함께 켠다(테스트 DB는 크래시 복구가 필요 없다).
4. **시드까지가 기동이다** — `migrate → seed → api` 순서를 compose가 강제하고 `--wait`가 완료를 기다린다. 테스트가 스스로 픽스처를 만들면 실행 순서에 따라 결과가 달라진다.

#### 이름과 포트는 세션마다 다르다 (2026-08-23)

한 기계에서 **여러 세션이 동시에** E2E를 돌린다(에이전트 다중 세션·worktree 병렬 작업). 프로젝트 이름과 포트가 고정이면 둘째 세션이 첫째의 컨테이너를 재사용하거나(같은 이름) 기동에 실패한다(같은 포트) — 둘 다 남의 테스트를 조용히 깨뜨린다. 앞의 8090 충돌(개발 `embed` ↔ E2E 웹)도 같은 뿌리다.

할당은 `codebase/scripts/e2e-stack.mjs`가 한다. 규칙 넷:

- **슬롯 단위 할당** — 대역 `19000~19999`를 10씩 끊어 한 세션이 연속 3포트(웹·PG·Valkey)를 쓴다. 100세션까지 자리가 있다.
- **같은 작업 트리는 같은 포트** — 슬롯의 시작점을 트리 경로 해시로 정한다. 재기동마다 주소가 바뀌면 열어 둔 브라우저 탭과 로그가 낡는다. `NERV_E2E_ID`로 명시 지정할 수 있다.
- **잡기 전에 비었는지 본다** — 해시 자리가 이미 차 있으면 다음 빈 슬롯으로 넘어간다. 대역이 꽉 차면 조용히 겹치지 않고 실패한다.
- **할당값은 파일에 남는다**(`codebase/.e2e/<id>.json`, git 무시). `up`·`test:e2e`·`logs`·`down`이 같은 파일을 읽으므로 명령이 나뉘어도 같은 스택을 가리킨다. 포트를 사람이 옮겨 적는 자리를 만들지 않는다.

| 명령 | 하는 일 |
| --- | --- |
| `pnpm e2e:up` | 슬롯 할당 → 기동 → 마이그레이션·시드까지 기다린 뒤 배정된 주소를 출력한다 |
| `pnpm test:e2e` | 할당된 환경(`NERV_E2E_BASE_URL`·`DATABASE_URL`)을 실어 러너를 돌린다 |
| `pnpm e2e:env` | `eval $(pnpm -s e2e:env)` — 사람이 직접 `curl`·`psql` 할 때 |
| `pnpm e2e:down` | 컨테이너·볼륨·할당 파일 제거 |

**개발 스택을 향해 돌지 않도록 양쪽에 가드가 있다.** 웹은 baseURL 포트가 `8080`이면, API는 `DATABASE_URL` 포트가 `5432`면 거부하고 `pnpm e2e:up`을 안내한다. 의도적으로 개발 스택을 쓰려면 `NERV_E2E_ALLOW_DEV_STACK=1`을 명시해야 한다 — 사고는 대개 "그럴 의도가 없었는데" 일어난다.

자격증명이 compose 파일에 박혀 있는 것은 의도다: 이 스택은 127.0.0.1에만 열리고 매 실행 폐기된다. `.env`를 요구하면 "테스트를 돌리려면 개발 환경 설정을 먼저 맞춰라"가 되고, 그 순간 CI와 로컬이 다른 것을 돌리기 시작한다. 임베딩 제공자도 띄우지 않는다 — 검색은 렉시컬 degrade 경로(REQ-API-026)로 검증하며, 모델 가중치 수 GB를 CI가 내려받을 이유가 없다.

러너는 **Vitest**(L1·L2·L3 API)와 **Playwright**(L3 웹)로 확정한다(2026-08-22 — 스택 표 정본은 [4.1 MVP 범위와 스택 확정](scope.md) §2.1).

| 계층 | 러너 | 위치 | 대상 | 실행 |
| --- | --- | --- | --- | --- |
| L1 단위 | Vitest | 소스 옆 `*.spec.ts` | 순수 로직 — zod 스키마, 델타 계산, fingerprint | `pnpm test` (매 PR) |
| L2 통합 | Vitest | `apps/api/test/integration/` | 도메인 서비스 + 실제 Postgres(compose의 `postgres` 사용) — **클레임 원자성 동시 호출, scope 겹침, base_version 409, 리스 만료**. 임베딩은 결정적 **OpenAI 호환 스텁 서버**(테스트 픽스처 — 단일 계약(REQ-CB-020)이라 스텁도 같은 표면이다)로 검증하고 실모델 품질은 E06-S06·스테이징 소관 | `pnpm test:integration` (매 PR) |
| L3 계약/E2E | Vitest(API·MCP·WS) + Playwright(웹) | `apps/api/test/e2e/` + `apps/web/test/e2e/` | **E2E 전용 compose 스택**(`deploy/compose/docker-compose.e2e.yml`) 기동 후 REST·MCP·WS·브라우저 시나리오 — [4.8 백로그](backlog.md) §5의 E2E 수용 시나리오가 케이스 정본 | `pnpm e2e:up && pnpm test:e2e` (머지 전·야간) |

L2가 이 코드베이스의 무게중심이다. NERV의 핵심 리스크(동시 클레임·게이트 판정)는 mock으로 검증되지 않는다 — 트랜잭션·행 잠금·부분 인덱스가 실제로 동작하는 DB를 상대로만 의미가 있다.

### 4.4 커밋·브랜치

- 커밋: Conventional Commits — `feat|fix|docs|refactor|test|chore(scope)` , scope는 워크스페이스 이름(`api`·`web`·`schema`·`deploy`). 현행 저장소 관례(`docs: …`)와 연속.
- 브랜치: `feat/…`·`fix/…`·`docs/…`. `main` 직접 push 금지, PR 필수.
- PR 본문에 관련 Task ID(`TSK-…`)와 스펙 안정 ID(`SPC-…`·`REQ-…`)를 남긴다 — NERV 가동 후 evidence 연결의 원료다(FR-13).

---

### 4.5 CI 파이프라인 — `.github/workflows/ci.yml`

REQ-CB-007(스키마 변경 ↔ 마이그레이션 산출물 동반)과 §4.3 계층 실행의 실물이다. 워크플로 파일은 GitHub Actions 규약상 **저장소 루트** `.github/workflows/`에 둔다 — REQ-CB-015의 "저장소 메타 파일"에 해당하며 `codebase/` 배치 원칙의 예외가 아니라 그 정의 안이다(이 문단이 그 판정의 기록이다).

```yaml
# .github/workflows/ci.yml — 요지 스켈레톤 (defaults.run.working-directory: codebase)
name: ci
on:
  pull_request:
  push: { branches: [main] }
defaults: { run: { working-directory: codebase } }
jobs:
  check:                       # 매 PR — L1까지
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm exec tsc -b
      - run: pnpm test
      - name: schema drift     # REQ-CB-007 · REQ-CB-018 — 선언과 마이그레이션 산출물의 동반 강제
        run: pnpm db:generate && git diff --exit-code -- packages/schema/drizzle
  integration:                 # 매 PR — L2 (무게중심)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg17   # compose와 동일 이미지 (§5.3) — vector 확장이 마이그레이션에 필요
        env: { POSTGRES_PASSWORD: ci }
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm db:migrate && pnpm test:integration
        env: { DATABASE_URL: "postgres://postgres:ci@localhost:5432/postgres" }
  e2e:                         # merge_group + 야간 — L3
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: cp .env.example .env && docker compose -f ../deploy/compose/docker-compose.yml --env-file .env up -d --build
        # local-embed 프로필 없이 기동 — CI 에서 모델 가중치(수 GB) 다운로드 금지.
        # 검색 E2E 는 렉시컬 degrade 경로(REQ-API-026)로 검증하고, 벡터 품질은 E06-S06 스파이크·스테이징 소관
      - run: pnpm test:e2e
```

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-018** | WHEN PR의 변경에 `packages/schema/src/tables/**`가 포함되고 `pnpm db:generate` 재실행이 `packages/schema/drizzle/`에 diff를 만들면, THE SYSTEM SHALL CI를 실패시킨다 — 선언만 바꾸고 마이그레이션을 빠뜨린 PR은 머지되지 않는다(REQ-CB-007의 실행 실물). |

배포 파이프라인(이미지 빌드·태깅·kustomize 적용)은 §6.4의 CI 치환 지점을 따르며, MVP에서는 수동 트리거(`workflow_dispatch`)로 시작한다 — 자동 배포는 운영 안정 후.

## 5. 개발 환경

### 5.1 부트스트랩 절차 — 신규 장비에서 로그인 화면까지

```bash
git clone <forge>/nerv && cd nerv/codebase   # 모노레포 루트는 codebase/ (REQ-CB-015)
corepack enable                 # .nvmrc 의 Node LTS + package.json 의 pnpm 버전 사용
cp .env.example .env            # §5.2 전표 — 필수 3개(POSTGRES_PASSWORD·MINIO_ROOT_PASSWORD·NERV_AUTH_SECRET)만 채우면 기동된다
pnpm install
pnpm compose:up                 # postgres·minio·valkey(+embed는 local-embed 프로필 시 병렬) → migrate → api·worker → web (§5.3)
open http://localhost:8080      # 로그인 화면 — 첫 조직·프로젝트 생성은 4.6 온보딩 절차
```

개발 루프(HMR)가 필요하면 인프라만 compose로 띄우고 앱은 로컬 프로세스로 돈다:

```bash
pnpm compose:infra              # postgres · minio · valkey · embed 만 기동
pnpm db:migrate                 # drizzle 마이그레이션 적용
pnpm dev                        # 빌드 감시 + @nerv/api(:8080) + @nerv/web(vite :5173) — 워커까지면 pnpm dev:worker
```

**`pnpm dev` 는 `codebase/scripts/dev.mjs` 가 세 프로세스를 묶어 띄운다**(2026-08-23). 워크스페이스별 `dev` 스크립트를 `--parallel -r` 로 늘어놓는 방식은 두 군데서 조용히 어긋났다 — 둘 다 실측이다.

| 증상 | 원인 |
| --- | --- |
| `DATABASE_URL 이 없습니다` 로 API 가 즉시 죽는다 | compose 는 env 를 넣어 주지만 로컬 프로세스에는 넣어 주는 사람이 없다. `.env` 를 읽는 책임이 프로세스 자신에게 있어야 한다(`node --env-file-if-exists`) |
| **소스를 고쳐도 반영되지 않는다** | `tsc -b --watch` 는 의존을 따라 올라가지 소비자를 따라 내려가지 않는다. `packages/schema` 감시로는 `apps/api` 가 다시 빌드되지 않아 `dist` 가 그대로고, `node --watch` 는 아무것도 못 본다 |

런처가 하는 일 넷: ① `.env` 가 없으면 **먼저 멈추고 안내한다**(없는 것과 안 읽은 것은 다른 문제인데 에러 메시지가 같아진다) ② 저장소 루트에서 `tsc -b --watch` 를 돌려 참조 전체(schema → api → cli)를 빌드한다 ③ `dist/main.js` 가 **생긴 뒤에** API 를 띄운다(빈 체크아웃의 첫 실행이 실패하지 않게) ④ 하나가 죽으면 전부 내린다 — 반쯤 살아 있는 루프가 가장 헷갈린다.

루트 `package.json` 스크립트 표:

| 명령 | 내용 |
| --- | --- |
| `pnpm dev` | 개발 루프 — 빌드 감시 + api(:8080) + web(:5173). `.env` 를 스스로 읽는다(§5.1) |
| `pnpm dev:worker` | 위 + 워커(잡 루프 — 임베딩·알림·리스 회수) |
| `pnpm build` / `pnpm test` / `pnpm lint` | 전 워크스페이스 일괄 |
| `pnpm db:generate` | `@nerv/schema`에서 `drizzle-kit generate` — 마이그레이션 SQL 생성 |
| `pnpm db:migrate` | 마이그레이션 적용(`migrate.ts`) — compose·k8s와 같은 코드 경로 |
| `pnpm e2e:up` | **E2E 전용 스택** 기동 — 세션별 포트를 잡고(대역 19000~19999 · §4.3) 마이그레이션·시드까지 끝난 뒤 배정된 주소를 출력한다 |
| `pnpm e2e:down` | 같은 파일에 `down -v` — tmpfs라 흔적이 남지 않는다 |
| `pnpm e2e:reset` | `e2e:down && e2e:up` — 실행 간 상태를 비운다 |
| `pnpm test:e2e` | L3 전량(API 시나리오 A~E + 브라우저). 대상 주소를 E2E 스택으로 고정해서 넘긴다 |
| `pnpm db:seed` | 개발 시드 적재 — TRUNCATE 후 재삽입이라 재실행 멱등([4.3 데이터베이스 스키마](database.md) §4, REQ-DB-002). **로그인 자격증명도 함께 심는다**: 시드 사용자 5명(`jimin`·`seoyeon`·`dohyun`·`yuna`·`hana`@example.com)의 비밀번호는 `nerv-dev-1234`이고 `NERV_SEED_PASSWORD`로 바꾼다. 도메인 행만 심으면 로그인 화면까지 가고도 들어갈 수 없다 — 자격증명은 인증 스택(better-auth)의 것이라 `apps/api`의 시드 엔트리가 심고 `@nerv/schema`는 도메인만 심는다 |
| `pnpm compose:up` | `docker compose -f ../deploy/compose/docker-compose.yml --env-file .env --profile local-embed up -d --build` — 외부 임베딩 제공자 사용 시 `--profile local-embed` 생략(§5.2a) |
| `pnpm compose:infra` | 위 명령 + `postgres minio valkey embed` 서비스만(`embed`는 local-embed 프로필일 때) |
| `pnpm compose:down` | 스택 정지(볼륨 유지) |
| `pnpm --filter @nerv/cli build` | 임포터 CLI 빌드 — 산출물은 이미지가 아니라 설치형 패키지(§1.3) |
| `nerv import …` | 임포터 실행. **`codebase/`가 아니라 원본 체크아웃에서 실행한다**([4.7 스펙 임포터](importer.md) §3.1) |

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-008** | WHEN compose 스택이 기동될 때, THE SYSTEM SHALL `migrate` 서비스가 성공 종료(`service_completed_successfully`)하기 전에는 `api`·`worker`를 시작하지 않는다. |
| **REQ-CB-009** | WHEN 신규 장비에서 §5.1의 명령 6개만 순서대로 실행하면, THE SYSTEM SHALL 추가 질문·수동 설정 없이 로그인 화면 응답(HTTP 200)과 `nerv_bootstrap` 도구 호출 성공까지 도달한다 — 이 문서의 1차 수용 기준이다. |

### 5.2 `.env` 변수 전표

`.env.example`이 이 표의 실물이다. 필수 3개 외에는 전부 기본값으로 동작한다.

| 변수 | 필수 | 기본값(개발) | 소비자 | 설명 |
| --- | --- | --- | --- | --- |
| `POSTGRES_USER` | | `nerv` | compose `postgres` · `DATABASE_URL` 조립 | |
| `POSTGRES_PASSWORD` | **필수** | — | compose `postgres` · `DATABASE_URL` 조립 | |
| `POSTGRES_DB` | | `nerv` | compose `postgres` | |
| `POSTGRES_PORT` | | `5432` | compose 포트 노출(127.0.0.1 한정) | 개발 루프(`pnpm dev`)의 DB 접근 |
| `DATABASE_URL` | dev 루프 시 | `postgres://nerv:<pw>@localhost:5432/nerv` | api · worker · migrate · drizzle-kit | compose 내부에서는 `postgres` 호스트로 자동 조립 |
| `NERV_API_PORT` | | `8080` | api | |
| `NERV_PUBLIC_URL` | | `http://localhost:8080` | api(세션 쿠키·CORS 기준) · web(`/mcp` Origin 1차 검증) | 경로 없는 오리진만 |
| `NERV_TRUSTED_ORIGINS` | | (비움) | api(better-auth) | baseURL 밖에서 화면을 띄울 때만 추가(쉼표 구분) — CSRF 방어선이라 기본은 비운다. 개발 루프는 화면이 Vite(:5173)·API 가 :8080 이라 오리진이 달라 `http://localhost:5173` 이 필요하다. compose 는 둘이 같아 불요 |
| `NERV_AUTH_SECRET` | **필수** | — | api(better-auth 서명) | `openssl rand -base64 32` |
| `VALKEY_PORT` | | `6379` | compose 포트 노출(127.0.0.1 한정) | 개발 루프(`pnpm dev`)의 Valkey 접근 |
| `NERV_VALKEY_URL` | dev 루프 시 | `redis://localhost:6379` | api · worker | 실시간 방송 MQ(§2.1). compose 내부에서는 `redis://valkey:6379`로 자동 조립(Valkey는 RESP 프로토콜 — `redis://` 스킴) |
| `NERV_EMBED_URL` | dev 루프 시 | `http://localhost:8090/v1` | api(질의 임베딩) · worker(`embedding.job`) | **OpenAI 호환 base URL(`/v1`까지)** — 프로필 §5.2a. compose 내부 기본은 `http://embed:80/v1`. 무응답 시 검색은 렉시컬 degrade(REQ-API-026) |
| `NERV_EMBED_MODEL` | | `BAAI/bge-m3` | `/v1/embeddings`의 `model` 인자 · 재임베딩 관리(`spec_chunk_embedding.model` — 4.3 §2.15) | 제공자·모델 교체 시 전량 재임베딩 후 구 모델 행 드랍 |
| `NERV_EMBED_API_KEY` | 외부 제공자 시 | — | `Authorization: Bearer` 헤더 | **secret** — 로컬 TEI는 불요. k8s는 `nerv-secrets`(§6.2) |
| `NERV_EMBED_PORT` | | `8090` | compose 포트 노출(127.0.0.1 한정) | 로컬 프로필 전용 |
| `MINIO_ROOT_USER` | | `nerv` | compose `minio` · S3 자격증명 | |
| `MINIO_ROOT_PASSWORD` | **필수** | — | compose `minio` · S3 자격증명 | |
| `MINIO_PORT` | | `9000` | compose 포트 노출(127.0.0.1 한정) | 개발 루프(`pnpm dev`)의 S3 접근 |
| `MINIO_CONSOLE_PORT` | | `9001` | compose 포트 노출(127.0.0.1 한정) | minio 웹 콘솔 |
| `NERV_S3_ENDPOINT` | | `http://localhost:9000` | api · worker | compose 내부는 `http://minio:9000` |
| `NERV_S3_BUCKET` | | `nerv-blobs` | api · worker | api가 기동 시 없으면 생성 |
| `NERV_S3_FORCE_PATH_STYLE` | | `true` | api · worker | minio 호환 |
| `NERV_HTTP_PORT` | | `8080` | compose `web` 공개 포트 | |
| `NERV_TAG` | | `dev` | compose 이미지 태그 | 운영 태깅은 §6.4 |
| `NERV_LOG_LEVEL` | | `info` | api · worker | |

**에이전트 장비 쪽 변수는 이 전표가 아니다.** `NERV_TOKEN`(PAT)·`NERV_PROJECT`·`NERV_HOSTNAME`은 세션이 도는 개발자 장비의 환경이며, 정본은 [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) §3.3·§4.1, 발급·설치 절차는 [4.6 플러그인과 온보딩](plugin.md)이다.

### 5.2a 임베딩 제공자 프로필 — OpenAI 호환 단일 계약

NERV 코드는 임베딩 제공자를 모른다 — **OpenAI 호환 `POST {NERV_EMBED_URL}/embeddings`**(`model`·`input[]`, 선택 `dimensions`) 하나만 호출하고(REQ-CB-020), 제공자는 env 3키로 결정된다. 제공자별 분기 코드·전용 SDK는 두지 않는다.

| 환경 | 제공자 | `NERV_EMBED_URL` | `NERV_EMBED_MODEL` | 비고 |
| --- | --- | --- | --- | --- |
| **로컬**(기본값) | ollama — compose `embed` 서비스(CPU) | `http://embed:11434/v1` | `bge-m3` | 네이티브 1024차원(F16). API 키 불요. 외부 전송 0. **amd64·arm64 모두 기동**(2026-08-23 개정 — 아래 점화 기록) |
| **스테이징** | LM Studio(OpenAI 호환 서버) | `http://<lmstudio-host>:1234/v1` | bge-m3 계열(GGUF) | 1024차원 확인 후 사용. `embed` 서비스 미기동 |
| **운영** | OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | **`dimensions: 1024` 필수**(Matryoshka 절단 — 스키마 vector(1024) 고정, REQ-CB-021). `NERV_EMBED_API_KEY` 필수 |

- **차원은 전 프로필 1024 고정**이다 — `spec_chunk_embedding.embedding vector(1024)`(4.3 §2.15)와 HNSW 인덱스가 차원에 묶이므로, 1024를 내지 못하는 제공자·모델은 프로필로 쓸 수 없다(REQ-CB-021이 적재 시 검증).
- **환경 간 벡터는 호환되지 않는다** — 모델이 다르면 벡터 공간이 다르다. 각 환경의 인덱스는 자기 `model` 값에 묶이고(4.3 §2.15 규칙 3), 프로필 전환은 전량 재임베딩이다. DB를 환경 간 복사하는 경우(스테이징 복제 등)에도 임베딩 행은 버리고 재생성한다.
- **로컬 프로필의 첫 기동은 모델을 받는다**(~1.2GB). ollama 는 요청 시 자동으로 받지 않으므로(실측: `model not found, try pulling it first`) `embed` 서비스가 기동 직후 한 번 `pull` 하고, **모델이 실제로 응답할 때만 healthy** 로 표시한다 — 서버만 떠 있는 상태를 준비됐다고 부르면 그 사이의 임베딩이 전부 조용히 실패한다.

#### 점화 기록 — 로컬 프로필의 이미지 교체 (2026-08-23)

로컬 프로필은 원래 TEI(`ghcr.io/huggingface/text-embeddings-inference:cpu-latest`)였다. **Apple Silicon 에서 기동되지 않는다**는 것이 실측으로 드러나 교체했다.

| 확인한 것 | 결과 |
| --- | --- |
| TEI 이미지의 arm64 매니페스트 | **없음** — `cpu-latest` 는 `linux/amd64` 단독. 전 태그(6페이지)에 `arm`·`apple`·`metal` 태그 0건 |
| amd64 에뮬레이션(Rosetta) | 기동은 하지만 모델 워밍업에서 **OOM 종료**(`OOMKilled=true` · exit 137, Docker VM 7.7GiB) |
| ollama 이미지 | `linux/amd64` + `linux/arm64` 둘 다 발행 |
| ollama 의 계약 적합성 | `POST /v1/embeddings` 가 `data[].index` + **1024차원** 반환(단건·배치 모두). 모델은 같은 bge-m3(566.7M · F16 · context 8192) |
| 성능(M 계열 · 배치 32) | 약 34ms/청크 — 개발 루프에 충분 |

**교체가 결정을 바꾸지 않는 이유**: 계약(OpenAI 호환 `/v1/embeddings`)·모델(bge-m3)·차원(1024)·외부 전송 0이 모두 그대로다. 코드는 제공자를 모르고 env 3키만 보므로(REQ-CB-020) 소스 변경은 기본값 문자열뿐이다. 바뀐 것은 **로컬 개발자의 기계에서 실제로 도는가**이고, 그것이 이 프로필의 존재 이유다.

- **외부 제공자 = 스펙 본문 외부 전송**이다. 이는 운영 주체가 env로 명시 선택하는 사항이며(2026-08-22 — v0.6 "자가호스팅만"의 번복), 기밀 등급이 높은 프로젝트는 자가호스팅 프로필이 운영 권고다([4.1](scope.md) §5).

### 5.3 `docker-compose.yml` 전문

```yaml
# deploy/compose/docker-compose.yml   ← 저장소 루트 기준 (REQ-CB-015, 2026-08-22 개정)
# NERV 로컬 개발 · 소규모 자가호스팅 정본 (NFR-01).
# 실행: 모노레포 루트(codebase/)에서 — .env 가 거기 있고 pnpm 래퍼도 거기서 돈다
#   docker compose -f ../deploy/compose/docker-compose.yml --env-file .env up -d --build
# (래퍼: pnpm compose:up — docs/04-mvp/codebase.md §5.1)
# 빌드 컨텍스트는 저장소 루트다 — 이 파일 기준 ../.. (codebase/ 소스와 deploy/docker/nginx/
# 템플릿을 한 컨텍스트에서 본다). 제외는 저장소 루트 .dockerignore.
# 운영 k8s 는 deploy/k8s (§6). 같은 이미지 3종(nerv-api·nerv-worker·nerv-web)을 두 타깃이 공유한다.
name: nerv

services:
  postgres:
    image: pgvector/pgvector:pg17    # postgres:17 + pgvector 동봉 (4.3 §2.1 확장 — 4.1 §2.1 검색 스택)
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-nerv}
      POSTGRES_USER: ${POSTGRES_USER:-nerv}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"   # 개발 루프용 — 운영 배포에서는 제거
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER:-nerv} -d $${POSTGRES_DB:-nerv}"]
      interval: 5s
      timeout: 3s
      retries: 12

  valkey:                            # 실시간 방송 MQ — nerv_events pub/sub (§2.1, 4.3 §3)
    image: valkey/valkey:8-alpine
    restart: unless-stopped
    command: ["valkey-server", "--save", "", "--appendonly", "no"]   # pub/sub 전용 — 무영속(유실 허용, 진실은 DB — D-14)
    ports:
      - "127.0.0.1:${VALKEY_PORT:-6379}:6379"    # 개발 루프용 — 운영 배포에서는 제거
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 6

  embed:                             # 로컬 프로필 전용 임베딩 서빙(OpenAI 호환 /v1/embeddings 노출).
    profiles: ["local-embed"]        #   외부 제공자(LM Studio·OpenAI) 프로필에서는 기동하지 않는다 (§5.2a)
    # 이미지가 ollama 인 이유는 **개발자의 기계에서 도는 것**이 이 프로필의 존재 이유이기
    # 때문이다. TEI(ghcr.io/huggingface/text-embeddings-inference)는 arm64 이미지를 내지
    # 않아 Apple Silicon 에서 `no matching manifest` 로 멈춘다(실측 2026-08-23 — 전 태그 확인).
    # amd64 에뮬레이션은 기동은 하지만 워밍업에서 OOM 으로 죽는다(exit 137).
    # ollama 는 amd64·arm64 둘 다 내고, 같은 bge-m3(F16 · 1024차원)를 같은 계약으로 노출한다.
    image: ollama/ollama:latest      # 버전 태그 고정 권장
    restart: unless-stopped
    # ollama 는 요청 시 모델을 자동으로 받지 않는다(실측: `model not found, try pulling it first`).
    # 서버를 띄운 뒤 한 번 받아 두지 않으면 첫 검색이 조용히 렉시컬로 degrade 한다.
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        ollama serve &
        until ollama list >/dev/null 2>&1; do sleep 1; done
        ollama pull "${NERV_EMBED_MODEL:-bge-m3}"
        wait
    volumes:
      - embedmodels:/root/.ollama    # 모델 가중치 캐시 — 첫 기동만 다운로드
    ports:
      - "127.0.0.1:${NERV_EMBED_PORT:-8090}:11434"   # 개발 루프용 — 운영 배포에서는 제거
    healthcheck:
      # **모델이 실제로 응답할 때만** healthy 다 — 서버만 떠 있는 상태를 준비됐다고 부르면
      # 그 사이의 임베딩이 전부 조용히 실패한다
      test:
        - CMD-SHELL
        - >
          ollama list 2>/dev/null | grep -q "${NERV_EMBED_MODEL:-bge-m3}"
      interval: 10s
      timeout: 5s
      retries: 60                    # 첫 기동은 모델(~1.2GB) 다운로드를 기다린다
    # api·worker 는 embed 를 기다리지 않는다 — 무응답이면 렉시컬 degrade (REQ-API-026)

  minio:
    image: minio/minio:latest        # 운영은 RELEASE 태그·다이제스트로 고정할 것
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-nerv}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env}
    volumes:
      - miniodata:/data
    ports:
      - "127.0.0.1:${MINIO_PORT:-9000}:9000"      # 개발 루프용 S3 엔드포인트
      - "127.0.0.1:${MINIO_CONSOLE_PORT:-9001}:9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 6

  migrate:                           # 기동 시 마이그레이션 — k8s 의 nerv-migrate Job 과 같은 엔트리 (§6.3)
    image: nerv-api:${NERV_TAG:-dev}
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.server
      target: api
    command: ["node", "dist/migrate.js"]
    restart: "no"
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-nerv}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-nerv}
    depends_on:
      postgres:
        condition: service_healthy

  api:                               # nerv-api — REST + MCP + WebSocket + SSE + ingest (§2)
    image: nerv-api:${NERV_TAG:-dev}
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.server
      target: api
    restart: unless-stopped
    environment:
      NODE_ENV: production
      NERV_API_PORT: "8080"
      NERV_PUBLIC_URL: ${NERV_PUBLIC_URL:-http://localhost:8080}
      NERV_AUTH_SECRET: ${NERV_AUTH_SECRET:?set NERV_AUTH_SECRET in .env}
      NERV_LOG_LEVEL: ${NERV_LOG_LEVEL:-info}
      DATABASE_URL: postgres://${POSTGRES_USER:-nerv}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-nerv}
      NERV_VALKEY_URL: redis://valkey:6379
      NERV_EMBED_URL: ${NERV_EMBED_URL:-http://embed:80/v1}   # 프로필 §5.2a — 외부 제공자 시 .env 로 교체
      NERV_EMBED_MODEL: ${NERV_EMBED_MODEL:-BAAI/bge-m3}
      NERV_EMBED_API_KEY: ${NERV_EMBED_API_KEY:-}
      NERV_S3_ENDPOINT: http://minio:9000
      NERV_S3_ACCESS_KEY: ${MINIO_ROOT_USER:-nerv}
      NERV_S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      NERV_S3_BUCKET: ${NERV_S3_BUCKET:-nerv-blobs}
      NERV_S3_FORCE_PATH_STYLE: "true"
    depends_on:
      migrate:
        condition: service_completed_successfully
      minio:
        condition: service_healthy
      valkey:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6

  worker:                            # nerv-worker — 같은 코드베이스, 엔트리 분리. replica 1 고정 (§6.3)
    image: nerv-worker:${NERV_TAG:-dev}
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.server
      target: worker
    restart: unless-stopped
    environment:
      NODE_ENV: production
      NERV_LOG_LEVEL: ${NERV_LOG_LEVEL:-info}
      DATABASE_URL: postgres://${POSTGRES_USER:-nerv}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-nerv}
      NERV_VALKEY_URL: redis://valkey:6379
      NERV_EMBED_URL: ${NERV_EMBED_URL:-http://embed:80/v1}   # 프로필 §5.2a — 외부 제공자 시 .env 로 교체
      NERV_EMBED_MODEL: ${NERV_EMBED_MODEL:-BAAI/bge-m3}
      NERV_EMBED_API_KEY: ${NERV_EMBED_API_KEY:-}
      NERV_S3_ENDPOINT: http://minio:9000
      NERV_S3_ACCESS_KEY: ${MINIO_ROOT_USER:-nerv}
      NERV_S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      NERV_S3_BUCKET: ${NERV_S3_BUCKET:-nerv-blobs}
      NERV_S3_FORCE_PATH_STYLE: "true"
    depends_on:
      migrate:
        condition: service_completed_successfully
      minio:
        condition: service_healthy
      valkey:
        condition: service_healthy

  web:                               # nerv-web — Vite 산출물 + nginx reverse-proxy (§5.4)
    image: nerv-web:${NERV_TAG:-dev}
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.web
    restart: unless-stopped
    environment:
      NERV_API_UPSTREAM: api:8080
      NERV_PUBLIC_ORIGIN: ${NERV_PUBLIC_URL:-http://localhost:8080}
    ports:
      - "${NERV_HTTP_PORT:-8080}:80"   # TLS 는 호스트 앞단(조직 LB·프록시)에서 종료
    depends_on:
      - api

volumes:
  pgdata:
  miniodata:
  embedmodels:
```

otel-collector(조직 정량 관측)는 선택 사항이라 MVP compose 정본에서 뺐다 — 필요 조직은 [3.2](../03-proposal/architecture.md) §4.4 구성을 별도 오버레이 파일(`docker-compose.otel.yml`)로 얹는다.

### 5.4 nginx 템플릿 전문 (`deploy/docker/nginx/default.conf.template`)

nginx 공식 이미지의 envsubst 템플릿 기능을 쓴다 — 기동 시 `${NERV_API_UPSTREAM}`·`${NERV_PUBLIC_ORIGIN}`이 치환된 뒤 로드되므로, compose(`api:8080`)와 k8s(`nerv-api:8080`)가 같은 이미지를 쓴다.

```nginx
# deploy/docker/nginx/default.conf.template
map $http_upgrade $connection_upgrade {
  default upgrade;
  ""      close;
}

# /mcp Origin 1차 검증 — 비브라우저 클라이언트(Origin 없음)와 자기 오리진만 허용.
# 최종 강제는 앱의 mcp-origin.guard.ts (REQ-CB-013).
map $http_origin $nerv_mcp_origin_ok {
  default                 0;
  ""                      1;
  "${NERV_PUBLIC_ORIGIN}" 1;
}

upstream nerv_api {
  server ${NERV_API_UPSTREAM};
}

server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;

  # SPA — 정적 자산, 나머지 경로는 index.html
  location / {
    try_files $uri /index.html;
  }
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location /api/ {
    proxy_pass http://nerv_api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /mcp {
    if ($nerv_mcp_origin_ok = 0) { return 403; }
    proxy_pass http://nerv_api;
    proxy_http_version 1.1;
    proxy_buffering off;               # Streamable HTTP 응답 스트림
    proxy_read_timeout 300s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ingest/ {
    client_max_body_size 5m;           # 훅 페이로드 상한
    proxy_pass http://nerv_api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # SSE — 단방향 이벤트 스트림, 버퍼링 금지 (REQ-CB-014)
  location /sse/ {
    proxy_pass http://nerv_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # WebSocket — socket.io 어댑터의 path 설정값(/ws · 4.4 §3.1), websocket 전송만(폴링 폴백 off)
  location /ws/ {
    proxy_pass http://nerv_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /healthz {
    proxy_pass http://nerv_api;
  }
}
```

`/healthz`는 인프라 전용(무인증 liveness)이며 [4.4 API 명세](api.md)의 계약 전표 밖이다.

---

## 6. 운영 배포 — k8s (kustomize base/overlays)

운영 표준은 조직 관례대로 k8s + kustomize다(clemvion이 이미 `clemvion:k8s/` base+overlays 관례를 쓴다 — [3.2](../03-proposal/architecture.md) §4.2).

### 6.0 운영 Postgres 위치 — 클러스터 외부 (2026-08-22 확정)

E06-S05 확인 태스크의 결과다. 세 기준으로 비교했다.

| 기준 | 클러스터 외부(관리형/전용 인스턴스) | CloudNativePG(클러스터 내부) |
| --- | --- | --- |
| 백업·복구(NFR-01) | 관리형 스냅샷 + PITR을 그대로 쓴다. §6.5 절차 ①이 스냅샷 복원으로 대체되고 나머지는 불변 | 백업 CR·오브젝트 스토리지 연동을 직접 운영. 복구 리허설도 직접 |
| 운영 부담 | DB 운영이 클러스터 밖에 있어 앱 배포와 분리된다. 파일럿 규모(NFR-04)에서 추가 인력 0 | operator 버전·PG 메이저 업그레이드·스토리지 클래스까지 팀이 진다 |
| k8s 의존성 | 없음 — compose 단일 노드 자가호스팅(NFR-01)과 같은 접속 모델이라 두 타깃이 갈라지지 않는다 | 클러스터가 곧 DB의 가용성 경계가 된다. 단일 노드 자가호스팅에서는 쓸 수 없다 |

**판정: 클러스터 외부.** 결정적인 것은 세 번째다 — NFR-01이 요구하는 compose 자가호스팅과
운영 k8s가 **같은 접속 모델**(`DATABASE_URL` 하나)을 쓰려면 DB가 클러스터 안에 있으면 안 된다.
CloudNativePG를 쓰면 자가호스팅 경로와 운영 경로가 다른 물건이 되고, §6.5 백업 절차도 둘로 갈린다.

- `base/`에 Postgres 리소스를 두지 않는다(현행 트리 그대로 — §6.2에 postgres가 없는 이유다).
- 접속 정보는 `nerv-secrets`의 `DATABASE_URL` 하나다.
- **재검토 트리거**: 관리형 Postgres를 쓸 수 없는 설치 환경(폐쇄망 등) 요구가 실제로 들어오거나,
  외부 DB의 네트워크 지연이 L2 실측 임계를 넘을 때. 그때 CloudNativePG를 다시 본다.

### 6.1 Dockerfile 2종 요지

**`deploy/docker/Dockerfile.server`** — 멀티스테이지 하나에서 `api`·`worker` 두 타깃을 뽑는다(이미지 3종 중 2종).

```dockerfile
# deploy/docker/Dockerfile.server — nerv-api · nerv-worker 공용 정의
# 빌드 컨텍스트는 저장소 루트라 소스 경로에 codebase/ 접두가 붙는다 (REQ-CB-015, §5.3).
# 주의: Dockerfile 은 인라인 주석을 허용하지 않는다 — 주석은 항상 줄머리에 둔다.

# .nvmrc 의 Node LTS 와 동일 메이저 (REQ-CB-002)
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY codebase/pnpm-lock.yaml codebase/pnpm-workspace.yaml codebase/package.json ./
COPY codebase/apps/api/package.json apps/api/
COPY codebase/packages/schema/package.json packages/schema/
RUN pnpm fetch
COPY codebase/ .
# deploy --prod 가 실행 파일 + prod 의존성만 /out 으로 추출한다.
# --legacy: pnpm v10 부터 deploy 는 inject-workspace-packages=true 를 요구하는데, 주입을 켜면
# 워크스페이스 의존이 심링크가 아니라 복사본이 되어 개발 루프(schema 수정 → api 즉시 반영)가
# 깨진다. 배포 산출물 추출은 이미지 빌드에서만 필요하므로 여기서만 legacy 경로를 쓴다.
RUN pnpm install --frozen-lockfile --offline \
 && pnpm --filter @nerv/api build \
 && pnpm --filter @nerv/api deploy --legacy --prod /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /out .

# → nerv-api  (migrate.js 도 이 이미지에 포함)
FROM runtime AS api
EXPOSE 8080
CMD ["node", "dist/main.js"]

# → nerv-worker
FROM runtime AS worker
CMD ["node", "dist/worker.js"]
```

**`deploy/docker/Dockerfile.web`** — Vite 빌드 산출물 + nginx(§5.4 템플릿).

```dockerfile
# deploy/docker/Dockerfile.web — nerv-web
# 빌드 컨텍스트는 저장소 루트 — 소스는 codebase/, nginx 템플릿은 deploy/docker/nginx/ 다.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY codebase/pnpm-lock.yaml codebase/pnpm-workspace.yaml codebase/package.json ./
COPY codebase/apps/web/package.json apps/web/
COPY codebase/packages/schema/package.json packages/schema/
RUN pnpm fetch
COPY codebase/ .
# schema 를 먼저 빌드한다 — @nerv/schema 는 dist/index.js 를 노출하므로 vite 가 소스를
# 해소하지 못한다. api 이미지는 tsc -b 의 프로젝트 참조가 이 순서를 대신 지켜준다.
RUN pnpm install --frozen-lockfile --offline \
 && pnpm --filter @nerv/schema build \
 && pnpm --filter @nerv/web build

FROM nginx:1.27-alpine
COPY deploy/docker/nginx/default.conf.template /etc/nginx/templates/
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
ENV NERV_API_UPSTREAM=api:8080 \
    NERV_PUBLIC_ORIGIN=http://localhost:8080
```

### 6.2 kustomize 트리

```text
deploy/k8s/
  base/
    kustomization.yaml
    namespace.yaml               # Namespace nerv
    configmap.yaml               # 비밀 아닌 설정 — NERV_PUBLIC_URL · NERV_S3_BUCKET · NERV_VALKEY_URL(redis://nerv-valkey:6379) …
    api/
      deployment.yaml            # §6.3 전문
      service.yaml               # nerv-api :8080 (name: http)
    worker/
      deployment.yaml            # §6.3 전문 — replicas 1 · Recreate
    valkey/
      deployment.yaml            # §6.3 전문 — replicas 1 · 무영속 pub/sub 전용
      service.yaml               # nerv-valkey :6379 (name: redis)
    embed/                       # ★ 로컬(자가호스팅) 프로필 전용 — 외부 제공자(LM Studio·OpenAI) 오버레이는
      deployment.yaml            #   이 리소스를 제외하고 configmap NERV_EMBED_URL만 외부로 바꾼다 (§5.2a)
      service.yaml               # nerv-embed :80 (name: http) — 자가호스팅 시 NERV_EMBED_URL=http://nerv-embed/v1
    web/
      deployment.yaml            # nginx · NERV_API_UPSTREAM=nerv-api:8080
      service.yaml               # nerv-web :80 (name: http)
    migrate/
      job.yaml                   # §6.3 전문
    ingress.yaml                 # §6.3 전문 — WS 업그레이드 · 타임아웃
  overlays/
    dev/
      kustomization.yaml         # 이미지 태그 · host(dev) · replica 1 패치
      ingress-host.yaml
    prod/
      kustomization.yaml         # §6.4 — images: 로 git SHA 고정
      ingress-host.yaml
      api-replicas.yaml
      resources.yaml
```

`base/kustomization.yaml` 전문:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: nerv
resources:
  - namespace.yaml
  - configmap.yaml
  - api/deployment.yaml
  - api/service.yaml
  - worker/deployment.yaml
  - valkey/deployment.yaml
  - valkey/service.yaml
  - web/deployment.yaml
  - web/service.yaml
  - migrate/job.yaml
  - ingress.yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: nerv
```

Secret(`nerv-secrets`: `DATABASE_URL`·`NERV_AUTH_SECRET`·`NERV_S3_ACCESS_KEY`·`NERV_S3_SECRET_KEY`)은 base가 만들지 않는다 — 조직 표준 경로(SOPS·sealed-secrets 등)로 주입하고 이름만 계약한다.

### 6.3 Deployment · Job · Ingress 스켈레톤

`base/api/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nerv-api
  labels: { app: nerv-api }
spec:
  replicas: 2                      # 무상태 — 팬아웃은 파드별 Valkey SUBSCRIBE(§2.1)라 스티키 불필요
  selector:
    matchLabels: { app: nerv-api }
  template:
    metadata:
      labels: { app: nerv-api }
    spec:
      containers:
        - name: api
          image: nerv-api          # 태그는 overlay images: 로 고정 (§6.4)
          ports:
            - { containerPort: 8080, name: http }
          envFrom:
            - configMapRef: { name: nerv-config }
            - secretRef: { name: nerv-secrets }
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits: { memory: 1Gi }
```

`base/worker/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nerv-worker
  labels: { app: nerv-worker }
spec:
  replicas: 1                      # 고정 — HPA 대상 제외 (REQ-CB-011)
  strategy:
    type: Recreate                 # 롤링 중 2개 동시 실행 창 제거
  selector:
    matchLabels: { app: nerv-worker }
  template:
    metadata:
      labels: { app: nerv-worker }
    spec:
      containers:
        - name: worker
          image: nerv-worker
          envFrom:
            - configMapRef: { name: nerv-config }
            - secretRef: { name: nerv-secrets }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 512Mi }
      # HTTP 포트·프로브 없음 — 잡 루프 실패는 프로세스 종료 → 재시작으로 처리
```

`base/valkey/deployment.yaml` — 방송 MQ는 pub/sub 전용이라 무영속·단일 replica로 시작한다. 재기동 구간의 이벤트 유실은 허용된다(D-14 — 클라이언트 재조회·워커 폴링 폴백). HA(센티널·관리형 서비스)는 유실 재조회 비용이 실측 임계를 넘을 때의 재검토 항목이다([4.1 MVP 범위와 스택 확정](scope.md) §2.2).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nerv-valkey
  labels: { app: nerv-valkey }
spec:
  replicas: 1                      # pub/sub 전용 — 무영속, 재기동 시 유실 허용(D-14)
  strategy:
    type: Recreate
  selector:
    matchLabels: { app: nerv-valkey }
  template:
    metadata:
      labels: { app: nerv-valkey }
    spec:
      containers:
        - name: valkey
          image: valkey/valkey:8-alpine
          args: ["valkey-server", "--save", "", "--appendonly", "no"]
          ports:
            - { containerPort: 6379, name: redis }
          readinessProbe:
            exec: { command: ["valkey-cli", "ping"] }
            initialDelaySeconds: 2
            periodSeconds: 5
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { memory: 256Mi }
```

`base/valkey/service.yaml`은 `nerv-valkey` 이름으로 6379(name: redis)를 노출한다 — configmap의 `NERV_VALKEY_URL=redis://nerv-valkey:6379`가 이 이름을 계약한다.

`base/migrate/job.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nerv-migrate
spec:
  backoffLimit: 2
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: nerv-api                      # 같은 이미지 — compose migrate 서비스와 동일 엔트리
          command: ["node", "dist/migrate.js"]
          envFrom:
            - secretRef: { name: nerv-secrets }
```

`base/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nerv
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"   # WebSocket · SSE 유휴 연결 유지
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"       # SSE 스트림 버퍼링 금지 (REQ-CB-014)
    nginx.ingress.kubernetes.io/proxy-body-size: "5m"        # 훅 페이로드 상한(§5.4 와 동일)
spec:
  ingressClassName: nginx
  tls:
    - hosts: [nerv.example.com]
      secretName: nerv-tls
  rules:
    - host: nerv.example.com
      http:
        paths:
          - { path: /api,       pathType: Prefix, backend: { service: { name: nerv-api, port: { name: http } } } }
          - { path: /mcp,       pathType: Prefix, backend: { service: { name: nerv-api, port: { name: http } } } }
          - { path: /ingest,    pathType: Prefix, backend: { service: { name: nerv-api, port: { name: http } } } }
          - { path: /ws,       pathType: Prefix, backend: { service: { name: nerv-api, port: { name: http } } } }
          - { path: /sse,       pathType: Prefix, backend: { service: { name: nerv-api, port: { name: http } } } }
          - { path: /,          pathType: Prefix, backend: { service: { name: nerv-web, port: { name: http } } } }
```

k8s 경로에서 `/mcp` Origin 검증의 최종 강제는 앱 가드(`mcp-origin.guard.ts`)다 — Ingress 컨트롤러의 스니펫 주입은 조직 보안 정책상 비활성인 클러스터가 많아 **의존하지 않는다**(REQ-CB-013).

배포 절차(마이그레이션 Job 선행 — Job은 불변 리소스라 재적용 전 삭제). **저장소 루트에서 실행한다** — `deploy/k8s`가 저장소 루트 기준이기 때문이다(REQ-CB-015, §1.1):

```bash
kubectl -n nerv delete job nerv-migrate --ignore-not-found                        # (1) Job 은 불변 리소스 — 재적용 전 삭제
kustomize build deploy/k8s/overlays/prod | kubectl apply -f -                     # (2) 적용 — migrate Job 이 함께 생성된다
kubectl -n nerv wait --for=condition=complete --timeout=300s job/nerv-migrate     # (3) 마이그레이션 완료 대기
kubectl -n nerv rollout status deploy/nerv-api && \
kubectl -n nerv rollout status deploy/nerv-worker && \
kubectl -n nerv rollout status deploy/nerv-web                                    # (4) 롤아웃 확인
```

마이그레이션은 **expand-contract**(하위호환 additive 우선)를 원칙으로 한다 — (2)~(3) 사이 구버전 파드가 새 스키마 위에서 잠시 돌 수 있어야 한다. 파괴적 변경(컬럼 삭제·rename)은 2회 릴리스로 나눈다. 규칙 상세는 [4.3 데이터베이스 스키마](database.md) §1.

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-010** | WHEN 새 이미지가 k8s에 배포될 때, THE SYSTEM SHALL `nerv-migrate` Job의 성공 완료를 확인한 뒤에만 Deployment 롤아웃을 완료 판정한다(위 절차 (3)→(4) 순서 고정). |
| **REQ-CB-011** | WHEN `nerv-worker` 인스턴스가 어떤 이유로든 2개 이상 동시에 떠 있을 때, THE SYSTEM SHALL `pg_advisory_lock(WORKER_ADVISORY_LOCK_KEY)`을 보유한 1개만 잡 루프를 실행한다 — replica 1은 배포 규칙이고, lock이 최종 방어선이다. |
| **REQ-CB-012** | WHEN 이미지가 빌드되면, THE SYSTEM SHALL `nerv-api`·`nerv-worker`·`nerv-web` 3종에 같은 git SHA 태그를 붙이고 그 태그를 재사용(overwrite)하지 않는다. |
| **REQ-CB-013** | WHEN `POST /mcp` 요청의 `Origin` 헤더가 존재하고 `NERV_PUBLIC_URL`의 오리진과 다를 때, THE SYSTEM SHALL 앱 가드에서 403을 반환한다 — 전단(nginx·Ingress)의 차단 여부와 무관하게. |
| **REQ-CB-014** | WHEN 웹 클라이언트가 WebSocket을 연결할 때, THE SYSTEM SHALL websocket 전송만 협상하며(폴링 폴백 없음), 모든 프록시 계층(§5.4·§6.3)은 업그레이드 헤더와 read/send 타임아웃 3600초를 유지한다. WHEN 클라이언트가 `/sse/*` 스트림을 연결할 때, THE SYSTEM SHALL 모든 프록시 계층에서 응답 버퍼링을 끄고 read 타임아웃 3600초를 유지한다. |

### 6.4 이미지 태깅과 overlay

- 태그 체계: `nerv-api:<git-sha>`(불변, CI가 매 머지 빌드) + 릴리스에 `vX.Y.Z` 별칭. `latest`·`dev`는 로컬 compose 전용이다(REQ-CB-012).
- overlay가 배포 버전을 고정한다. `overlays/prod/kustomization.yaml` 전문:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
images:
  - name: nerv-api
    newName: registry.example.com/nerv/nerv-api
    newTag: "<git-sha>"        # CI 가 배포 시점에 치환 — 3종 동일 SHA (REQ-CB-012)
  - name: nerv-worker
    newName: registry.example.com/nerv/nerv-worker
    newTag: "<git-sha>"
  - name: nerv-web
    newName: registry.example.com/nerv/nerv-web
    newTag: "<git-sha>"
patches:
  - path: ingress-host.yaml
  - path: api-replicas.yaml
  - path: resources.yaml
```

### 6.5 백업·복구 — NFR-01의 실행 절차

성공 기준 1-9(백업본 복원 왕복 1회 이상, 데이터 손실 0 — 로드맵 §3.4)와 [4.8 백로그](backlog.md) E14-S02가 검증하는 절차의 정본이다. **운영 Postgres 위치(E06-S05)가 관리형으로 확정되면 ①은 관리형 스냅샷 + PITR로 대체**되고 ②~⑤는 그대로다.

| 대상 | 방법 | 주기(시작값) | 근거 |
| --- | --- | --- | --- |
| **Postgres** | `pg_dump -Fc`(custom format) → 오브젝트 스토리지 업로드. cron Job(`nerv-backup`) | 일 1회 · 보존 14일 | 유일한 SoT — 스펙·Task·이벤트 전부. RPO = 24h 시작값(파일럿 규모 NFR-04에서 수용, 실측 후 조정) |
| **MinIO** | 버킷 미러(`mc mirror`) | 선택 — 주 1회 | 내용물이 리뷰 프롬프트 blob(TTL 30일·재생성 가능 — D-07)뿐이라 유실 허용. 절차만 두고 기본 off |
| **Valkey** | 백업하지 않는다 | — | 무영속 방송 버스 — 유실 시 클라이언트 재조회로 복구(D-14, [4.4](api.md) §3.4) |
| **embed 모델 캐시**(로컬 프로필 시) | 백업하지 않는다 | — | 모델 가중치는 재다운로드, `spec_chunk_embedding`은 재임베딩으로 재생성(4.3 §2.15). 외부 제공자 프로필은 해당 없음 |

절차의 실물은 `deploy/scripts/nerv-backup.sh`(①)·`deploy/scripts/nerv-restore.sh`(①+⑤ 검증)이고, k8s 에서는 `base/backup/cronjob.yaml`(CronJob `nerv-backup` — 일 1회)이 같은 스크립트를 configMap 으로 마운트해 돈다. **검증이 절차의 일부다**: 복원 스크립트는 복원 후 원본과의 **실제 행 수**를 대조하고(통계 뷰 `n_live_tup` 이 아니다 — 복원 직후에는 통계가 비어 있어 "손실 0"과 "아직 세지 않았다"를 구분할 수 없다), 불일치면 비영 종료한다. 왕복 자체는 L2 테스트(`restore-roundtrip.spec.ts`)가 매 PR 에 재현한다.

복구 순서(왕복 검증도 같은 순서로 실행한다):

```bash
# ① 신규 Postgres에 복원 — 스키마 포함 custom format
pg_restore -d "$DATABASE_URL" --clean --if-exists nerv-<date>.dump
# ② 마이그레이션 정합 — 백업 이후 릴리스가 있었으면 여기서 따라잡는다 (멱등)
kubectl -n nerv delete job nerv-migrate --ignore-not-found && kustomize build deploy/k8s/overlays/prod | kubectl apply -f -
kubectl -n nerv wait --for=condition=complete --timeout=300s job/nerv-migrate
# ③ (선택) MinIO 버킷 복원 — mc mirror 역방향
# ④ api·worker 롤아웃 재시작 — Valkey는 빈 채로 시작해도 무방
kubectl -n nerv rollout restart deploy/nerv-api deploy/nerv-worker
# ⑤ 정합 검증 — 테이블별 행 수 대조 + 최신 event.occurred_at이 백업 시각 이내인지 확인
```

| ID | 요구(EARS) |
| --- | --- |
| **REQ-CB-019** | WHEN 백업본으로 §6.5 절차 ①~⑤를 실행하면, THE SYSTEM SHALL 추가 수동 개입 없이 로그인·스펙 조회·클레임이 동작하는 인스턴스에 도달하고, 백업 시각 이전 커밋 데이터의 손실 0을 행 수 대조로 검증 가능하게 한다(성공 기준 1-9). `spec_chunk_embedding`은 복원 대상이 아니어도 무방하다 — 재임베딩으로 재생성한다(4.3 §2.15). |
| **REQ-CB-020** | WHEN 임베딩(질의·인덱싱)이 수행될 때, THE SYSTEM SHALL `NERV_EMBED_URL`에 대한 **OpenAI 호환 `/v1/embeddings` 단일 클라이언트**만 사용하고 제공자별 분기·전용 SDK를 두지 않는다 — 제공자(자가호스팅/LM Studio/OpenAI)는 env 3키로만 결정되며 코드 기본값은 자가호스팅이다(§5.2a — 2026-08-22 개정: "자가호스팅만" 조항은 같은 날 폐기, 외부 전송은 운영 주체의 env 명시 선택). |
| **REQ-CB-021** | WHEN 임베딩 응답의 벡터 차원이 1024가 아니면, THE SYSTEM SHALL 해당 배치를 적재하지 않고 오류로 기록한다 — OpenAI 프로필은 요청에 `dimensions: 1024`를 항상 포함한다(§5.2a). |

---

## 참고 자료

### 이 문서가 따르는 결정·정본

- D-05(REST·MCP·WS·SSE의 도메인 서비스 공유) · D-13(하트비트·stale) · D-14(fail-open, 진실은 서버 산출물) — [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md)
- 확정 스택 전문과 결정일·재검토 트리거 — [3.2 시스템 아키텍처](../03-proposal/architecture.md) §4, [4.1 MVP 범위와 스택 확정](scope.md). 실시간 채널(WebSocket + SSE)·방송 MQ(Valkey) 확정은 2026-08-21
- 상수 정본 — 리스 TTL 30분 · 하트비트 60초 · 세션 stale 30분 · blob TTL 30일([3.4](../03-proposal/agent-integration.md) §2.7·§5.2, [3.2](../03-proposal/architecture.md) §2.5)
- 테이블 29종의 의미 — [3.3 데이터 모델](../03-proposal/data-model.md) §1.3 / DDL·이벤트 방송 규약 — [4.3 데이터베이스 스키마](database.md)
- ingest 엔드포인트 5종(`/ingest/hooks/session`·`tool`·`subagent`·`stop`·`session-end`)과 클라이언트 환경변수 — [3.4](../03-proposal/agent-integration.md) §3.3
- clemvion 관례 — `clemvion:k8s/` base+overlays kustomize 구조([3.2](../03-proposal/architecture.md) §4.2 배포 행)

### 외부 출처 (기존 제안서에서 이미 인용된 URL만 재인용)

- [MCP Streamable HTTP transport (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) — (2026-08-13 확인) `/mcp` 프록시가 스트리밍 응답을 버퍼링하지 않아야 하는 근거와 Origin 검증 요구(§5.4·REQ-CB-013).
- [Hooks reference — Claude Code Docs](https://code.claude.com/docs/en/hooks) — (2026-08-13 확인) `type:"http"` 훅이 POST하는 ingest 경로·헤더 규약의 클라이언트 측 정본(§2.4).

### 이 문서와 연결되는 제안서 문서

- [4.1 MVP 범위와 스택 확정](scope.md) — 이 문서가 전제하는 스택·범위의 확정본
- [4.3 데이터베이스 스키마](database.md) — `packages/schema`가 선언하는 DDL·NOTIFY 규약의 정본
- [4.4 API 명세](api.md) — §2 표면들이 노출하는 REST·WS 계약의 전표
- [4.6 플러그인과 온보딩](plugin.md) — 에이전트 장비 쪽 설치·환경변수 절차
- [4.8 백로그](backlog.md) — E01 저장소 부트스트랩 에픽과 운영 Postgres 위치 확인 태스크
- [3.2 시스템 아키텍처](../03-proposal/architecture.md) — 컴포넌트 책임·배포 원형(§4.4)
- [3.4 에이전트 연동 설계](../03-proposal/agent-integration.md) — MCP 도구 17종·훅·ingest의 정본
- [3.3 데이터 모델](../03-proposal/data-model.md) — 엔티티 29종 필드 의미의 정본
