-- 알림 파생의 멱등 키 — 한 이벤트 · 한 사람 · 한 행 (2026-09-27 · REQ-DB-029 · api.md REQ-API-222)
--
-- 파생 워커는 "알림 행이 없는 이벤트" 를 찾아 넣는데, 그 판단은 읽는 순간의 것이라 파생이 겹치면
-- 같은 알림이 두 번 들어갈 수 있었다. 워커는 advisory lock 을 가진 하나라 실제로 겹친 적은 없다
-- (로컬 실측 2026-09-27: 중복 0건). 그래서 행을 지우는 문장은 두지 않는다 — 중복이 있는 배치에서는
-- 이 인덱스가 만들어지지 않고 멈춘다. 적용 전 확인:
--   SELECT event_id, user_id, count(*) FROM notification GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX "notification_event_user" ON "notification" USING btree ("event_id","user_id");