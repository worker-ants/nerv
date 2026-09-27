-- 쌓여 있는 안 읽은 보통 알림을 묶음으로 접는다 (2026-09-27 · 사람 결정 G2 · REQ-DB-031)
--
-- 앱 안 묶음(0037)은 앞으로 올 알림부터 묶는다. 그 전에 쌓인 안 읽은 보통 알림은 한 건이 한 줄인 채로
-- 남아, 같은 대상이 수십 줄을 차지한다(로컬 실측 2026-09-27: 안 읽은 921행 → 36줄).
-- 같은 규칙으로 접는다 — 사람 · 배치 키(spec-workflow §6.3)마다 이미 열린(안 읽은) 묶음이 있으면 거기에,
-- 없으면 가장 최근 줄을 묶음으로 삼는다. **지우지 않는다**: 나머지 줄은 `archived` 로 두어 목록에서 빼고,
-- 그 이벤트는 남긴 줄의 묶음에 적는다. 읽은 알림과 중요 알림은 건드리지 않는다. 다시 돌려도 0건이다.
--
-- 배치 키의 정본은 notification.service.ts 의 batchKeyOf 다 — 여기 CASE 는 그 사본이다.
CREATE TEMP TABLE notification_fold ON COMMIT DROP AS
WITH keyed AS (
  SELECT n.id, n.user_id, n.event_id, n.created_at,
         CASE e.type
           WHEN 'spec.recheck_requested' THEN 'spec:' || e.subject_id || ':recheck'
           WHEN 'spec.comment_added' THEN 'spec:' || e.subject_id || ':comments'
           WHEN 'finding.commented' THEN 'finding:' || e.subject_id || ':comments'
           WHEN 'task.ready' THEN 'project:' || e.project_id || ':ready'
           WHEN 'invitation.declined' THEN 'invitation:' || e.subject_id
         END AS batch_key
    FROM notification n
    JOIN event e ON e.id = n.event_id
   WHERE n.state = 'unread' AND n.importance = 'digest' AND n.batch_key IS NULL
)
SELECT k.id, k.user_id, k.event_id, k.created_at, k.batch_key,
       coalesce(
         (SELECT o.id FROM notification o
           WHERE o.user_id = k.user_id AND o.batch_key = k.batch_key
             AND o.batch_open AND o.state = 'unread'),
         first_value(k.id) OVER (PARTITION BY k.user_id, k.batch_key
                                     ORDER BY k.created_at DESC, k.id DESC)
       ) AS target_id
  FROM keyed k
 WHERE k.batch_key IS NOT NULL;
--> statement-breakpoint
-- 수준 밖이라 읽음으로 열려 있던 묶음은 닫는다 — 안 읽은 알림은 읽음 묶음에 더하지 않고(api.md REQ-API-223),
-- 열린 묶음은 키마다 하나다(notification_open_batch)
UPDATE notification o SET batch_open = false
  FROM (SELECT DISTINCT user_id, batch_key FROM notification_fold) f
 WHERE o.user_id = f.user_id AND o.batch_key = f.batch_key AND o.batch_open AND o.state <> 'unread';
--> statement-breakpoint
-- 묶음에 든 이벤트를 적는다 — 남긴 줄 자신의 이벤트도 든다
INSERT INTO notification_batch_event (notification_id, event_id, user_id, added_at)
SELECT target_id, event_id, user_id, created_at FROM notification_fold
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 남긴 줄을 묶음으로 — 건수는 적힌 이벤트를 세고, 처음 · 마지막 시각은 접힌 줄까지 넓힌다
UPDATE notification t
   SET batch_key = g.batch_key,
       batch_open = true,
       batch_size = (SELECT count(*) FROM notification_batch_event b WHERE b.notification_id = t.id),
       created_at = least(t.created_at, g.first_at),
       last_at = greatest(t.last_at, g.last_at)
  FROM (SELECT target_id, min(batch_key) AS batch_key,
               min(created_at) AS first_at, max(created_at) AS last_at
          FROM notification_fold GROUP BY target_id) g
 WHERE t.id = g.target_id;
--> statement-breakpoint
-- 나머지는 지우지 않고 목록에서 뺀다 — 그 이벤트는 위에서 남긴 줄의 묶음에 들었다
UPDATE notification n SET state = 'archived', batch_open = false
  FROM notification_fold f
 WHERE n.id = f.id AND n.id <> f.target_id;
