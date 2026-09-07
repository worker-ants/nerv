-- 임포트가 만든 **클레임 없는 진행 중**을 backlog 로 되돌린다 (2026-09-07 · 사람 결정)
--
-- 실측(2026-09-06): `claimed`/`in_progress` 인데 활성 클레임이 없는 Task 24건. 전부
-- 임포트가 만든 것이고, 위임 명세 4요소가 전부 placeholder 다.
--
-- 그 Task 들은 **아무 데도 없다**. 큐(ready)에도 안 보이고, 활성 클레임이 없으니 리스
-- 만료로 회수되지도 않으며, 세션 보드에도 뜨지 않는다 — 상태만 "진행 중" 이라 사람은
-- 누군가 하고 있다고 읽는다. 원본의 `worktree:` 는 "그 저장소에서 누군가 작업 중이었다"
-- 는 사실이지 이 플랫폼의 세션이 그것을 쥐고 있다는 뜻이 아니었다.
--
-- **ready 가 아니라 backlog 인 이유**: 4요소가 placeholder 이고, importer.md 는 그 값을
-- 허용하면서 "판정에 쓰이지 않는다" 를 전제로 삼았다. ready 로 올리면 근거 없는 브리프가
-- 에이전트의 큐에 들어간다 — 소급 적재가 ready 큐를 오염시키지 않는다는 REQ-IMP-009 와
-- 같은 원칙이다.
--
-- **placeholder 문자열은 지우지 않는다.** 그것이 "임포트로 들어왔고 명세가 없다" 는 유일한
-- 표시이고, 그 표시가 있어야 나중에 전수를 다시 고를 수 있다. backlog 는 4요소 CHECK 의
-- 대상이 아니므로 남겨 두어도 제약을 어기지 않는다.
--
-- 멱등이다 — 두 번 돌려도 두 번째는 0건이다. 앞으로 새 고아가 생기지 않는 것은 임포터의
-- 매핑이 바뀌었기 때문이다(REQ-IMP-031).
UPDATE "task"
   SET status = 'backlog',
       delegate_session_id = NULL,
       updated_at = now()
 WHERE status IN ('claimed', 'in_progress')
   AND NOT EXISTS (
     SELECT 1 FROM "claim" c WHERE c.task_id = "task".id AND c.status = 'active'
   )
   AND goal_md IN ('(임포트 — 원본에 위임 명세 없음)', '(imported — source had no delegation brief)');
