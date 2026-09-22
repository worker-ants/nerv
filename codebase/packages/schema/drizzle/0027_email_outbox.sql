-- 메일 아웃박스 — 표면은 행을 넣고 워커가 보낸다 (2026-09-22 · 사람 결정 · database.md §2.17)
--
-- **인라인 발송을 고르지 않았다.** better-auth 문서 자신이 발송을 `await` 하지 말라고 적고
-- (응답 시간이 "그 이메일이 존재하는가" 를 흘린다), SMTP 는 느리고 죽으며, 이 저장소에는
-- 이미 워커·advisory lock·잡 루프가 있다 — 새 개념이 아니라 여덟 번째 잡이다.
--
-- `notification` 을 재사용하지 않는 이유: 그 표는 `project_id`·`event_id`·`user_id` 가 전부
-- NOT NULL 인데 초대받은 사람은 **계정조차 없을 수 있다.** 억지로 끼우면 세 열이 거짓말을 한다.
--
-- 어휘 셋을 한 번에 만든다 — `ALTER TYPE … ADD VALUE` 는 트랜잭션 안에서 그 값을 곧바로 쓸 수
-- 없어서, 나중에 더하려면 마이그레이션을 둘로 쪼개야 한다. 지금 쓰는 것은 `invite` 하나다.
--
-- `invitation.last_sent_at` 은 아웃박스의 `sent_at` 과 다른 것을 센다: 보존 잡이 보낸 행을
-- 치우고 나면 "이 초대를 보냈는가" 의 답이 사라지기 때문이다.
CREATE TYPE "public"."email_kind" AS ENUM('verify_email', 'invite', 'reset_password');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "email_kind" NOT NULL,
	"to_email" "citext" NOT NULL,
	"locale" text DEFAULT 'ko' NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"ref_type" text,
	"ref_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "email_outbox_due" ON "email_outbox" USING btree ("next_attempt_at") WHERE sent_at IS NULL AND failed_at IS NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_sent" ON "email_outbox" USING btree ("sent_at");