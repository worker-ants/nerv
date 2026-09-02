#!/usr/bin/env bash
# nerv-backup.sh — Postgres 백업 (codebase.md §6.5 · REQ-CB-019)
#
# **백업 대상은 Postgres 와 첨부 오브젝트다.** Valkey 는 무영속 방송 버스라 백업하지
# 않고(유실 시 클라이언트 재조회로 복구 — D-14), `spec_chunk_embedding` 은 원문에서
# 재생성 가능한 인덱스라 복원되지 않아도 무방하다(4.3 §2.15 — 재임베딩이 복구 경로다).
#
# **첨부는 재생성되지 않는다**(2026-09-02 추가). 2026-09-01 부터 스펙 첨부(디자인 시안·
# PDF)의 실체는 오브젝트 스토리지에 있고 DB 에는 `storage_key` 만 남는다. 그런데 이
# 스크립트도 §6.5 표도 "MinIO 내용물은 재생성 가능한 리뷰 프롬프트 blob 뿐" 이라는 옛
# 전제를 들고 있었다 — 그대로 복원하면 `attachment` 행은 전부 살아나고 파일은 전부
# 404 인데, 검증은 행 수만 세므로 "손실 0" 이라고 말한다. `mc` 가 있으면 버킷을 함께
# 미러하고, 없으면 **그 사실을 크게 알린다**(조용히 건너뛰는 것이 가장 나쁘다).
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

# ── 첨부 오브젝트 ────────────────────────────────────────────────────────────
# `mc`(MinIO client)로 버킷을 통째로 미러한다. 자격증명은 DB 와 같은 자리(env)에서 온다.
bucket="${NERV_S3_BUCKET:-nerv-blobs}"
blob_dir="${out_dir}/blobs"
if [[ -z "${NERV_S3_ENDPOINT:-}" ]]; then
  echo "backup: NERV_S3_ENDPOINT 가 없어 첨부를 백업하지 않았습니다 — 복원해도 시안은 돌아오지 않습니다" >&2
elif ! command -v mc >/dev/null 2>&1; then
  echo "backup: mc 가 없어 첨부를 백업하지 않았습니다 — 복원해도 시안은 돌아오지 않습니다" >&2
else
  mc alias set nerv-backup-src "$NERV_S3_ENDPOINT" \
    "${NERV_S3_ACCESS_KEY:-}" "${NERV_S3_SECRET_KEY:-}" >/dev/null
  mkdir -p "$blob_dir"
  mc mirror --overwrite --remove "nerv-backup-src/${bucket}" "$blob_dir"
  count="$(find "$blob_dir" -type f | wc -l | tr -d ' ')"
  echo "backup: 첨부 ${count}개 (${blob_dir})"
fi

# 보존 기간 경과분 정리 — 무한히 쌓이면 언젠가 디스크가 먼저 죽는다.
find "$out_dir" -name 'nerv-*.dump' -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
