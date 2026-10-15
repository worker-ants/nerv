-- 구현 상태의 출처 — 임포트 값과 파생한 값을 나눈다 (2026-10-15 · 사람 결정 · REQ-DB-044 · api.md REQ-API-312)
--
-- 작업이 하나도 없는 요구사항은 파생할 재료가 없어 서버가 값을 바꾸지 않는다. 임포트가 문서에서 읽어 넣은 값을
-- `unimplemented` 로 덮으면 이관한 팀의 현황이 하루아침에 0 이 되므로 값은 그대로 두고, 그 값이 어디서 왔는지를 이 열에
-- 남긴다. 임포트가 새 요구사항을 만들 때 `import`, 파생이 값을 다시 쓸 때 `derived` 다. NERV 에서 생긴 요구사항의 처음 값
-- (`unimplemented`)도 `derived` 다 — 누가 손으로 찍은 값이 아니다.
CREATE TYPE "public"."impl_status_source" AS ENUM('derived', 'import');--> statement-breakpoint
ALTER TABLE "requirement" ADD COLUMN "impl_status_source" "impl_status_source" DEFAULT 'derived' NOT NULL;--> statement-breakpoint
-- 있던 행 — **임포터가 만들었고 살아 있는 작업이 없는 요구사항**을 `import` 로 둔다. 임포터만 `requirement_version` 을
-- 쓰므로, 들어온 버전에 `added` 줄이 있으면 임포터가 만든 행이다. 살아 있는 작업이 있으면 클레임 · 전이 · 증적 등록이
-- 이미 다시 파생했다고 본다 — 작업을 만들기만 하고 한 번도 움직이지 않은 행은 다음 파생 때 `derived` 가 된다
UPDATE "requirement" r SET "impl_status_source" = 'import'
 WHERE EXISTS (SELECT 1 FROM "requirement_version" rv
                WHERE rv."requirement_id" = r."id"
                  AND rv."spec_version_id" = r."introduced_in_version_id"
                  AND rv."change_kind" = 'added')
   AND NOT EXISTS (SELECT 1 FROM "task" t
                    WHERE t."source_requirement_id" = r."id" AND t."archived_at" IS NULL);
