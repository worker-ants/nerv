-- 작업 보관 — 진행하지 않기로 한 작업을 정리한다 (2026-10-10 · 사람 결정 · REQ-DB-040 · api.md REQ-API-284~286)
--
-- 작업에는 진행하지 않을 것을 정리할 길이 없었다. clemvion 백로그에 다른 작업으로 대체된 중복 셋이 남았다
-- (CLE-T-V54M21 · 2K6CDJ · CYS6YF). 보관은 상태와 따로 간다 — 보관한 작업은 목록 · 작업 큐 · 클레임 · 구현 현황 ·
-- 의존에서 빠지고 키로는 그대로 읽힌다. duplicate · superseded 는 대신할 작업을 가리킨다. done 은 보관하지 않는다.
-- 옛 행은 모두 보관하지 않은 작업이다.
CREATE TYPE "public"."task_archive_reason" AS ENUM('duplicate', 'superseded', 'obsolete', 'wont_do');--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "archive_reason" "task_archive_reason";--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "archive_note" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "superseded_by_task_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "archived_by_session_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_superseded_by_task_id_task_id_fk" FOREIGN KEY ("superseded_by_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_archived_by_session_id_agent_session_id_fk" FOREIGN KEY ("archived_by_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_archive_ck" CHECK (("task"."archived_at" IS NULL) = ("task"."archive_reason" IS NULL)
          AND ("task"."archived_at" IS NULL) = ("task"."archived_by_user_id" IS NULL)
          AND ("task"."archived_at" IS NOT NULL OR ("task"."superseded_by_task_id" IS NULL
               AND "task"."archive_note" IS NULL AND "task"."archived_by_session_id" IS NULL))
          AND ("task"."archive_reason" NOT IN ('duplicate', 'superseded') OR "task"."superseded_by_task_id" IS NOT NULL)
          AND ("task"."superseded_by_task_id" IS NULL OR "task"."superseded_by_task_id" <> "task"."id"));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_archive_not_done_ck" CHECK ("task"."archived_at" IS NULL OR "task"."status" <> 'done');