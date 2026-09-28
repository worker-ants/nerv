#!/usr/bin/env bash
# nerv-restore.sh — 백업본 복원 + 정합 검증 (codebase.md §6.5 ①·⑤ · REQ-CB-019)
#
# 절차 ①(pg_restore)과 ⑤(정합 검증)를 한 스크립트에 둔다. ②(마이그레이션)·④(롤아웃)는
# kubectl 명령이라 §6.5 본문이 그대로 정본이다.
#
# **검증이 절차의 일부다.** 복원이 끝난 것과 데이터가 온전한 것은 다르고, 그 차이를
# 확인하지 않은 백업은 "있다고 믿는 백업"이다 — 성공 기준 1-9 가 왕복을 요구하는 이유다.
set -euo pipefail

dump="${1:?사용법: nerv-restore.sh <dump 파일> [원본 DATABASE_URL]}"
source_url="${2:-}"
: "${DATABASE_URL:?복원 대상 DATABASE_URL 이 필요합니다}"

# --clean 은 없는 객체 DROP 에서 경고를 낸다(빈 DB 로 복원할 때가 그렇다) — 그것만으로
# 실패시키지 않되, 출력은 남긴다. 조용한 복원 실패가 "있다고 믿는 백업"의 정체다.
restore_log="$(mktemp)"
if ! pg_restore --dbname "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
      "$dump" >"$restore_log" 2>&1; then
  # 경고(does not exist)만 있으면 통과, 그 밖의 오류는 즉시 중단한다.
  if grep -v 'does not exist' "$restore_log" | grep -qi 'error'; then
    echo "pg_restore 실패:" >&2
    cat "$restore_log" >&2
    exit 1
  fi
  echo "pg_restore 경고 $(grep -c 'does not exist' "$restore_log")건(빈 DB 로의 --clean) — 계속합니다."
fi
rm -f "$restore_log"

bucket="${NERV_S3_BUCKET:-nerv-blobs}"
# 읽기 전용 루트 FS 에서도 돌게 — mc 는 설정 디렉터리를 쓴다(백업 스크립트와 같다)
export MC_CONFIG_DIR="${MC_CONFIG_DIR:-/tmp/.mc}"

# ③ 첨부 되돌리기 — 백업의 blobs/ 를 버킷으로(§6.5 ③ · `mc mirror` 역방향 · REQ-CB-060)
#
# 문서에는 "(선택) mc mirror 역방향" 한 줄만 있고 명령이 없었다 — 복원하는 사람이 그
# 자리에서 명령을 지어내야 했다. **명시했을 때만 한다**(`NERV_RESTORE_BLOBS_DIR`): 버킷이
# 살아 있는 복원(DB 만 잃은 경우)에서는 되돌릴 것이 없다. `--remove` 는 쓰지 않는다 —
# 백업 뒤에 올라온 첨부까지 지우면 복원이 손실을 만든다.
if [[ -n "${NERV_RESTORE_BLOBS_DIR:-}" ]]; then
  if [[ -z "${NERV_S3_ENDPOINT:-}" ]] || ! command -v mc >/dev/null 2>&1; then
    echo "첨부를 되돌리려면 NERV_S3_ENDPOINT 와 mc 가 필요합니다" >&2
    exit 2
  fi
  if [[ ! -d "$NERV_RESTORE_BLOBS_DIR" ]]; then
    echo "첨부 백업 디렉터리가 없습니다: $NERV_RESTORE_BLOBS_DIR" >&2
    exit 2
  fi
  mc alias set nerv-restore-dst "$NERV_S3_ENDPOINT" \
    "${NERV_S3_ACCESS_KEY:-}" "${NERV_S3_SECRET_KEY:-}" >/dev/null
  mc mb --ignore-existing "nerv-restore-dst/${bucket}" >/dev/null
  mc mirror --overwrite "$NERV_RESTORE_BLOBS_DIR" "nerv-restore-dst/${bucket}" >/dev/null
  echo "첨부: 백업의 파일 $(find "$NERV_RESTORE_BLOBS_DIR" -type f | wc -l | tr -d ' ')개를 버킷 ${bucket} 으로 되돌렸습니다"
fi

# ⑥ 첨부 — **행이 있는데 파일이 없으면 손실이다**(REQ-CB-060).
#
# 행 수만 세면 `attachment` 는 전부 살아난 것처럼 보인다. 파일은 오브젝트 스토리지에 있고
# 그것은 덤프에 없다. 예전에는 버킷의 **오브젝트 수**가 행 수 이상이면 통과시켰는데, 버킷에는
# 리뷰 프롬프트 blob 도 있어서 첨부가 빠져도 수는 맞을 수 있었다. 그래서 확정된 첨부의
# `storage_key` 를 하나씩 찾는다. 확인할 수단이 없으면 "손실 0" 을 말하지 않고 멈춘다 —
# 예전에는 경고 한 줄을 남기고 통과라고 적었다.
verify_blobs() {
  local keys n objects missing
  keys="$(psql "$DATABASE_URL" -tAc \
    "SELECT storage_key FROM attachment WHERE committed_at IS NOT NULL ORDER BY 1")"
  n="$(printf '%s' "$keys" | grep -c . || true)"
  if [[ "$n" == "0" ]]; then
    return 0
  fi
  if [[ "${NERV_RESTORE_SKIP_BLOBS:-}" == "1" ]]; then
    echo "첨부 ${n}건을 확인하지 않았습니다(NERV_RESTORE_SKIP_BLOBS=1) — 시안이 404 일 수 있습니다" >&2
    return 0
  fi
  if [[ -z "${NERV_S3_ENDPOINT:-}" ]] || ! command -v mc >/dev/null 2>&1; then
    echo "첨부 ${n}건이 DB 에 있는데 스토리지를 확인할 수단이 없습니다(NERV_S3_ENDPOINT · mc)." >&2
    echo "확인하지 않은 복원은 손실 0 을 말할 수 없습니다 — 수단을 갖추거나 NERV_RESTORE_SKIP_BLOBS=1 로 명시하십시오." >&2
    exit 2
  fi
  mc alias set nerv-restore-dst "$NERV_S3_ENDPOINT" \
    "${NERV_S3_ACCESS_KEY:-}" "${NERV_S3_SECRET_KEY:-}" >/dev/null
  objects="$(mc ls --recursive "nerv-restore-dst/${bucket}" 2>/dev/null | awk '{print $NF}' | sort -u)"
  missing="$(comm -23 <(printf '%s\n' "$keys" | sort -u) <(printf '%s\n' "$objects"))"
  if [[ -n "$missing" ]]; then
    echo "첨부 파일이 모자랍니다 — DB ${n}건 중 $(printf '%s\n' "$missing" | grep -c .)건이 버킷 ${bucket} 에 없습니다:" >&2
    printf '%s\n' "$missing" | head -10 >&2
    # 다시 복원하라고 하지 않는다 — `--clean` 복원은 이미 복원한 DB 위에서 파티션 제약을
    # 지우지 못해 실패한다(§6.5 ① 은 새 DB 에 복원한다). 파일만 되돌리면 된다.
    echo "백업의 파일을 되돌리십시오(§6.5 ③): mc mirror --overwrite <백업>/blobs <별칭>/${bucket}" >&2
    echo "처음부터 새 DB 에 복원한다면 NERV_RESTORE_BLOBS_DIR=<백업>/blobs 를 주면 함께 되돌립니다." >&2
    exit 1
  fi
  echo "첨부: DB ${n}건이 모두 버킷 ${bucket} 에 있습니다"
}

# 임베딩 인덱스는 복원 대상이 아니어도 무방하다 — 재임베딩으로 재생성한다(4.3 §2.15).
# pg_restore 의 --exclude-table-data 는 클라이언트 버전에 따라 없을 수 있어 복원 후 비운다.
if [[ "${NERV_RESTORE_SKIP_EMBEDDINGS:-1}" == "1" ]]; then
  psql "$DATABASE_URL" --command 'TRUNCATE spec_chunk_embedding' >/dev/null 2>&1 || true
fi

# ⑤ 정합 검증 — 테이블별 **실제 행 수** 대조.
#
# 통계 뷰(pg_stat_user_tables.n_live_tup)를 쓰지 않는다: 복원 직후에는 통계가 비어 있어
# "손실 0"과 "아직 세지 않았다"를 구분할 수 없다. 그 둘을 구분하지 못하는 검증은 검증이 아니다.
counts() {
  psql "$1" --tuples-only --no-align --field-separator=' ' <<'SQL'
SELECT string_agg(format('%s %s', table_name, cnt), E'\n' ORDER BY table_name)
  FROM (
    SELECT c.relname AS table_name,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                               false, true, '')))[1]::text::bigint AS cnt
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')          -- 일반 테이블 + 파티션 부모(파티션 자식은 부모가 센다)
       AND c.relispartition = false
       AND c.relname NOT IN ('spec_chunk_embedding')  -- 재임베딩으로 재생성(4.3 §2.15)
  ) t;
SQL
}

if [[ -z "$source_url" ]]; then
  echo "복원 완료 — 행 수:"
  counts "$DATABASE_URL"
  verify_blobs
  exit 0
fi

psql "$source_url" --command 'ANALYZE' >/dev/null
diff_out="$(diff <(counts "$source_url") <(counts "$DATABASE_URL") || true)"
if [[ -n "$diff_out" ]]; then
  echo "정합 검증 실패 — 행 수가 다릅니다:" >&2
  echo "$diff_out" >&2
  exit 1
fi

verify_blobs

echo "정합 검증 통과 — 데이터 손실 0 (spec_chunk_embedding 제외, 재임베딩 대상)"
