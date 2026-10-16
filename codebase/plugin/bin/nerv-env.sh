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
#
# 이 파일은 판정도 하나 둔다 — `nerv_repo_configured <디렉터리>`: 그 저장소에 NERV 설정이 있는가.

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

# **이 저장소가 NERV 를 쓰는가** — 저장소 안의 설정만 본다(2026-10-16 · REQ-PLG-038).
#
# 셸 환경의 토큰 · 사용자 설정(`~/.codex/config.toml`)은 기계 전체의 값이라 NERV 와 무관한 저장소에서도 있다.
# Codex 의 notify 는 사용자 설정에만 둘 수 있어 모든 저장소의 턴에 불린다 — 그 값으로 판정하면 다른 저장소의 답변이
# 서버로 나간다. 포워더(notify)와 `nerv-init`(온보딩 · `--check`)이 이 함수 하나로 판정한다.
#   ① `.nerv/env` — 훅 · Codex 가 읽는 저장소의 값
#   ② `.codex/config.toml` 의 `[mcp_servers.nerv]` — Codex 의 MCP 연결
#   ③ `.mcp.json` 의 `nerv` — Claude Code 의 MCP 연결
nerv_repo_configured() {
  local dir="${1:-.}"
  [ -f "$dir/.nerv/env" ] && return 0
  [ -f "$dir/.codex/config.toml" ] &&
    grep -qE '^[[:space:]]*\[mcp_servers\.("nerv"|nerv)\][[:space:]]*(#.*)?$' "$dir/.codex/config.toml" && return 0
  [ -f "$dir/.mcp.json" ] && grep -q '"nerv"' "$dir/.mcp.json" && return 0
  return 1
}

nerv_load_env
