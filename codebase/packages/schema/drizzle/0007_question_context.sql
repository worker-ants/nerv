ALTER TABLE "question" ADD COLUMN "spec_id" uuid;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "finding_id" uuid;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "escalate" "escalate_reason";--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_finding_id_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."finding"("id") ON DELETE no action ON UPDATE no action;