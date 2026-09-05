-- 멤버십 고유 인덱스 — **선언과 실물을 맞춘다** (2026-08-27)
--
-- 0003_multi_role 이 raw SQL 로 유일성의 축을 (사용자, 소속) → (사용자, 소속, 역할)
-- 로 바꿨는데, drizzle 테이블 **선언**과 스냅샷 5개는 옛 축에 머물러 있었다. 그래서
-- 선언상으로는 "한 소속에 역할 하나"였고, 이 표를 누가 건드리는 순간 생성된
-- 마이그레이션이 **겸직을 도로 막았을 것이다**(사람 질문에 답하다 발견).
--
-- **이미 0003 을 밟은 DB 에서는 아무 일도 일어나지 않는다.** 이 파일이 하는 일은
-- 스냅샷을 실물에 맞추는 것이고, SQL 은 그 정합의 부산물이라 양쪽 모두 조건부로 쓴다 —
-- 새 DB(0003 이 이미 만든 뒤)와 기존 DB 어느 쪽에서도 실패하지 않아야 한다.
DROP INDEX IF EXISTS "membership_user_scope_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "membership_user_scope_role_uq"
    ON "membership" USING btree ("user_id", coalesce("project_id", "org_id"), "role");
