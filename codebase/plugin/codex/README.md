# Codex 초안 2종 (MVP 수동 경로 — REQ-PLG-010)

Codex 세션이 NERV 에 붙는 데 필요한 파일 둘이다. **쓰는 저장소로 복사한다**:

```bash
mkdir -p <repo>/.codex && cp config.toml <repo>/.codex/config.toml
cp AGENTS.md <repo>/AGENTS.md      # 이미 있으면 §단일 진실·§세션 시작 절만 옮긴다
```

복사한 뒤 `config.toml` 의 `url` 과 `X-NERV-Project` 를 자기 값으로 바꾸고,
`NERV_TOKEN` 환경변수에 PAT 를 넣는다(발급은 웹 설정 → 토큰).

**여기 두는 이유.** 이 파일들이 있어야 할 곳은 NERV 저장소가 아니라 **쓰는 쪽 저장소**다.
NERV 저장소 루트에 `.codex/config.toml` 을 두면 이 저장소에서 도는 Codex 세션이
`nerv.example.com` 에 접속하려 든다 — 템플릿으로 배포하고 사람이 복사하는 편이 맞다.

자동 생성·검증 스크립트는 Phase 2 다([4.6 플러그인과 온보딩](../../docs/04-mvp/plugin.md) §5.1).
