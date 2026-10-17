-- Slack 채널 발신 (2026-10-17 · 사람 결정 D1 · D2 · E17-S03 · REQ-DB-054 · api.md REQ-API-354 ~ 356)
--
-- ① `project_slack` — 프로젝트마다 Incoming Webhook 하나. 주소는 비밀이라 암호문(AES-256-GCM · 키는 env NERV_ENCRYPTION_KEY)과
--    끝 네 글자만 둔다. 프로젝트를 지우면 함께 지운다.
-- ② `slack_outbox` — email_outbox 와 같은 발송 큐. critical 이벤트마다 한 줄(유일 인덱스)이고 보내기 직전에 처리됐는지 다시 본다.
--    event 는 월 파티션이라 event_id 에 FK 를 걸지 않는다.
CREATE TABLE "project_slack" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"webhook_cipher" text NOT NULL,
	"webhook_hint" text NOT NULL,
	"connected_by" uuid NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"body" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	"sent_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_slack" ADD CONSTRAINT "project_slack_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack" ADD CONSTRAINT "project_slack_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_outbox" ADD CONSTRAINT "slack_outbox_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_outbox_event" ON "slack_outbox" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "slack_outbox_due" ON "slack_outbox" USING btree ("next_attempt_at") WHERE sent_at IS NULL AND skipped_at IS NULL AND failed_at IS NULL;--> statement-breakpoint
CREATE INDEX "slack_outbox_project" ON "slack_outbox" USING btree ("project_id","created_at");