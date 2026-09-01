-- 스펙 첨부 — 디자인 시안 등 (2026-09-01 — 사람 결정 · api.md §2.10)
--
-- 파일은 MinIO 에, 메타는 여기. MinIO 는 스택에 처음부터 있었는데 아무도 쓰지 않았다.
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_by_session_id" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_session_id_agent_session_id_fk" FOREIGN KEY ("uploaded_by_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_spec" ON "attachment" USING btree ("spec_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_storage_key_uq" ON "attachment" USING btree ("storage_key");