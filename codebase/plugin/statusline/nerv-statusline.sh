#!/usr/bin/env bash
# nerv-statusline.sh — 서버가 아는 사실의 로컬 투영. 네트워크 왕복 없음.
# 입력 1: stdin — Claude Code 세션 JSON
# 입력 2: .nerv/cache/claim.json — /nerv:impl 하트비트 응답이 갱신
set -euo pipefail

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
  end="$(date -j -f '%Y-%m-%dT%H:%M:%S%z' "${exp/Z/+0000}" +%s 2>/dev/null \
        || date -d "$exp" +%s 2>/dev/null || echo 0)"
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
