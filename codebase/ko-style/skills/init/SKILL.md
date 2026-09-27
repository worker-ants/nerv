---
name: init
description: 사용자가 /ko-style:init 으로 부를 때 쓴다. 저장소 루트에 .ko-style.json(글 종류별 말투 · 팀 어휘 · 검사에서 뺄 경로)을 만든다. 이미 있으면 덮지 않는다.
license: Apache-2.0
---

# /ko-style:init — 저장소 설정 만들기

`.ko-style.json` 은 저장소에 커밋하는 팀 설정이다. 플러그인은 사용자마다 설치되지만 이 파일은 팀 전체가 함께 쓴다.

## 절차

1. 저장소 루트(`git rev-parse --show-toplevel`)에 `.ko-style.json` 이 있는지 본다. **있으면 덮지 않는다.** 지금 내용을 보여 주고 더할 것을 제안하는 데서 멈춘다.
2. 저장소에서 한국어 글이 있는 곳을 찾는다. 문서(`docs/` · `README.md`), 화면 문구(`ko.json` · `ko.ts` 같은 번역 파일), 도움말 · 매뉴얼, 에이전트 지침(`AGENTS.md` · `CLAUDE.md` · `SKILL.md`)이 후보다.
3. 자리마다 지금 쓰는 말투를 확인한다. 말투를 정해서 파일 몇 개를 검사해 보면 섞인 곳이 보인다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/ko-style/scripts/ko-lint.mjs" check <파일> --tone hapsyo --levels warn
   ```

4. 글 종류마다 어떤 말투로 쓸지 사용자에게 묻는다(합쇼체 · 해요체 · 해라체 · 정하지 않음). 추측으로 정하지 않는다.
5. 팀 용어 사전이나 문체 규칙 문서가 있으면 그 표를 `team` 규칙으로 옮길지 묻는다. 옮길 때는 규칙마다 `id` · `name` · `avoid`(쓰지 않는 활용형 전부) · `use` · `examples`(걸려야 할 예문과 걸리지 않아야 할 예문)를 적는다.
6. 파일을 만든 뒤 규칙이 읽히는지 확인한다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/ko-style/scripts/ko-lint.mjs" rules
   ```

## 형식

```json
{
  "version": 1,
  "surfaces": [
    { "name": "도움말", "files": ["docs/help/**/*.md"], "tone": "hapsyo", "dash": "check" },
    { "name": "화면 문구", "files": ["src/i18n/ko.json"], "tone": "hapsyo", "dash": "check" },
    { "name": "개발 문서", "files": ["**/*.md"], "tone": "off", "dash": "check" }
  ],
  "commit": { "tone": "off", "dash": "check" },
  "reply": { "mode": "notify", "tone": "off", "dash": "check" },
  "ignore": ["docs/glossary.md"],
  "disable": [],
  "team": [
    {
      "id": "TEAM-01",
      "name": "싣다",
      "avoid": ["싣는다", "싣습니다", "실어"],
      "use": "담다 · 포함하다 · 넣다",
      "examples": { "bad": ["응답에 이유를 싣는다."], "good": ["응답에 이유를 포함한다."] }
    }
  ]
}
```

- `surfaces[]` 는 글 종류다. 파일은 목록에서 처음 맞는 종류로 검사하고, 어느 종류에도 들지 않으면 검사하지 않는다. `tone` 은 `hapsyo` · `haeyo` · `haera` · `off`, `dash` 는 `check` · `off`, `quotes` 는 `skip`(따옴표 안은 인용으로 보고 건너뛴다) · `check` 다.
- `commit` 은 커밋 메시지와 PR 본문, `reply` 는 대화 답변이다. `reply.mode` 는 `notify`(알림) · `rewrite`(한 번 다시 쓰기) · `off` 다.
- `ignore` 는 검사하지 않을 경로, `disable` 은 끌 규칙 ID 다.
- `team[]` 규칙은 `avoid` 대신 `pattern`(정규식)을 쓸 수 있다. `when` 을 주면 그 말 뒤에 올 때만 잡는다(예: `"when": "배지|버튼"` 과 `"avoid": ["세운다"]`).
- `enabled` 를 `false` 로 두면 이 저장소에서 모든 훅이 멈춘다.
