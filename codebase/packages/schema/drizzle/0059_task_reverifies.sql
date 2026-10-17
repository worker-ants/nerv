-- 재검증 작업이 다시 보는 완료 작업 (2026-10-16 · 사람 결정 · REQ-DB-053 · api.md REQ-API-097 개정 · spec-workflow §1.3)
--
-- CR 승인이 바뀐(MODIFIED) 요구사항의 완료 작업을 다시 확인하라고 만드는 작업(재검증 작업)에 `task.reverifies_task_id` 로
-- 그 완료 작업을 남긴다(같은 프로젝트 · 완료 작업이 여럿이면 가장 나중에 끝난 것). **착수하지 않은 재검증 작업**(`backlog` ·
-- `ready` · `blocked` 이고 클레임된 적이 없다)은 요구사항의 구현 상태를 계산할 때 세지 않는다 — 아무도 시작하지 않은 동안
-- 구현 상태를 바꾸면 qa 가 다시 서명해도 `verified` 로 돌아오지 못했다. 이 열이 그 작업을 알아보는 자리다.
--
-- 백필: 이미 만들어진 재검증 작업은 그 작업의 `task.created` 이벤트(payload `kind: reverify`)로 알아보고, 같은 요구사항에서
-- 그 작업보다 먼저 끝난 완료 작업 가운데 가장 나중에 끝난 것을 넣는다 — 승인이 새로 만들 때와 같은 규칙이다. 목표 본문의
-- 완료 작업 키는 보지 않는다(사람이 고쳤을 수 있다). 이 마이그레이션은 구현 상태를 다시 계산하지 않는다 — 이미 `in_progress`
-- 로 바뀐 요구사항은 다음 재파생(클레임 · 작업 전이 · 증적 등록)에서 바로잡힌다.
ALTER TABLE "task" ADD COLUMN "reverifies_task_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_reverifies_task_id_task_id_fk" FOREIGN KEY ("reverifies_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "task" t
   SET "reverifies_task_id" = (
         SELECT d.id FROM "task" d
          WHERE d.project_id = t.project_id AND d.source_requirement_id = t.source_requirement_id
            AND d.id <> t.id AND d.status = 'done' AND d.done_at <= t.created_at
          ORDER BY d.done_at DESC, d.key
          LIMIT 1)
 WHERE t.reverifies_task_id IS NULL AND t.source_requirement_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM "event" e
                WHERE e.subject_type = 'task' AND e.subject_id = t.id AND e.type = 'task.created'
                  AND e.payload->>'kind' = 'reverify');
