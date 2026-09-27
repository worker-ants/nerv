#!/bin/sh
# ko-style 훅 진입점 (docs/04-mvp/plugin.md §7)
#
# 부를 필요가 없는 경우는 node 를 띄우지 않고 끝낸다 — PreToolUse 는 모든 Bash 호출에 걸리므로
# 커밋·PR 명령이 아니면 여기서 돌려보낸다. 어떤 경우에도 exit 0 이다: 문체 검사가 세션을
# 멈추는 경로가 되면 안 된다.
#
# `sh run.sh <이벤트>` 로 부른다 — 실행 비트에 기대지 않는다(zip 이 모드를 잃어도 돈다).

event="$1"
root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
lint="$root/skills/ko-style/scripts/ko-lint.mjs"
data="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}/ko-style}"

[ "${KO_STYLE_DISABLE:-}" = "1" ] && { cat >/dev/null; exit 0; }

if ! command -v node >/dev/null 2>&1; then
  # node 가 없으면 규칙 요약만 넣는다 — 자동 검사는 돌지 않는다고 요약이 적는다
  cat >/dev/null
  [ "$event" = "session-start" ] && cat "$root/hooks/digest.json"
  exit 0
fi

case "$event" in
  pre-bash)
    input="$(cat)"
    case "$input" in
      *'git '*commit*|*'gh pr create'*|*'gh pr edit'*) ;;
      *) exit 0 ;;
    esac
    printf '%s' "$input" | node "$lint" hook pre-bash --data "$data" || true
    ;;
  prompt)
    if [ ! -f "$data/pending.json" ]; then
      cat >/dev/null
      exit 0
    fi
    node "$lint" hook prompt --data "$data" || true
    ;;
  *)
    node "$lint" hook "$event" --data "$data" || true
    ;;
esac
exit 0
