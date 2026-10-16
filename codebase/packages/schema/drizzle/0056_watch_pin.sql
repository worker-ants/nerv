-- 워치와 핀을 서버에 남긴다 — 표 둘 (2026-10-16 · 사람 결정 D5 = B · REQ-DB-051 · api.md REQ-API-342 ~ 345)
--
-- ① `watch` — 사람이 스펙 · 작업 · 영역을 명시적으로 구독한 것. 알림 카탈로그(spec-workflow §6.3)의 「워처」 수신자가 여기서
--    나온다. 영역 워치는 그 영역 문서 아래의 문서와 작업까지 포함한다(작업은 기준 문서의 조상으로 영역을 찾는다). 자동 등록은
--    하지 않는다 — 행은 사람이 누를 때만 생긴다.
-- ② `pin` — 퀵 스위처의 고정. 예전에는 브라우저(localStorage)에만 있어 기기를 바꾸면 사라졌다. 사람마다 한 목록이고 프로젝트를
--    넘는다. 순서는 `position` 오름차순(새 핀이 맨 위). 웹이 처음 한 번 브라우저의 핀을 서버로 옮긴다.
-- ③ 둘 다 그 사람의 설정이라 사람 · 프로젝트가 지워지면 함께 지운다(`notification_preference` 와 같다). 대상은 다형 참조다.
CREATE TYPE "public"."pin_target" AS ENUM('spec', 'task', 'change_request');--> statement-breakpoint
CREATE TYPE "public"."watch_target" AS ENUM('spec', 'task', 'area');--> statement-breakpoint
CREATE TABLE "pin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" "pin_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" "watch_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch" ADD CONSTRAINT "watch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch" ADD CONSTRAINT "watch_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pin_user_target_uq" ON "pin" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "pin_user_order" ON "pin" USING btree ("user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_user_target_uq" ON "watch" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "watch_target" ON "watch" USING btree ("project_id","target_type","target_id");