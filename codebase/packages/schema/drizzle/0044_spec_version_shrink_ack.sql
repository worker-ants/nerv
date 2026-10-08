-- 본문 축소를 확인한 저장을 버전에 남긴다 (2026-10-08 · REQ-DB-037 · api.md REQ-API-270 · 271)
--
-- 초안 저장이 덮어쓸 본문을 크게 줄이면 거절하고, `allow_shrink` 를 준 저장만 받는다. 그 저장이 이 둘을 채운다.
-- 사전 검토는 직전 버전보다 크게 준 초안을 block 으로 잡되, 여기 기록이 있으면 warning 으로 낮춘다. 이 열이
-- 생기기 전의 버전은 NULL 이다 — 확인한 적이 없는 것으로 본다.
ALTER TABLE "spec_version" ADD COLUMN "shrink_ack_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spec_version" ADD COLUMN "shrink_ack_user_id" uuid;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_shrink_ack_user_id_user_id_fk" FOREIGN KEY ("shrink_ack_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;