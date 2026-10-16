-- SoT 컷오버 M1 — 컷오버 단계와 게이트 판정 비교 (2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-DB-052 · api.md REQ-API-345 ~ 349)
--
-- ① `project.review_sot`(enum `review_sot` — git · dual · nerv)와 `review_sot_since` — 프로젝트가 병행 운영 표(roadmap §7.4)의 어느 줄에
--    있는지와 그 줄로 바꾼 시각이다. 기본은 `git`(컷오버 전)이라 기존 프로젝트의 동작은 그대로다. 2주 관측 창(§7.5)이 바꾼 시각에서
--    시작한다.
-- ② `gate_verdict_comparison` — 로컬 훅이 게이트 판정(EP-REV-08b)에 자기 판정을 함께 보내면 두 판정을 견준 결과가 한 줄로 남는다.
--    부른 수가 곧 불일치율의 분모라 같은 (프로젝트 · 브랜치 · 종류 · 커밋 · 로컬 판정)은 유일 인덱스로 한 줄이다 — 재시도는
--    `repeat_count` 만 올린다. 2주 창 질의는 (프로젝트 · 시각) 인덱스로 읽는다.
CREATE TYPE "public"."review_sot" AS ENUM('git', 'dual', 'nerv');--> statement-breakpoint
CREATE TABLE "gate_verdict_comparison" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"kinds" text NOT NULL,
	"head_sha" text NOT NULL,
	"local_pass" boolean NOT NULL,
	"local_hook" text,
	"local_reason" text,
	"server_pass" boolean NOT NULL,
	"server_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_sot" "review_sot" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"repeat_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "review_sot" "review_sot" DEFAULT 'git' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "review_sot_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gate_verdict_comparison" ADD CONSTRAINT "gate_verdict_comparison_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_verdict_comparison" ADD CONSTRAINT "gate_verdict_comparison_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gate_verdict_comparison_uq" ON "gate_verdict_comparison" USING btree ("project_id","branch","kinds","head_sha","local_pass");--> statement-breakpoint
CREATE INDEX "gate_verdict_comparison_time" ON "gate_verdict_comparison" USING btree ("project_id","created_at");