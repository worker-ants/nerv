-- 멀티 역할 — 한 사람이 한 스코프에서 역할을 여럿 가진다 (2026-08-23)
--
-- 근거는 실측이다: clemvion 의 `owner:` 라벨에 `planner/developer`·
-- `project-planner + developer` 같은 복합 표기가 20건 있다. 겸직이 예외가 아니라
-- 흔한 형태인데 데이터 모델이 그것을 담지 못해 임포트에서 87건이 미배정으로 갔다.
--
-- **배열이 아니라 행으로 담는다.** `roles member_role[]` 한 칸으로 두면 조인은 줄지만
-- "누가 언제 무슨 역할을 받았는가"가 사라진다 — 부여마다 행이면 `created_at` 이 살아
-- 있고 회수도 행 삭제다. 표 모양이 그대로라 마이그레이션은 제약 교체뿐이다.
--
-- 유일성의 축이 바뀐다: (사용자, 스코프) → (사용자, 스코프, 역할).
-- 같은 역할을 두 번 주는 것은 여전히 막는다(REQ-DB-010 개정).
DROP INDEX IF EXISTS "membership_user_scope_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "membership_user_scope_role_uq"
    ON "membership" USING btree ("user_id", coalesce("project_id", "org_id"), "role");
