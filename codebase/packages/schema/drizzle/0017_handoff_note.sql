ALTER TABLE "agent_session" ADD COLUMN "diff_files" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "release_note" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "progress_note" text;