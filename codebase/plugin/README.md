# nerv-plugin v0.3.33

NERV 협업 플랫폼의 Claude Code 플러그인. **정본은 [docs/04-mvp/plugin.md](../../docs/04-mvp/plugin.md)**
이고, 이 디렉터리는 그 문서 §1~§3 전문의 실물이다 — 두 쪽이 다르면 문서가 옳고 여기가 결함이다.

## 무엇이 들어 있나

| 경로                                                              | 역할                                                                                                                                           | 정본           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `.claude-plugin/plugin.json`                                      | 매니페스트                                                                                                                                     | §1.1           |
| `.claude-plugin/marketplace.json`                                 | 사내 마켓플레이스 등록                                                                                                                         | §1.2 배포 경로 |
| `hooks/hooks.json`                                                | 훅 이벤트 6종(**기본은 `type:"command"`**) — 세션 시작은 둘                                                                                    | §3.1           |
| `skills/{next,spec,impl,question,review,mirror,approve}/SKILL.md` | 스킬 7종(`review`는 P2 배포분 · `mirror`는 2026-10-07 · `approve`는 2026-10-11 · `import`는 2026-09-06 제거 — 4.6 §2.5)                        | §2.1~§2.8      |
| `agents/nerv-spec-writer.md`                                      | 스펙 초안 전용 서브에이전트(코드 쓰기 도구 없음)                                                                                               | §1.1           |
| `agents/nerv-code-reviewer.md`                                    | 코드 리뷰 서브에이전트 — 종류 `code` 로 직접 제출한다(코드 쓰기 · 처분 도구 없음 · 2026-10-15)                                                 | §1.2           |
| `agents/nerv-consistency-checker.md`                              | 스펙 ↔ 구현 정합 리뷰 서브에이전트 — 종류 `consistency` 로 직접 제출한다(같은 제한 · 2026-10-15)                                               | §1.2           |
| `statusline/nerv-statusline.sh`                                   | 클레임·리스·겹침 표시                                                                                                                          | §3.2           |
| `bin/nerv-hook-forward`                                           | 기본 변형의 훅 전송기 — http 변형도 SessionStart 는 이것을 쓴다                                                                                | §3.1           |
| `bin/nerv-init`                                                   | 설치 부트스트랩 — 저장소의 설정 세 자리와 AGENTS.md 의 NERV 구역을 만든다(덮지 않는다 · AGENTS.md 는 구역만 바꾼다). `--codex` 는 Codex 온보딩 | §3.7 · §5.3    |
| `bin/nerv-outbox`                                                 | 오프라인 쓰기 큐(enqueue·flush·kick·status) — 서버가 돌아오면 포워더가 백그라운드로 비운다                                                     | §3.4           |
| `bin/nerv-mirror`                                                 | 스펙 미러 — 문서 · 첨부를 로컬 폴더에 받는다. 본체는 `skills/mirror/scripts/nerv-mirror.mjs`(의존성 없음)                                      | §2.7           |
| `hooks/hooks.http.json`                                           | 훅 URL 을 관리형으로 묶을 때의 변형(`type:"http"` · SessionStart 만 command)                                                                   | §3.1           |
| `codex/config.toml`                                               | Codex 용 MCP 접속 템플릿 · 사용자 설정에 옮길 notify 줄(주석) — 저장소의 파일은 `nerv-init --codex` 가 만든다                                  | §5.2 · §3.7    |
| `codex/AGENTS.md`                                                 | AGENTS.md 템플릿의 사본 — 정본은 `@nerv/schema` 의 `agents-md.ts`. 서버가 프로젝트마다 채운 본문을 `nerv-init` 이 받는다                       | §5.3           |
| `managed-settings.example.json`                                   | 조직 관리형 설정 예시(마켓플레이스·허용 도구·관리형 설치 표시 `NERV_MANAGED`)                                                                  | §3.5           |

**테스트는 이 폴더에 두지 않는다**(2026-10-16 · REQ-PLG-037). 설치하면 이 폴더가 통째로 설치 캐시에 복사된다 —
Codex 0.162.1 은 `.gitignore` 도 보지 않았다. 문서 대조 · 포워더 · 오프라인 큐 · 미러 테스트는 `../plugin-test/` 에 있다.

## Codex 에서 (2026-10-16 · 4.6 §5.4)

Codex 0.162.1 도 같은 매니페스트 · 같은 `hooks/hooks.json` 으로 이 플러그인을 설치한다.

```bash
codex plugin marketplace add worker-ants/nerv
codex plugin add nerv@nerv     # 그다음 Codex 의 /hooks 에서 NERV 훅 여덟을 신뢰 처리한다
```

- **MCP 는 플러그인이 아니라 저장소의 `.codex/config.toml` 이 붙인다** — `bin/nerv-init --codex` 가 그 파일과 `.nerv/env` ·
  AGENTS.md 를 없을 때만 만든다(Codex 온보딩 · 4.6 §3.7 · REQ-PLG-040). 토큰은 셸 환경변수 `NERV_TOKEN` 에 둔다 — 온보딩은
  토큰을 파일에 쓰지 않는다. `.nerv/env` 는 훅만 읽는다(4.6 §3.3).
- 포워더는 Codex 를 `PLUGIN_ROOT` 로 알아보고 `X-NERV-Agent: codex` 를 보낸다. 서버는 그 호스트가 받는 판정 필드만
  돌려준다 — Codex 는 모르는 필드가 있으면 훅을 실패로 끝낸다(REQ-PLG-034 · REQ-API-323).
- `hooks/hooks.json` 의 최상위에는 `description` · `hooks` 만 둔다. `$comment` 하나로 Codex 는 훅 여섯을 모두 버렸다(REQ-PLG-035).
- 턴 완료 알림(notify)은 사용자 설정(`~/.codex/config.toml`)에 한 줄을 둔다 — `codex/config.toml` 의 주석에 있다.
  저장소 설정의 `notify` 는 Codex 가 무시한다. 그 줄이 설치 캐시의 포워더를 찾아 `--event notify` 로 보낸다(REQ-PLG-038).
  사용자 설정이라 모든 저장소의 턴에 불리지만 포워더는 NERV 를 설정한 저장소의 턴만 보낸다 — 판정은 `bin/nerv-env.sh` 의
  `nerv_config_root` 이고 훅 · 오프라인 큐 · `nerv-init --check` 도 같은 함수를 쓴다(아래).
- `/nerv:approve` 는 Codex 에서 쓰지 않는다. 서브에이전트는 Codex 목록에 없다.

## 설계에서 물러서지 않는 두 가지

1. **A3 도구는 어느 스킬의 `allowed-tools` 에도 없다.** `nerv_spec_submit_review` 와 `nerv_spec_approve` 가
   그것이다 — 검토 요청과 세션에서의 승인은 사람이 그 자리에서 허용한다(REQ-PLG-003 · 029). 목록에 넣는
   순간 승인 게이트는 형식이 된다.
2. **훅은 텔레메트리 평면이다.** 끊겨도 세션은 진행되고 게이트는 서버가 유지한다. 그래서
   `nerv-hook-forward` 는 실패해도 exit 0 이다 — 훅 실패가 세션을 멈추면 텔레메트리가
   조정 경로가 되어버린다.

## 설치 (사람 온보딩 5단계 — §4)

```bash
# 1) 웹 설정 → 에이전트 토큰 발급 (원문은 1회만 표시된다)
# 2) 플러그인 설치 (관리 기기는 관리형 settings 로 자동)
#    /plugin marketplace add <사내 마켓플레이스 git URL>
#    /plugin install nerv@nerv-internal   → 재시작
#    (GitHub 경로는 /plugin marketplace add worker-ants/nerv → /plugin install nerv@nerv)

# 3) 작업 저장소에서 한 번 — .mcp.json · settings.local.json 의 env · .gitignore · AGENTS.md 의 NERV 구역을 만든다.
#    셸에서는 ${CLAUDE_PLUGIN_ROOT} 가 풀리지 않으므로 설치 캐시에서 고른다(4.6 §3.7).
cd <작업 저장소>
"$(ls -d "$HOME"/.claude/plugins/cache/*/nerv/*/bin/nerv-init | sort -V | tail -1)"

# 4) Claude Code 재시작 → /mcp 로 nerv 서버 connected 확인
# 5) /nerv:next 실행 — 스킬이 nerv_bootstrap 부터 호출한다
```

`nerv-init` 은 **이미 있는 값을 덮지 않는다** — 인자로 다른 값을 줘도 파일이 이기고, 부딪친
사실을 말한다. 남의 `settings.local.json` 에는 그 사람의 권한 규칙이 산다. `.gitignore` 의
`.nerv/` 도 여기서 선다(REQ-PLG-013) — 캐시·큐가 커밋되면 그 자체가 clemvion 식 git 비대화(P6)다.

**AGENTS.md 는 서버가 만든다**(2026-10-16 · 4.6 §5.3 · REQ-PLG-039). `nerv-init` 이 토큰으로 서버의 본문(그 프로젝트의
서버 주소 · 키 · 규약 스펙 목록)을 받아 파일이 없으면 만들고, 있으면 `<!-- nerv:begin -->` ~ `<!-- nerv:end -->` 구역만
바꾼다. 구역이 없는 AGENTS.md 는 사람이 쓴 파일이라 덮지 않고 표시 두 줄을 넣으라고 말한다. 세션 시작 훅은 구역의
규약 버전이 서버와 다르면 한 줄로 알린다.

`.mcp.json` 자체는 **여전히 플러그인이 담지 않는다**(REQ-PLG-001 개정, 2026-09-04): 서버 주소·
토큰은 저장소마다 다르고, 플러그인이 준 파일은 그 저장소의 `settings.local.json` `env` 를 읽지
못해 언제나 기본값으로 떨어졌다. 담을 수 없는 것과 손으로 만들어야 하는 것이 다를 뿐이다 —
플러그인이 담는 것은 파일이 아니라 **그 파일을 쓰는 스크립트**다.

설정이 덜 된 저장소에서는 세션 시작 훅(`nerv-init --check`)이 무엇이 없는지 말한다. **쓰지는
않는다** — 설정은 사람이 시작한다. NERV 를 쓰는 흔적이 하나도 없는 저장소에서는 침묵한다.

**훅은 NERV 를 설정한 저장소에서만 보낸다**(2026-10-16 · 사람 결정 · 4.6 §3.1 · REQ-PLG-041). 플러그인은 기계에 하나라
훅이 모든 저장소에서 돈다. 포워더는 훅 입력의 `cwd` 나 그 git 저장소의 맨 위에 설정(`.nerv/env` · `.mcp.json` 의 `nerv` ·
`.codex/config.toml` 의 `[mcp_servers.nerv]` · `settings.local.json` 의 `NERV_*`)이 있거나 관리형 settings 의 env 에
`NERV_MANAGED=1` 이 있을 때만, 토큰이 있을 때만 보낸다. 아니면 출력 없이 성공으로 끝난다. 셸에만 토큰을 두고 `nerv-init`
하지 않은 저장소의 훅은 아무것도 보내지 않는다 — `--check` 가 그 사실을 알린다. 오프라인 큐도 같은 판정이다. http 변형의
http 훅은 포워더를 거치지 않아 막지 못한다 — 그 변형은 관리형 settings 로 내리는 기계에만 쓴다.

## 마켓플레이스 없이 쓰는 저장소 — 사본을 다시 맞추는 법

사내 마켓플레이스가 없는 로컬 시험에서는 플러그인을 설치하는 대신 **스킬과 서브에이전트를
그 저장소로 복사해** 쓴다. 그때 갈리는 것이 셋이다.

- **훅과 statusline은 사본이 아니다.** 그 저장소의 `.claude/settings.json` 이 이 디렉터리의
  스크립트를 **절대 경로로** 부르므로 원본이 바뀌면 저절로 따라온다. 훅 목록만은 손으로 옮긴다 —
  **기본 변형은 `type:"command"`**(`bin/nerv-hook-forward` 를 부른다)이고, `type:"http"` 판이
  필요하면 `hooks/hooks.http.json` 을 쓴다. 고르는 기준과 그 대가는 4.6 §3.1 이 정본이다.
  (2026-09-06 정정 — 이 절이 오래 원본을 `type:"http"` 라 적고 있었다: 틀린 대로 따라 하면
  사본 저장소의 훅이 반대로 깔린다.)
- **한 이벤트에 훅이 여럿일 수 있다.** `SessionStart` 가 그렇다(세션 적재 + `nerv-outbox flush`,
  2026-09-01). 이벤트 이름만 보고 "이미 있다" 고 넘기면 늘어난 쪽을 놓친다 — 대조는 이벤트가
  아니라 **훅 항목 수**로 한다.
- **스킬 이름이 달라진다.** 플러그인 네임스페이스가 없으므로 `/nerv:next` 가 아니라
  `/nerv-next` 이고, 프런트매터의 `name:` 도 같이 바뀐다. 그 두 군데 말고는 바이트가 같아야 한다.

원본이 바뀌면 **그 저장소 루트에서** 이렇게 맞춘다.

```bash
SRC=/path/to/nerv/codebase/plugin
for s in next spec impl question review approve; do
  mkdir -p ".claude/skills/nerv-$s"
  sed -e "1,10s/^name: $s$/name: nerv-$s/" -e 's|/nerv:\([a-z]*\)|/nerv-\1|g' \
    "$SRC/skills/$s/SKILL.md" > ".claude/skills/nerv-$s/SKILL.md"
done
mkdir -p .claude/agents
for a in nerv-spec-writer nerv-code-reviewer nerv-consistency-checker; do
  sed 's|/nerv:\([a-z]*\)|/nerv-\1|g' "$SRC/agents/$a.md" > ".claude/agents/$a.md"
done
```

`mirror` 는 복사하지 않는다 — 그 스킬은 플러그인이 PATH 에 두는 `bin/nerv-mirror` 를 부르므로 사본만으로는
돌지 않는다. `import` 는 2026-09-06 에 없앴다([4.6 플러그인](../../docs/04-mvp/plugin.md) §2.5).

맞춰졌는지 확인한다 — 스킬·서브에이전트는 위 변환을 뺀 바이트가 같아야 하고, 훅은 이벤트마다
항목 수가 같아야 한다.

```bash
for s in next spec impl question review approve; do
  diff -q <(sed -e "1,10s/^name: $s$/name: nerv-$s/" -e 's|/nerv:\([a-z]*\)|/nerv-\1|g' \
    "$SRC/skills/$s/SKILL.md") ".claude/skills/nerv-$s/SKILL.md" >/dev/null \
    && echo "$s ok" || echo "$s OUT OF SYNC"
done
python3 -c "
import json
h=json.load(open('$SRC/hooks/hooks.json'))['hooks']
s=json.load(open('.claude/settings.json'))['hooks']
n=lambda d,e: sum(len(m.get('hooks',[])) for m in d.get(e,[]))
for e in h: print(e, n(h,e), n(s,e), 'ok' if n(h,e)==n(s,e) else 'OUT OF SYNC')
"
```

**서버 쪽 계약이 바뀐 것은 여기에 적지 않는다.** 그 정본은
[docs/README.md](../../docs/README.md) 의 변경 로그이고, 사본 저장소에 요약을 두면
그 요약이 낡는다 — 낡은 요약은 없는 것보다 나쁘다.

## 오프라인 폴백

`NERV_UNAVAILABLE` 을 받은 **쓰기**만 큐잉한다. 4xx 는 큐잉하지 않는다 — 재전송해도 같은
실패이고, 충돌 계열은 시간이 지나면 의미가 달라진다.

```bash
echo '{"task_id":"TSK-a3f8","status":"in_progress"}' \
  | bin/nerv-outbox enqueue nerv_task_update 01991f2a-… S-b7e9
bin/nerv-outbox flush     # 서버 복구 후 — oldest-first, 원래 멱등 키 그대로
bin/nerv-outbox kick      # 보낼 것이 있으면 flush 를 백그라운드로 띄운다(포워더가 부른다)
bin/nerv-outbox status    # 잔량 · 실패 · 서버에 알리지 못한 실패
```

**서버가 돌아오면 바로 비운다**(2026-10-16 · 4.6 §3.4 · REQ-PLG-032). 데몬은 없다. 훅 포워더가 서버에서
2xx 를 받으면 `kick` 을 부르고 큐에 항목이 있으면 flush 가 분리된 백그라운드 프로세스로 돈다 — 훅은
기다리지 않는다. 잠금(`.nerv/outbox/.flush.lock`)으로 한 저장소에서 flush 는 하나만 돈다. 세션 시작 훅의
flush 도 그대로 있다. http 변형(`hooks/hooks.http.json`)은 포워더가 세션 시작에만 돌아서 그때만 비운다.

**서버가 거절한 쓰기는 사람에게 알린다**(REQ-PLG-033). 그 항목은 사유와 함께 `.nerv/outbox/failed/` 로 가고
flush 가 `/ingest/hooks/outbox-failed` 로 알린다 — 서버가 그 사람에게 중요 알림을 만든다. 401 · 429 ·
`NERV_UNAVAILABLE` · 같은 키가 아직 도는 중 · 연결 실패는 그 쓰기의 판정이 아니라서 항목을 남기고 멈춘다.
알리지 못한 실패는 다음 flush 가 다시 알리고 그동안 세션 시작 안내와 `status` 에 나온다.

큐는 위임 판단을 대신하지 않는다: 오프라인 동안 신규 클레임 발급·`ready` 전이는 금지 그대로다.
큐잉 가능한 것은 이미 쥔 클레임 위의 상태 보고·질문·증적뿐이다.
