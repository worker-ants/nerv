# Codex 초안 2종 (MVP 수동 경로 — REQ-PLG-010)

Codex 세션이 NERV 에 붙는 데 필요한 파일 둘이다. **쓰는 저장소로 복사한다**:

```bash
mkdir -p <repo>/.codex && cp config.toml <repo>/.codex/config.toml
```

**AGENTS.md 는 복사하지 않는다**(2026-10-16 · 4.6 §5.3). `bin/nerv-init` 이 서버에서 이 프로젝트의 본문(서버 주소 · 키 ·
규약 스펙 목록)을 받아 만들고, 이미 있으면 NERV 구역(`<!-- nerv:begin -->` ~ `<!-- nerv:end -->`)만 바꾼다. 이 폴더의
`AGENTS.md` 는 템플릿의 사본이다 — 정본은 `@nerv/schema` 의 `agents-md.ts` 이고 테스트가 바이트로 대조한다.

복사한 뒤 `config.toml` 의 `url` 과 `X-NERV-Project` 를 자기 값으로 바꾸고,
`NERV_TOKEN` 환경변수에 PAT 를 넣는다(발급은 웹 설정 → 토큰).

**여기 두는 이유.** 이 파일들이 있어야 할 곳은 NERV 저장소가 아니라 **쓰는 쪽 저장소**다.
NERV 저장소 루트에 `.codex/config.toml` 을 두면 이 저장소에서 도는 Codex 세션이
`api.nerv.example.com` 에 접속하려 든다 — 템플릿으로 배포하고 사람이 복사하는 편이 맞다.

**토큰은 셸 환경변수로 둔다.** Codex 는 `bearer_token_env_var` 의 값을 자기 프로세스 환경에서만 읽는다 —
`.nerv/env` 의 토큰은 MCP 인증에 쓰이지 않는다(4.6 §3.3).

**플러그인도 설치하면 훅이 돈다**(2026-10-16 · 4.6 §5.4). `codex plugin marketplace add worker-ants/nerv` ·
`codex plugin add nerv@nerv` 로 설치하고 Codex 의 `/hooks` 에서 NERV 훅 여덟을 신뢰 처리한다. 세션이 `codex` 로 기록되고
`nerv_bootstrap` 세션과 한 세션으로 이어진다. 훅은 `.nerv/env` 의 `NERV_SERVER` · `NERV_PROJECT` 를 읽는다.

**턴 완료 알림(notify)은 사용자 설정에 둔다**(2026-10-16 · 4.6 §5.2). Codex 는 저장소 설정의 `notify` · `[otel]` 을
무시한다. `config.toml` 끝의 주석에 있는 `notify = [...]` 줄을 `~/.codex/config.toml` 의 맨 위(표 이름 앞)에 둔다 —
설치 캐시의 포워더를 찾아 부르고, 플러그인이 없으면 아무것도 하지 않는다. 사용자 설정이라 모든 저장소의 턴에
불리지만 포워더는 **NERV 를 설정한 저장소**(`.nerv/env` · 저장소 `.codex/config.toml` 의 `[mcp_servers.nerv]` ·
`.mcp.json` 의 `nerv`)의 턴만 보낸다 — 다른 저장소의 답변은 서버로 나가지 않는다(4.6 §5.2 · REQ-PLG-038).

자동 생성·검증 스크립트는 Phase 2 다([4.6 플러그인과 온보딩](../../docs/04-mvp/plugin.md) §5.1).
