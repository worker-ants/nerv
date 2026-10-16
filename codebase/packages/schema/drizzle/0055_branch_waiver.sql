-- 리뷰가 없는 브랜치의 면제 — 결재에 브랜치를 적을 자리 (2026-10-16 · 사람 결정 D4 · REQ-DB-050 · api.md REQ-API-338 ~ 340)
--
-- ① `approval.branch` — 브랜치 면제의 브랜치. 브랜치는 개체가 아니라 문자열이라 `subject_id`(uuid)가 가리킬 수 없다. 이 열이
--    있는 면제는 `subject_id` 에 프로젝트 id 를 두고 대상은 이 브랜치다(다형 참조 규칙의 예외 하나 · database.md §2.8).
--    리뷰가 한 번도 없는 브랜치에도 낸다 — 게이트 판정(EP-REV-08)이 그 (브랜치 · 종류)를 `waived` 로 통과시킨다.
-- ② `approval.head_sha` — 브랜치 면제를 커밋 하나로 좁힌다(40자 소문자 16진수). 비어 있으면 그 브랜치의 모든 커밋에 유효하다.
-- ③ 둘 다 게이트 면제에만 있다(CHECK). 있던 행은 둘 다 NULL 이라 뜻이 바뀌지 않는다.
ALTER TABLE "approval" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "head_sha" text;--> statement-breakpoint
CREATE INDEX "approval_bypass_branch" ON "approval" USING btree ("project_id","branch") WHERE "approval"."branch" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_branch_ck" CHECK ("approval"."branch" IS NULL OR ("approval"."is_bypass" AND "approval"."subject_type" = 'gate_bypass' AND "approval"."branch" <> ''));--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_head_sha_ck" CHECK ("approval"."head_sha" IS NULL OR ("approval"."branch" IS NOT NULL AND "approval"."head_sha" ~ '^[0-9a-f]{40}$'));