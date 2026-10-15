-- 이메일 바꾸기의 메일 세 종류 (2026-10-15 · 사람 결정 · api.md REQ-API-310 · database.md §2.17)
--
-- 옛 주소의 승인(change_email_approve) · 새 주소의 확인(change_email_confirm) · 바뀐 뒤 옛 주소로 가는 알림(email_changed).
-- 값을 더하기만 하고 이 마이그레이션 안에서 쓰지 않으므로 트랜잭션 안에서도 된다(0041 과 같다). 옛 코드는 이 값을 넣지 않는다.
ALTER TYPE "public"."email_kind" ADD VALUE 'change_email_approve';--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'change_email_confirm';--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'email_changed';