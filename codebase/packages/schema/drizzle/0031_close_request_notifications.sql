-- 이미 닫힌 요청의 알림을 닫는다 (2026-09-24 · REQ-API-176 · UI/UX 검토 P05)
--
-- 결재 요청·질문은 받은 요청과 알림 **두 곳**에서 센다. 결정·답변·취소가 그 요청의 알림을
-- 닫게 된 것은 오늘부터라, 그 전에 처리된 요청의 알림은 **안 읽은 채로 남아** 배지를 올린다 —
-- 사람은 이미 끝난 일을 알림에서 다시 보고, 열어 보면 받은 요청은 비어 있다.
--
-- 그래서 이 마이그레이션이 도는 시점에 **이미 닫힌** 요청의 안 읽은 알림만 읽음으로 바꾼다.
-- 열린 요청의 알림은 건드리지 않는다. `read_at` 은 알 수 없는 "실제로 닫힌 때" 대신 지금이다.
UPDATE notification n
   SET state = 'read', read_at = now()
  FROM event e
  LEFT JOIN approval ap ON e.type = 'approval.requested' AND ap.id = e.subject_id
  LEFT JOIN question q ON e.type = 'question.created' AND q.id = e.subject_id
 WHERE e.id = n.event_id
   AND n.state = 'unread'
   AND (ap.decision IS NOT NULL OR q.status <> 'open');
