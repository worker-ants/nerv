-- 스펙을 고쳐 해결한 처분에 증거를 준다 (2026-08-30 — 사람 결정 · api.md §1.4j)
--
-- `spec_change` 는 처음부터 열거에 있었는데 CHECK 가 change_request 를 요구하고,
-- 그 표에 INSERT 하는 코드가 없어 닿을 수 없는 값이었다. 커밋이 코드 쪽 증거이듯
-- spec_version_id 가 문서 쪽 증거다.
ALTER TABLE "resolution" DROP CONSTRAINT "resolution_spec_change_cr_ck";--> statement-breakpoint
ALTER TABLE "resolution" ADD COLUMN "spec_version_id" uuid;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_spec_version_id_spec_version_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_spec_change_cr_ck" CHECK ("resolution"."kind" <> 'spec_change' OR "resolution"."change_request_id" IS NOT NULL OR "resolution"."spec_version_id" IS NOT NULL);