-- 변경 요청이 스펙 버전을 감싼다 — 표시 키 C · 고른 제안 · 버린 초안 (2026-10-16 · 사람 결정 D1 · D2 · REQ-DB-048 · api.md REQ-API-328 ~ 332)
--
-- ① 승인본이 있는 문서에 새 초안이 생기면 서버가 변경 요청(CR)을 연다. 결재는 지금처럼 스펙 버전이 받고 CR 은 그 제안의
--    진행을 든다. CR 을 거절하거나 작성자가 철회하면 그 초안은 지우지 않고 `discarded`(버린 초안)가 된다 — CR 이 무엇을
--    제안했는지가 남아야 한다. 값을 더하기만 하고 이 마이그레이션 안에서 쓰지 않으므로 트랜잭션 안에서도 된다(0050 과 같다).
-- ② CR 의 표시 키 `<PRJ>-C-XXXXXX`(data-model §5.1) — 작업 · 스펙 키와 같은 규칙이고 씨앗은 CR 의 UUID 다. 있는 행은 아래에서
--    같은 식으로 채운다(`@nerv/schema/keys` 의 `displayKey` 와 같은 값 — sha256 앞 6바이트마다 하위 5비트를 Crockford base32 로).
--    이 열이 생기기 전에는 CR 을 만드는 코드가 없어 보통은 채울 행이 없다.
-- ③ `planned_actions` — 영향 미리보기의 제안 가운데 사람이 고른 것. 승인되는 순간 서버가 한다. 빈 객체가 "고른 것 없음" 이다.
-- ④ 문서마다 열린(열림 · 검토 중) CR 은 하나, 초안마다 CR 은 하나다 — 가변 구간이 문서마다 하나라는 규칙의 CR 쪽 거울이다.
ALTER TYPE "public"."spec_version_status" ADD VALUE 'discarded';--> statement-breakpoint
ALTER TABLE "change_request" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "change_request" cr
   SET "key" = p."key" || '-C-' || (
         SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
                                  (get_byte(sha256(convert_to(cr."id"::text, 'UTF8')), i) & 31) + 1, 1),
                           '' ORDER BY i)
           FROM generate_series(0, 5) AS i)
  FROM "project" p
 WHERE p."id" = cr."project_id" AND cr."key" IS NULL;--> statement-breakpoint
ALTER TABLE "change_request" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "change_request" ADD COLUMN "planned_actions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "change_request_key_uq" ON "change_request" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "change_request_proposed_uq" ON "change_request" USING btree ("proposed_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_request_spec_open_uq" ON "change_request" USING btree ("spec_id") WHERE "change_request"."status" IN ('open', 'in_review');
