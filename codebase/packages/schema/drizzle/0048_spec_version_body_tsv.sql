-- 본문의 전문 검색 벡터를 저장해 둔다 (2026-10-12 · 사람 결정 · api.md REQ-API-301 · database.md §2.12)
--
-- 검색의 렉시컬 순위가 질의마다 문서 본문 전체를 `to_tsvector` 로 다시 분석했다 — 이 저장소의 문서 세트
-- (본문 약 250만 자)에서 p95 0.8초였고 그 거의 전부가 이 분석이었다(E06-S06 실측 · api.md §2.2c). 생성 열은
-- 본문이 바뀔 때만 다시 만든다. 옛 식 인덱스는 질의의 식과 맞지 않아 한 번도 쓰이지 않았으므로 지운다.
-- 확장만 한다 — 옛 코드는 이 열을 읽지 않는다. 기존 행은 열을 더할 때 한 번 채워진다(표 다시 쓰기).
DROP INDEX "spec_version_body_fts";--> statement-breakpoint
ALTER TABLE "spec_version" ADD COLUMN "body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body_md, ''))) STORED;--> statement-breakpoint
CREATE INDEX "spec_version_body_tsv" ON "spec_version" USING gin ("body_tsv");