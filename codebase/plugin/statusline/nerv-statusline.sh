#!/usr/bin/env bash
# nerv-statusline.sh — 서버가 아는 사실의 로컬 투영. 네트워크 왕복 없음.
# 입력 1: stdin — Claude Code 세션 JSON
# 입력 2: .nerv/cache/claim.json — /nerv:impl 하트비트 응답이 갱신
set -euo pipefail

# 프로젝트별 환경(.nerv/env) — 같은 기계에서 저장소마다 다른 값을 쓴다(plugin.md §3.3)
. "$(dirname "${BASH_SOURCE[0]}")/../bin/nerv-env.sh"

input="$(cat)"
cache="${NERV_CACHE_DIR:-.nerv/cache}/claim.json"

model="$(jq -r '.model.display_name // "?"' <<<"$input")"
ctx="$(jq -r '.context_window.used_percentage // "?"' <<<"$input")"
cost="$(jq -r '.cost.total_cost_usd // empty' <<<"$input")"

if [[ ! -f "$cache" ]]; then
  printf '◇ NERV %s · 클레임 없음 — /nerv:next\n' "${NERV_PROJECT:-?}"
  printf '  %s · ctx %s%%%s\n' "$model" "$ctx" "${cost:+ · \$$cost}"
  exit 0
fi

task="$(jq -r '.task_id // "?"' "$cache")"
st="$(jq -r '.status // "?"' "$cache")"
exp="$(jq -r '.lease_expires_at // empty' "$cache")"
ov="$(jq -r '.scope_overlaps // 0' "$cache")"
fnd="$(jq -r '.findings_open // 0' "$cache")"

remain="--:--"
if [[ -n "$exp" ]]; then
  now="$(date +%s)"
  # 서버가 주는 값은 `2026-09-02T08:17:56.568Z` — **밀리초가 있다.** BSD date 는 그 모양을
  # `%Y-%m-%dT%H:%M:%S%z` 로 읽지 못해(GNU 는 읽는다) end=0 이 됐고, 그래서 macOS 에서는
  # 리스가 얼마 남았든 **언제나 "만료"** 로 보였다(실측 2026-09-02).
  iso="${exp%%.*}"; iso="${iso%Z}"
  end="$(date -j -u -f '%Y-%m-%dT%H:%M:%S' "$iso" +%s 2>/dev/null \
        || date -u -d "$exp" +%s 2>/dev/null || echo 0)"
  if (( end > now )); then
    remain="$(printf '%d:%02d' $(( (end - now) / 60 )) $(( (end - now) % 60 )))"
  else
    remain="만료"
  fi
fi

printf '◆ NERV %s · %s %s · 리스 %s 남음 · scope 겹침 %s\n' \
  "${NERV_PROJECT:-?}" "$task" "$st" "$remain" "$ov"
printf '  %s · ctx %s%%%s · 미해소 finding %s\n' \
  "$model" "$ctx" "${cost:+ · \$$cost}" "$fnd"
