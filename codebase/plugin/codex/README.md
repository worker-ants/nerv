# Codex 온보딩 — `bin/nerv-init --codex` (2026-10-16 · REQ-PLG-040)

Codex 세션이 NERV 에 붙는 데 필요한 파일은 **쓰는 저장소**에 둔다. 손으로 복사하지 않고 온보딩 명령 한 줄로 만든다.

```bash
cd <작업 저장소>
"$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/nerv/*/bin/nerv-init | sort -V | tail -1)" \
  --codex --server <서버 주소> --project <프로젝트 슬러그>
```

없는 것만 만든다 — 이미 있는 값은 덮지 않고 그 사실을 말한다(`bin/nerv-init` 과 같은 규칙 · 4.6 §3.7).

| 자리                       | 하는 일                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `.codex/config.toml`       | MCP 접속 — 이 폴더의 `config.toml` 과 같은 내용에 서버 주소 · 프로젝트를 채운다(4.6 §5.2 전문) |
| `.nerv/env`                | `NERV_SERVER` · `NERV_PROJECT` — 훅과 notify 가 읽는다. **토큰은 쓰지 않는다**                |
| `.gitignore`               | `.nerv/`                                                                                      |
| `AGENTS.md` 의 NERV 구역   | 서버가 만든 본문(EP-PRJ-06)으로 만들거나 `<!-- nerv:begin -->` ~ `<!-- nerv:end -->` 만 바꾼다 |

`--codex --check` 는 아무것도 쓰지 않고 덜 된 설정을 말한다. Codex 의 세션 시작 훅이 부르는 `--check` 도 같다.

**토큰은 셸 환경변수로 둔다.** Codex 는 `bearer_token_env_var` 의 값을 자기 프로세스 환경에서만 읽는다 —
`.nerv/env` · `config.toml` 의 토큰은 MCP 인증에 쓰이지 않는다(4.6 §3.3). 온보딩 명령은 받은 토큰을 AGENTS.md 를 받는
데만 쓴다.

**이 폴더의 두 파일은 템플릿이다.** `config.toml` 은 손으로 둘 사람을 위한 사본이고(온보딩 명령은 4.6 §5.2 전문을 쓴다),
`AGENTS.md` 는 서버가 렌더하는 템플릿의 사본이다 — 정본은 `@nerv/schema` 의 `agents-md.ts` 이고 테스트가 바이트로
대조한다. NERV 저장소 자신에는 `.codex/config.toml` 을 두지 않는다 — 두면 이 저장소에서 도는 Codex 세션이
`api.nerv.example.com` 에 접속하려 든다.

**플러그인도 설치하면 훅이 돈다**(2026-10-16 · 4.6 §5.4). `codex plugin marketplace add worker-ants/nerv` ·
`codex plugin add nerv@nerv` 로 설치하고 Codex 의 `/hooks` 에서 NERV 훅 여덟을 신뢰 처리한다. 세션이 `codex` 로 기록되고
`nerv_bootstrap` 세션과 한 세션으로 이어진다. 훅은 `.nerv/env` 의 `NERV_SERVER` · `NERV_PROJECT` 를 읽는다. 온보딩 명령도
플러그인에 들어 있다.

**턴 완료 알림(notify)은 사용자 설정에 둔다**(2026-10-16 · 4.6 §5.2). Codex 는 저장소 설정의 `notify` · `[otel]` 을
무시한다. `config.toml` 끝의 주석에 있는 `notify = [...]` 줄을 `~/.codex/config.toml` 의 맨 위(표 이름 앞)에 둔다 —
온보딩 명령은 그 줄이 없으면 출력만 하고 사용자 설정에 쓰지 않는다. 설치 캐시의 포워더를 찾아 부르고, 플러그인이
없으면 아무것도 하지 않는다. 사용자 설정이라 모든 저장소의 턴에 불리지만 포워더는 **NERV 를 설정한 저장소**
(`.nerv/env` · 저장소 `.codex/config.toml` 의 `[mcp_servers.nerv]` · `.mcp.json` 의 `nerv`)의 턴만 보낸다 — 다른 저장소의
답변은 서버로 나가지 않는다(4.6 §5.2 · REQ-PLG-038).
