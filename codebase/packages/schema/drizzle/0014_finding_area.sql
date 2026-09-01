-- 발견에 "어디에 대한 지적인가" 축을 세운다 (2026-09-01 — 사람 결정 · api.md §2.11)
--
-- category 는 "무슨 종류인가"(보안·테스트)이고 이것은 "무엇을 고쳐야 하는가" 다.
CREATE TYPE "public"."finding_area" AS ENUM('codebase', 'spec', 'task', 'process');--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "area" "finding_area" DEFAULT 'codebase' NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "area_inferred" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- **기존 18,690건도 채운다.** 새 열이 전부 'codebase' 로 앉으면 필터가 첫날부터 거짓말을
-- 한다 — 스펙 지적까지 코드로 분류돼 있으면 그 필터를 아무도 안 믿는다.
-- 규칙은 서버의 추론과 같다(api.md §2.11): 스펙 근거 → spec, Task 리뷰 → task,
-- 파일 근거 → codebase, 아무것도 없으면 process.
UPDATE "finding" f SET "area" = 'spec'
 WHERE f."spec_version_id" IS NOT NULL OR f."requirement_id" IS NOT NULL
    OR 'spec_drift' = ANY(f."tags");--> statement-breakpoint
UPDATE "finding" f SET "area" = 'task'
  FROM "review_session" rs
 WHERE rs."id" = f."last_session_id" AND rs."task_id" IS NOT NULL
   AND f."file_path" IS NULL AND f."area" = 'codebase';--> statement-breakpoint
UPDATE "finding" SET "area" = 'process'
 WHERE "file_path" IS NULL AND "area" = 'codebase';
