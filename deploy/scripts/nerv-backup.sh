#!/usr/bin/env bash
# nerv-backup.sh — Postgres 백업 (codebase.md §6.5 · REQ-CB-019)
#
# **백업 대상은 Postgres 하나다.** Valkey 는 무영속 방송 버스라 백업하지 않고(유실 시
# 클라이언트 재조회로 복구 — D-14), `spec_chunk_embedding` 은 원문에서 재생성 가능한
# 인덱스라 복원되지 않아도 무방하다(4.3 §2.15 — 재임베딩이 복구 경로다).
#
# custom format(-Fc)을 쓰는 이유는 복원 시 선택적 제외가 가능하기 때문이다 —
# 임베딩 테이블을 빼고 복원해도 시스템이 성립한다.
set -euo pipefail

out_dir="${NERV_BACKUP_DIR:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="${out_dir}/nerv-${stamp}.dump"
retention_days="${NERV_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$out_dir"
: "${DATABASE_URL:?DATABASE_URL 이 필요합니다}"

pg_dump --format=custom --file="$dump" "$DATABASE_URL"

# 백업이 "돌았다"와 "쓸 수 있다"는 다르다 — 목록을 읽어 최소 무결성을 확인한다.
if ! pg_restore --list "$dump" >/dev/null; then
  echo "백업 파일을 읽을 수 없습니다: $dump" >&2
  exit 1
fi

size="$(wc -c <"$dump" | tr -d ' ')"
echo "backup: ${dump} (${size} bytes)"

# 보존 기간 경과분 정리 — 무한히 쌓이면 언젠가 디스크가 먼저 죽는다.
find "$out_dir" -name 'nerv-*.dump' -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
