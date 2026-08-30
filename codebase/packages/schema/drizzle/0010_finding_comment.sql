CREATE TABLE "finding_comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_session_id" uuid,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "promoted_task_id" uuid;--> statement-breakpoint
ALTER TABLE "finding_comment" ADD CONSTRAINT "finding_comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_comment" ADD CONSTRAINT "finding_comment_finding_id_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."finding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_comment" ADD CONSTRAINT "finding_comment_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_comment" ADD CONSTRAINT "finding_comment_author_session_id_agent_session_id_fk" FOREIGN KEY ("author_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_comment_thread" ON "finding_comment" USING btree ("finding_id","created_at");--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_promoted_task_id_task_id_fk" FOREIGN KEY ("promoted_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;