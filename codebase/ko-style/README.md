# ko-style v0.1.1

한국어 문체 플러그인이다. 번역투, 사물에 사람의 동작을 붙이는 비유, 이중 피동, 줄표로 길게 잇는 문장, 말투 섞임을 찾아 고치게 한다. NERV 서버 없이도 동작한다. **정본은 [docs/04-mvp/plugin.md](../../docs/04-mvp/plugin.md) §7** 이고, 두 쪽이 다르면 문서가 맞고 여기가 결함이다.

## 무엇이 들어 있나

| 경로                                  | 역할                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`          | 매니페스트                                                                                                                                                           |
| `hooks/hooks.json`                    | 훅 여섯 — 세션 요약(SessionStart · SubagentStart) · 커밋 · PR 명령 전(PreToolUse) · 문서 저장 직후(PostToolUse) · 답변이 끝난 뒤(Stop) · 다음 요청(UserPromptSubmit) |
| `hooks/run.sh`                        | 훅 진입점 — 부를 필요가 없으면 node 를 띄우지 않고 끝낸다                                                                                                            |
| `hooks/digest.json`                   | node 가 없을 때 넣는 세션 요약 (`rules/core.json` 에서 생성)                                                                                                         |
| `skills/ko-style/SKILL.md`            | 규칙과 예문 — 모델이 한국어 글을 쓸 때 읽는다                                                                                                                        |
| `skills/ko-style/rules/core.json`     | 공통 규칙 표(규범 · AI 말투) — 이 플러그인의 정본 데이터                                                                                                             |
| `skills/ko-style/scripts/ko-lint.mjs` | 검사기 — 훅 · CI · 사람이 같은 판정을 쓴다. 의존성이 없다                                                                                                            |
| `skills/check/SKILL.md`               | `/ko-style:check` — 파일 · 스테이징 · 브랜치의 새 문장 검사와 고쳐 쓰기 제안                                                                                         |
| `skills/init/SKILL.md`                | `/ko-style:init` — 저장소에 `.ko-style.json` 만들기                                                                                                                  |

## 설치

NERV 플러그인과 같은 마켓플레이스에 있다.

```bash
/plugin marketplace add https://<NERV 서버>/plugin/marketplace.json   # 또는 worker-ants/nerv
/plugin install ko-style@nerv
```

설치하면 모든 저장소에서 켜진다. 팀 어휘와 글 종류별 말투는 저장소마다 `.ko-style.json` 으로 정한다(`/ko-style:init`). 이 파일이 없으면 `*.md` 문서를 공통 규칙으로만 검사하고 말투는 강제하지 않는다. 특정 저장소에서 끄려면 `.ko-style.json` 에 `"enabled": false` 를 두고, 잠깐 끄려면 환경 변수 `KO_STYLE_DISABLE=1` 을 준다.

## 규칙을 고칠 때

1. `skills/ko-style/rules/core.json` 을 고친다. 규칙마다 `examples.bad`(걸려야 할 예문)와 `examples.good`(걸리지 않아야 할 예문)을 적는다.
2. `node skills/ko-style/scripts/ko-lint.mjs sync` 로 `SKILL.md` 의 규칙 표와 `hooks/digest.json` 을 다시 만든다.
3. `pnpm --filter @nerv/ko-style test` — 예문 · 생성물 · 훅 입출력을 확인한다.
4. `.claude-plugin/plugin.json` 의 `version` 을 올리고 저장소 루트 `.claude-plugin/marketplace.json` · `package.json` · 이 README 제목을 맞춘다. **같은 버전이면 설치한 쪽은 옛 사본을 계속 쓴다.**
