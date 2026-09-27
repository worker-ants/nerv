-- 프로젝트마다 알림을 받는 수준 (2026-09-27 · 사람 결정 N3 · REQ-DB-028)
--
-- 알림을 끄거나 줄일 방법이 없었다. 사람 × 프로젝트마다 all · important · none 을 고르고, 행이 없으면
-- all 이다. 고른 수준 밖의 알림은 버리지 않고 읽음 상태로 넣는다(파생 워커 · api.md REQ-API-219).
-- 받은 요청에는 닿지 않는다 — 결정 요청의 정본은 받은 요청이다.
CREATE TYPE "public"."notification_level" AS ENUM('all', 'important', 'none');--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"level" "notification_level" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_pkey" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;