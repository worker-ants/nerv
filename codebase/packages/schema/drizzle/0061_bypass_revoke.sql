-- 면제 끝내기 (2026-10-17 · 사람 결정 · 권장안 A · REQ-DB-055 · api.md REQ-API-357)
--
-- 게이트 면제는 결재 레코드라 지우거나 되감지 않는다(2026-09-26 사람 결정 「결정은 거두지 않는다」). 그런데 면제를 끝내는 새
-- 결정이 없어서, 커밋을 적지 않은 브랜치 면제는 그 브랜치의 모든 커밋에 계속 유효했다. 끝낸 사람 · 시각 · 사유를 세 칸에
-- 남기고 그 뒤의 판정이 이 면제를 세지 않는다. 이미 지나간 통과는 되돌리지 않는다. 있던 행은 모두 NULL(끝내지 않음)이다.
ALTER TABLE "approval" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "revoked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_revoke_ck" CHECK (("approval"."revoked_at" IS NULL AND "approval"."revoked_by_user_id" IS NULL AND "approval"."revoke_reason" IS NULL) OR ("approval"."is_bypass" AND "approval"."revoked_at" IS NOT NULL AND "approval"."revoked_by_user_id" IS NOT NULL AND "approval"."revoke_reason" IS NOT NULL AND "approval"."revoke_reason" <> ''));