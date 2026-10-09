-- 클레임에 대기 표시를 둔다 — 무엇을 언제까지 기다리는가 (2026-10-09 · REQ-DB-039 · api.md REQ-API-275 · 276)
--
-- 백그라운드 작업(리뷰 워크플로 10~17분)이나 사람의 답을 기다리느라 턴을 끝내는 세션에 Stop 훅이 클레임 해제를
-- 요구했고, 모델은 기다리는 중에도 클레임을 풀었다. 풀면 작업이 ready 로 돌아가 다른 세션이 가져간다(clemvion
-- CLE-T-ZTTHXD). 하트비트가 넷을 쓰고 awaiting 없는 다음 하트비트가 지운다. awaiting_until 이 지나지 않았고 작업
-- 상태가 awaiting_task_status 그대로인 동안 Stop 은 이 클레임을 정리하지 않은 클레임으로 세지 않는다. 상태 변경이
-- 클레임 행에 쓰지 않는 것은 잠금 순서 때문이다(전이는 작업 → 해제 · 회수는 클레임 먼저). 옛 행은 모두 NULL 이다.
CREATE TYPE "public"."claim_awaiting_kind" AS ENUM('background', 'user', 'approval');--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "awaiting_kind" "claim_awaiting_kind";--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "awaiting_refs" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "awaiting_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "awaiting_task_status" "task_status";--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_awaiting_ck" CHECK (("claim"."awaiting_kind" IS NULL) = ("claim"."awaiting_until" IS NULL)
          AND ("claim"."awaiting_kind" IS NULL) = ("claim"."awaiting_task_status" IS NULL)
          AND ("claim"."awaiting_kind" IS NOT NULL OR cardinality("claim"."awaiting_refs") = 0));