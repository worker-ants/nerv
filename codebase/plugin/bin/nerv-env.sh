#!/usr/bin/env bash
# nerv-env.sh — 프로젝트별 환경을 읽는다 (plugin.md §3.3)
#
# **셸 프로필의 export 는 기계에 하나뿐이다.** NERV 는 멀티 프로젝트가 전제인데 그렇게 두면
# 프로젝트를 옮길 때마다 프로필을 고치고 모든 세션을 다시 띄워야 한다 — 제품의 전제와 설치
# 절차가 어긋난다. 그래서 값을 **저장소 안의 파일**에서도 읽는다.
#
# 규칙 셋:
#   ① **이미 있는 값을 덮지 않는다.** 관리형 settings · CLI · 프로젝트 settings 가 더 강한
#      자리이므로(우선순위 표 §3.3), 이 파일은 비어 있는 칸만 채운다.
#   ② **`NERV_*` 만 읽는다.** 저장소에 굴러다니는 파일이 PATH 를 갈아 끼우지 못하게.
#   ③ 없으면 조용히 지나간다 — 셸 프로필로 쓰는 사람과 관리 기기가 그대로 동작해야 한다.
#
# 사용: 스크립트 머리에서 `. "$(dirname "${BASH_SOURCE[0]}")/nerv-env.sh"`

nerv_load_env() {
  local file="${NERV_ENV_FILE:-.nerv/env}" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in NERV_*) ;; *) continue ;; esac
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    [ -n "${!key:-}" ] || export "$key=$value"
  done <"$file"
}

nerv_load_env
