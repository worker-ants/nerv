-- 알림 메일 요약을 로그인 없이 한 번에 끈다 (2026-09-28 · 사람 결정 EM8 · REQ-DB-035 · api.md REQ-API-234)
--
-- 메일 앱의 [구독 취소] 단추가 뜨도록 List-Unsubscribe · List-Unsubscribe-Post(RFC 8058) 머리글을 달고, 끄는
-- 링크의 토큰은 해시로만 둔다. 토큰은 그 메일 행에 붙어서, 보낸 지 7일이 지나 행이 지워지면 링크도 죽는다.
ALTER TABLE "email_outbox" ADD COLUMN "headers" jsonb;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "unsubscribe_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_unsubscribe" ON "email_outbox" USING btree ("unsubscribe_token_hash") WHERE unsubscribe_token_hash IS NOT NULL;