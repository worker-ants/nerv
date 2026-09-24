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
# 404 인데, 검증은 행 수만 세므로 "손실 0" 이라고 말한다. `rclone` 이 있으면 버킷을
# 함께 동기화하고, **없으면 실패한다**(2026-09-07 · REQ-CB-031). 경고 한 줄은 CronJob 로그에서
# 아무도 읽지 않는다 — S3 가 설정된 배치에서 첨부 없는 백업은 백업이 아니므로 종료 코드로
# 말한다. 스토리지를 아예 안 쓰는 배치(엔드포인트 없음)와 **일부러 건너뛰는 배치**
# (`NERV_BACKUP_SKIP_BLOBS=1`)만 통과한다 — 그 둘은 결정이지 사고가 아니다.
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
# `rclone` 으로 버킷을 통째로 동기화한다. 자격증명은 DB 와 같은 자리(env)에서 온다.
#
# 2026-09-24 까지는 `mc`(MinIO client)였다. MinIO 가 공개 이미지를 거둬(도커허브 09-11 ·
# quay.io 09-24) 그것을 심던 initContainer 가 당길 이미지가 사라졌다. 백업 클라이언트가
# 스토리지 업체에 묶일 이유는 없다 — 운영 자격증명은 널리 쓰이는 공식 이미지의 바이너리만
# 다룬다(사람 결정). 원격은 설정 파일 없이 env 로만 정의한다 — 읽기 전용 루트 FS 에서도
# 돌고, 자격증명이 명령줄(프로세스 목록)에 실리지 않는다. 주소 모양·리전은 앱과 같은 값을
# 따른다(`storage.service.ts` — 경로식이 기본이고 `NERV_S3_FORCE_PATH_STYLE=false` 만 끈다).
nerv_s3_remote() {
  local name="$1"
  export "RCLONE_CONFIG_${name}_TYPE=s3"
  export "RCLONE_CONFIG_${name}_PROVIDER=Other"
  export "RCLONE_CONFIG_${name}_ENDPOINT=${NERV_S3_ENDPOINT}"
  export "RCLONE_CONFIG_${name}_ACCESS_KEY_ID=${NERV_S3_ACCESS_KEY:-}"
  export "RCLONE_CONFIG_${name}_SECRET_ACCESS_KEY=${NERV_S3_SECRET_KEY:-}"
  export "RCLONE_CONFIG_${name}_REGION=${NERV_S3_REGION:-us-east-1}"
  if [[ "${NERV_S3_FORCE_PATH_STYLE:-}" == "false" ]]; then
    export "RCLONE_CONFIG_${name}_FORCE_PATH_STYLE=false"
  else
    export "RCLONE_CONFIG_${name}_FORCE_PATH_STYLE=true"
  fi
}

bucket="${NERV_S3_BUCKET:-nerv-blobs}"
blob_dir="${out_dir}/blobs"
if [[ -z "${NERV_S3_ENDPOINT:-}" ]]; then
  echo "backup: NERV_S3_ENDPOINT 가 없어 첨부를 백업하지 않았습니다 — 이 배치는 오브젝트 스토리지를 쓰지 않습니다" >&2
elif [[ "${NERV_BACKUP_SKIP_BLOBS:-}" == "1" ]]; then
  echo "backup: NERV_BACKUP_SKIP_BLOBS=1 — 첨부를 명시적으로 건너뜁니다(복원해도 시안은 돌아오지 않습니다)" >&2
elif ! command -v rclone >/dev/null 2>&1; then
  echo "backup: rclone 이 없습니다 — S3 가 설정된 배치에서 첨부 없는 백업은 백업이 아닙니다." >&2
  echo "backup: rclone 을 심거나(k8s: initContainer) NERV_BACKUP_SKIP_BLOBS=1 로 명시하십시오." >&2
  exit 2
else
  nerv_s3_remote NERVSRC
  mkdir -p "$blob_dir"
  # sync = 버킷과 똑같이 맞춘다 — 바뀐 것은 덮고, 버킷에서 지워진 것은 여기서도 지운다
  # (`mc mirror --overwrite --remove` 와 같은 뜻). 설정 파일을 찾지 않게 빈 경로를 준다.
  rclone --config "" sync "NERVSRC:${bucket}" "$blob_dir"
  count="$(find "$blob_dir" -type f | wc -l | tr -d ' ')"
  echo "backup: 첨부 ${count}개 (${blob_dir})"
fi

# 보존 기간 경과분 정리 — 무한히 쌓이면 언젠가 디스크가 먼저 죽는다.
find "$out_dir" -name 'nerv-*.dump' -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
