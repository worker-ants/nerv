# nerv-plugin v0.1.0

NERV 협업 플랫폼의 Claude Code 플러그인. **정본은 [docs/04-mvp/plugin.md](../../docs/04-mvp/plugin.md)**
이고, 이 디렉터리는 그 문서 §1~§3 전문의 실물이다 — 두 쪽이 다르면 문서가 옳고 여기가 결함이다.

## 무엇이 들어 있나

| 경로                                               | 역할                                             | 정본           |
| -------------------------------------------------- | ------------------------------------------------ | -------------- |
| `.claude-plugin/plugin.json`                       | 매니페스트                                       | §1.1           |
| `.claude-plugin/marketplace.json`                  | 사내 마켓플레이스 등록                           | §1.2 배포 경로 |
| `.mcp.json`                                        | MCP 서버 1개(`nerv`)                             | §3.3           |
| `hooks/hooks.json`                                 | 훅 6종(`type:"http"`)                            | §3.1           |
| `skills/{next,spec,impl,question,import}/SKILL.md` | 스킬 5종                                         | §2.1~§2.5      |
| `agents/nerv-spec-writer.md`                       | 스펙 초안 전용 서브에이전트(코드 쓰기 도구 없음) | §1.1           |
| `statusline/nerv-statusline.sh`                    | 클레임·리스·겹침 표시                            | §3.2           |
| `bin/nerv-hook-forward`                            | 훅 헤더 토큰 확장이 안 되는 호스트용 폴백        | §3.1 주의      |
| `bin/nerv-outbox`                                  | 오프라인 쓰기 큐(enqueue·flush·status)           | §3.4           |

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
