-- 앱 안 묶음 — 보통 알림은 같은 대상을 읽을 때까지 한 줄로 (2026-09-27 · 사람 결정 G1 · G2 · G3 · REQ-DB-030)
--
-- 보통 등급 알림은 같은 사람 · 같은 배치 키(spec-workflow §6.3)면 열린 묶음에 더한다. 읽으면 닫히고
-- 다음 알림은 새 줄로 시작한다. 목록은 마지막으로 더해진 시각(last_at) 순이다.
-- 있던 알림은 묶지 않는다(한 줄 = 한 건). 쌓여 있는 안 읽은 알림을 접는 일은 다음 마이그레이션이다.
CREATE TABLE "notification_batch_event" (
	"notification_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_batch_event_pkey" PRIMARY KEY("notification_id","event_id")
);
--> statement-breakpoint
DROP INDEX "notification_inbox";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "batch_key" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "batch_size" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "last_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- 있던 알림의 마지막 시각은 만든 시각이다 — 기본값(now())으로 두면 목록 순서가 마이그레이션 시각으로 뭉친다
UPDATE "notification" SET "last_at" = "created_at";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "batch_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_batch_event" ADD CONSTRAINT "notification_batch_event_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_batch_event_user" ON "notification_batch_event" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_open_batch" ON "notification" USING btree ("user_id","batch_key") WHERE "notification"."batch_open";--> statement-breakpoint
CREATE INDEX "notification_inbox" ON "notification" USING btree ("user_id","state","last_at" DESC NULLS LAST);