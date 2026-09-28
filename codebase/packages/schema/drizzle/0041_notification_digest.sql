-- 알림 메일 요약 — 켠 사람에게 하루 한 번 (2026-09-28 · 사람 결정 EM1~EM9 · REQ-DB-034 · api.md REQ-API-232)
--
-- 알림은 앱 안에만 있었고, 앱을 자주 열지 않는 사람에게 알리는 길이 없었다. 켠 사람만 설정 행을 갖고(기본
-- 꺼짐), 워커가 그 사람의 현지 시각에 안 읽은 알림 가운데 지난 요약 뒤에 새로 생기거나 건수가 늘어난 줄을
-- 모아 메일 한 통을 줄 세운다. 메일 종류 값은 이 마이그레이션 안에서 쓰지 않으므로 파일 하나로 된다.
ALTER TYPE "public"."email_kind" ADD VALUE 'notification_digest';--> statement-breakpoint
CREATE TABLE "notification_digest_setting" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"hour" smallint DEFAULT 9 NOT NULL,
	"timezone" text NOT NULL,
	"locale" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_hour_ck" CHECK ("notification_digest_setting"."hour" BETWEEN 0 AND 23),
	CONSTRAINT "notification_digest_locale_ck" CHECK ("notification_digest_setting"."locale" IN ('ko', 'en'))
);
--> statement-breakpoint
ALTER TABLE "notification_digest_setting" ADD CONSTRAINT "notification_digest_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;