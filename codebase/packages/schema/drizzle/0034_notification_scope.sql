-- 알림을 범위(조직 · 프로젝트)로 좁혀 본다 (2026-09-27 · 사람 결정 N1 · N4 · REQ-DB-027)
--
-- 알림 화면의 범위 칸이 프로젝트마다 안 읽은 수를 세고, [모두 읽음]이 고른 프로젝트 안에서만
-- 읽음으로 바꾼다. 있던 인덱스(user_id, state, created_at)는 프로젝트를 몰라 두 일 모두 그 사람의
-- 알림 전부를 훑어야 했다. 열은 바꾸지 않는다 — 모든 알림 행은 처음부터 project_id 를 가진다.
CREATE INDEX "notification_scope" ON "notification" USING btree ("user_id","project_id","state");