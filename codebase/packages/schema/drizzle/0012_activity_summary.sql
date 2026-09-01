-- 원문이 사라진 뒤에도 남는 것 (2026-09-01 — 사람 결정 · api.md §2.9)
--
-- 보존 잡이 90일 지난 Activity 를 지우는데, 지우고 나면 그 세션은 아무것도 안 한 것처럼
-- 보였다. 지우기 전에 도구별 횟수를 여기 접어 둔다.
ALTER TABLE "agent_session" ADD COLUMN "activity_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;