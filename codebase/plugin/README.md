# nerv-plugin v0.2.3

NERV 협업 플랫폼의 Claude Code 플러그인. **정본은 [docs/04-mvp/plugin.md](../../docs/04-mvp/plugin.md)**
이고, 이 디렉터리는 그 문서 §1~§3 전문의 실물이다 — 두 쪽이 다르면 문서가 옳고 여기가 결함이다.

## 무엇이 들어 있나

| 경로                                                      | 역할                                             | 정본           |
| --------------------------------------------------------- | ------------------------------------------------ | -------------- |
| `.claude-plugin/plugin.json`                              | 매니페스트                                       | §1.1           |
| `.claude-plugin/marketplace.json`                         | 사내 마켓플레이스 등록                           | §1.2 배포 경로 |
| `hooks/hooks.json`                                        | 훅 이벤트 6종(`type:"http"`) — 세션 시작은 둘    | §3.1           |
| `skills/{next,spec,impl,question,import,review}/SKILL.md` | 스킬 6종(MVP 약속은 5종 · `review` 는 P2 배포분) | §2.1~§2.6      |
| `agents/nerv-spec-writer.md`                              | 스펙 초안 전용 서브에이전트(코드 쓰기 도구 없음) | §1.1           |
| `statusline/nerv-statusline.sh`                           | 클레임·리스·겹침 표시                            | §3.2           |
| `bin/nerv-hook-forward`                                   | 훅 헤더 토큰 확장이 안 되는 호스트용 폴백        | §3.1 주의      |
| `bin/nerv-outbox`                                         | 오프라인 쓰기 큐(enqueue·flush·status)           | §3.4           |

## 설계에서 물러서지 않는 두 가지

1. **A3 도구는 어느 스킬의 `allowed-tools` 에도 없다.** `nerv_spec_submit_review` 가 그것이다 —
   검토 요청은 사람이 누른다(REQ-PLG-003). 목록에 넣는 순간 승인 게이트는 형식이 된다.
2. **훅은 텔레메트리 평면이다.** 끊겨도 세션은 진행되고 게이트는 서버가 유지한다. 그래서
   `nerv-hook-forward` 는 실패해도 exit 0 이다 — 훅 실패가 세션을 멈추면 텔레메트리가
   조정 경로가 되어버린다.

## 설치 (사람 온보딩 5단계 — §4)

```bash
# 1) 웹 S8 설정 → 에이전트 토큰 발급 (원문은 1회만 표시된다)
# 2) 환경변수
export NERV_TOKEN="<S8에서 발급한 PAT>"
export NERV_PROJECT="clemvion"
export NERV_HOSTNAME="$(hostname -s)"

# 3) 플러그인 설치 (관리 기기는 관리형 settings 로 자동)
#    /plugin marketplace add <사내 마켓플레이스 git URL>
#    /plugin install nerv@nerv-internal   → 재시작
# 4) /mcp 로 nerv 서버 connected 확인
# 5) /nerv:next 실행 — 스킬이 nerv_bootstrap 부터 호출한다
```

설치 시 작업 저장소의 `.gitignore` 에 `.nerv/` 를 추가한다(REQ-PLG-013) — 캐시·큐가 커밋되면
그 자체가 clemvion 식 git 비대화(P6)다.

## 마켓플레이스 없이 쓰는 저장소 — 사본을 다시 맞추는 법

사내 마켓플레이스가 없는 로컬 시험에서는 플러그인을 설치하는 대신 **스킬과 서브에이전트를
그 저장소로 복사해** 쓴다. 그때 갈리는 것이 셋이다.

- **훅과 statusline은 사본이 아니다.** 그 저장소의 `.claude/settings.json` 이 이 디렉터리의
  스크립트를 **절대 경로로** 부르므로 원본이 바뀌면 저절로 따라온다. 대신 `type` 이 다르다 —
  원본은 `type:"http"` 이고, 토큰을 주입해야 하는 그쪽은 `bin/nerv-hook-forward` 를 부르는
  `type:"command"` 다. 그래서 **훅 목록만은 손으로 옮긴다.**
- **한 이벤트에 훅이 여럿일 수 있다.** `SessionStart` 가 그렇다(세션 적재 + `nerv-outbox flush`,
  2026-09-01). 이벤트 이름만 보고 "이미 있다" 고 넘기면 늘어난 쪽을 놓친다 — 대조는 이벤트가
  아니라 **훅 항목 수**로 한다.
- **스킬 이름이 달라진다.** 플러그인 네임스페이스가 없으므로 `/nerv:next` 가 아니라
  `/nerv-next` 이고, 프런트매터의 `name:` 도 같이 바뀐다. 그 두 군데 말고는 바이트가 같아야 한다.

원본이 바뀌면 **그 저장소 루트에서** 이렇게 맞춘다.

```bash
SRC=/path/to/nerv/codebase/plugin
for s in next spec impl question review import; do
  mkdir -p ".claude/skills/nerv-$s"
  sed -e "1,10s/^name: $s$/name: nerv-$s/" -e 's|/nerv:\([a-z]*\)|/nerv-\1|g' \
    "$SRC/skills/$s/SKILL.md" > ".claude/skills/nerv-$s/SKILL.md"
done
sed 's|/nerv:\([a-z]*\)|/nerv-\1|g' "$SRC/agents/nerv-spec-writer.md" \
  > .claude/agents/nerv-spec-writer.md
```

맞춰졌는지 확인한다 — 스킬·서브에이전트는 위 변환을 뺀 바이트가 같아야 하고, 훅은 이벤트마다
항목 수가 같아야 한다.

```bash
for s in next spec impl question review import; do
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
bin/nerv-outbox status    # SessionEnd 잔량 보고
```

큐는 위임 판단을 대신하지 않는다: 오프라인 동안 신규 클레임 발급·`ready` 전이는 금지 그대로다.
큐잉 가능한 것은 이미 쥔 클레임 위의 상태 보고·질문·증적뿐이다.
