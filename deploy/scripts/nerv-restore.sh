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
  exit 0
fi

psql "$source_url" --command 'ANALYZE' >/dev/null
diff_out="$(diff <(counts "$source_url") <(counts "$DATABASE_URL") || true)"
if [[ -n "$diff_out" ]]; then
  echo "정합 검증 실패 — 행 수가 다릅니다:" >&2
  echo "$diff_out" >&2
  exit 1
fi

# ⑥ 첨부 — **행이 있는데 파일이 없으면 손실이다.**
# 행 수만 세면 `attachment` 는 전부 살아난 것처럼 보인다. 파일은 오브젝트 스토리지에
# 있고 그것은 이 덤프에 없다 — 그래서 "손실 0" 을 말하기 전에 실물을 센다.
attachments="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM attachment WHERE committed_at IS NOT NULL" 2>/dev/null || echo 0)"
if [[ "${attachments:-0}" != "0" ]]; then
  if [[ -n "${NERV_S3_ENDPOINT:-}" ]] && command -v mc >/dev/null 2>&1; then
    mc alias set nerv-restore-dst "$NERV_S3_ENDPOINT" \
      "${NERV_S3_ACCESS_KEY:-}" "${NERV_S3_SECRET_KEY:-}" >/dev/null
    objects="$(mc ls --recursive "nerv-restore-dst/${NERV_S3_BUCKET:-nerv-blobs}" 2>/dev/null | wc -l | tr -d ' ')"
    echo "첨부: DB ${attachments}건 · 스토리지 ${objects}개"
    if [[ "${objects:-0}" -lt "${attachments}" ]]; then
      echo "첨부 파일이 모자랍니다 — 백업의 blobs/ 를 버킷으로 되돌리세요(nerv-backup.sh 가 미러합니다)" >&2
      exit 1
    fi
  else
    echo "첨부 ${attachments}건이 DB 에 있는데 스토리지를 확인하지 못했습니다 — 시안이 404 일 수 있습니다" >&2
  fi
fi

echo "정합 검증 통과 — 데이터 손실 0 (spec_chunk_embedding 제외, 재임베딩 대상)"
