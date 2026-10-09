-- 게이트 면제에 범위를 둔다 — 어느 리뷰 종류를 면제했나 (2026-10-09 · REQ-DB-038 · api.md REQ-API-274)
--
-- 코드 산출물이 없는 작업(이미 승인된 스펙의 일관성 재검토 등)은 `code` 리뷰를 받을 길이 없어 done 게이트에서
-- 막혔다(clemvion CLE-T-2NVZA4 · CLE-T-SJAYNM). 면제는 리뷰 커버리지를 통째로 넘기는 것밖에 없었다. 이제 사람이
-- 사유와 함께 종류를 골라 면제한다 — 작업의 done 게이트는 그 종류만 요구에서 뺀다. NULL 은 범위 없는 면제(전부)이고
-- 이 열이 생기기 전의 면제가 모두 그렇다.
ALTER TABLE "approval" ADD COLUMN "bypass_kinds" "review_kind"[];--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_bypass_kinds_ck" CHECK ("approval"."bypass_kinds" IS NULL OR ("approval"."is_bypass" AND cardinality("approval"."bypass_kinds") > 0));