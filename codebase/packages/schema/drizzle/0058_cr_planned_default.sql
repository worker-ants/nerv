-- 고른 적 없는 CR 은 승인할 때 기본값을 적용한다 (2026-10-16 · 사람 결정 · REQ-DB-048 개정 · api.md REQ-API-351)
--
-- `change_request.planned_actions` 의 NULL 이 **"고른 적 없음"** 이 된다. 승인할 때 서버가 기본값(파생 · 재검증 작업은 만들고
-- 미착수 작업 보관은 하지 않는다 — CR 화면의 기본 체크와 같다)을 적용한다. 사람이 고른 것은 늘 세 칸
-- `{derive, reverify, cancel}` 으로 남으므로(빈 선택은 세 칸이 모두 빈 배열이다) 둘이 섞이지 않는다.
-- 기본값 `'{}'` 였던 행은 아무도 고르지 않은 행이다 — 고른 것을 남기는 쪽은 언제나 세 칸을 썼다 — 그래서 NULL 로 옮긴다.
ALTER TABLE "change_request" ALTER COLUMN "planned_actions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "change_request" ALTER COLUMN "planned_actions" DROP NOT NULL;--> statement-breakpoint
UPDATE "change_request" SET "planned_actions" = NULL WHERE "planned_actions" = '{}'::jsonb;
