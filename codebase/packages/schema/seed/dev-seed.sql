-- 개발 시드 — 정본: docs/04-mvp/database.md §4
--
-- **개발 전용이다.** TRUNCATE 후 재삽입하므로 몇 번을 실행해도 같은 상태다(REQ-DB-002).
-- UUID 는 가독성을 위한 고정값이고(UUIDv7 형식), 표시 문자열은 각 테이블의
-- key(spec·task) · ref(requirement) · external_session_id(agent_session)로 심는다.
--
-- 이 한 벌로 S1 홈(질문 배지 1) · S3 스펙 상세(SPC-CWC-007 v4 + REQ-CWC-031) ·
-- S4 작업 보드(in_progress 2 · blocked 1) · S5 세션 모니터(active 2 · awaiting_input 1) ·
-- S7 승인함(질문 카드 1)이 전부 비어 있지 않게 뜬다.

BEGIN;
TRUNCATE organization, "user" CASCADE;   -- FK 연쇄로 전 도메인 테이블 초기화

-- 월초 실행 대비 — 시드 이벤트의 과거 시각(최대 2일 전)이 지난달 파티션에 떨어질 수 있다
SELECT nerv_ensure_month_partitions((current_date - interval '1 month')::date);

-- 테넌시 ---------------------------------------------------------------
INSERT INTO organization (id, slug, name) VALUES
  ('01990a66-0000-7000-8000-000000000001', 'nerv', 'NERV');

INSERT INTO "user" (id, email, display_name, state) VALUES
  ('01990a66-0000-7000-8000-000000000011', 'jimin@example.com',  '지민', 'active'),
  ('01990a66-0000-7000-8000-000000000012', 'seoyeon@example.com','서연', 'active'),
  ('01990a66-0000-7000-8000-000000000013', 'dohyun@example.com', '도현', 'active'),
  ('01990a66-0000-7000-8000-000000000014', 'yuna@example.com',   '유나', 'active'),
  ('01990a66-0000-7000-8000-000000000015', 'hana@example.com',   '하나', 'active');

INSERT INTO project (id, org_id, slug, key, name, repo_url, default_branch) VALUES
  ('01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000001',
   'clemvion', 'CLV', 'clemvion', 'https://git.example.com/nerv/clemvion.git', 'main');

INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
  ('01990a66-0000-7000-8000-000000000031', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000011', 'planner'),
  ('01990a66-0000-7000-8000-000000000032', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000012', 'designer'),
  ('01990a66-0000-7000-8000-000000000033', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000013', 'developer'),
  ('01990a66-0000-7000-8000-000000000034', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000014', 'developer'),
  ('01990a66-0000-7000-8000-000000000035', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000015', 'developer');

INSERT INTO api_token (id, project_id, user_id, name, token_hash, prefix, scopes) VALUES
  ('01990a66-0000-7000-8000-000000000036', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000015', '노트북 Claude Code',
   digest('dev-seed-token-hana', 'sha256'), 'nrv_dev1',
   ARRAY['spec:read', 'spec:write', 'task:claim', 'review:write', 'session:write']);

-- 세션 (S5 보드 한 벌: S-8f31 도현/mac-02, S-2d04 유나/linux-ci-01, S-b7e9 하나/mac-07) --
INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, branch,
                           external_session_id, state, started_at, last_heartbeat_at,
                           diff_added, diff_removed) VALUES
  ('01990a66-0000-7000-8000-000000000081', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000013', 'claude-code', 'mac-02', 'feature/widget-v2',
   'S-8f31', 'active', now() - interval '151 minutes', now() - interval '12 seconds', 218, 34),
  ('01990a66-0000-7000-8000-000000000082', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000014', 'codex', 'linux-ci-01', 'feat/session-restore',
   'S-2d04', 'awaiting_input', now() - interval '80 minutes', now() - interval '44 seconds', 64, 5),
  ('01990a66-0000-7000-8000-000000000083', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000015', 'claude-code', 'mac-07', 'fix/loader-cache',
   'S-b7e9', 'active', now() - interval '48 minutes', now() - interval '41 seconds', 12, 0);

-- 스펙 트리 ------------------------------------------------------------
INSERT INTO spec (id, project_id, parent_id, type, key, title, sort_key) VALUES
  ('01990a66-0000-7000-8000-000000000041', '01990a66-0000-7000-8000-000000000021', NULL,
   'area', 'channel-web-chat', '채널 · 웹챗', '7'),
  -- 표시 ID(SPC-*)를 key로 심는다 — 웹 라우트 /p/clemvion/specs/SPC-CWC-007 정합
  ('01990a66-0000-7000-8000-000000000042', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000041', 'feature', 'SPC-CWC-007', '웹챗 위젯 임베드 v2', '2'),
  ('01990a66-0000-7000-8000-000000000043', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000041', 'feature', 'SPC-CWC-012', '세션 복원 API', '3');

INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash,
                          author_user_id, approved_at, approved_by_user_id,
                          superseded_by_version_id) VALUES
  -- SPC-CWC-007 v3 (superseded) → v4 (approved) — S3 diff v3..v4의 재료
  ('01990a66-0000-7000-8000-000000000051', '01990a66-0000-7000-8000-000000000042', 3,
   'superseded', E'# 웹챗 위젯 임베드\n\n(v3 본문)', digest(E'# 웹챗 위젯 임베드\n\n(v3 본문)', 'sha256'),
   '01990a66-0000-7000-8000-000000000011', now() - interval '9 days',
   '01990a66-0000-7000-8000-000000000012', '01990a66-0000-7000-8000-000000000052'),
  ('01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000042', 4,
   'approved',
   E'# 웹챗 위젯 임베드 v2\n\n## 요구사항\n\n- REQ-CWC-031 WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다\n',
   digest(E'# 웹챗 위젯 임베드 v2\n\n## 요구사항\n\n- REQ-CWC-031 WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다\n', 'sha256'),
   '01990a66-0000-7000-8000-000000000011', now() - interval '2 days',
   '01990a66-0000-7000-8000-000000000012', NULL),
  ('01990a66-0000-7000-8000-000000000053', '01990a66-0000-7000-8000-000000000043', 1,
   'approved', E'# 세션 복원 API\n\n(v1 본문)', digest(E'# 세션 복원 API\n\n(v1 본문)', 'sha256'),
   '01990a66-0000-7000-8000-000000000011', now() - interval '5 days',
   '01990a66-0000-7000-8000-000000000012', NULL);

UPDATE spec SET current_version_id = '01990a66-0000-7000-8000-000000000052'
  WHERE id = '01990a66-0000-7000-8000-000000000042';
UPDATE spec SET current_version_id = '01990a66-0000-7000-8000-000000000053'
  WHERE id = '01990a66-0000-7000-8000-000000000043';

INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority, impl_status,
                         introduced_in_version_id, current_version_id) VALUES
  ('01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000042', 'REQ-CWC-031',
   'WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다', 'must', 'in_progress',
   '01990a66-0000-7000-8000-000000000051', '01990a66-0000-7000-8000-000000000052');

INSERT INTO requirement_version (requirement_id, spec_version_id, change_kind, statement_md, ordinal) VALUES
  ('01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000051', 'added',
   'WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다', 1),
  ('01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000052', 'unchanged',
   'WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다', 1);

-- 작업 + 클레임 (S4 보드 한 벌) ------------------------------------------
INSERT INTO task (id, project_id, key, title, status, priority,
                  source_spec_version_id, source_requirement_id,
                  assignee_user_id, delegate_session_id,
                  goal_md, output_format_md, tools_sources_md, boundaries_md, blocked_reason) VALUES
  ('01990a66-0000-7000-8000-000000000071', '01990a66-0000-7000-8000-000000000021',
   'TSK-a3f8', '위젯 상태별 렌더링', 'in_progress', 'P1',
   '01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000061',
   '01990a66-0000-7000-8000-000000000013', '01990a66-0000-7000-8000-000000000081',
   'SPC-CWC-007 v4의 위젯 상태별(로딩·빈·오프라인) 렌더링 구현 — REQ-CWC-031 연계',
   'PR 1건 + 상태별 스냅샷 테스트', 'nerv_spec_get으로 SPC-CWC-007 v4 본문·REQ 로드',
   '프론트엔드 위젯 코드만. 서버 세션 API는 별도 Task.', NULL),
  ('01990a66-0000-7000-8000-000000000072', '01990a66-0000-7000-8000-000000000021',
   'TSK-b904', '세션 복원 API', 'blocked', 'P1',
   '01990a66-0000-7000-8000-000000000053', NULL,
   '01990a66-0000-7000-8000-000000000014', '01990a66-0000-7000-8000-000000000082',
   'SPC-CWC-012 v1의 세션 복원 API 구현', 'PR 1건 + 통합 테스트',
   'nerv_spec_get으로 SPC-CWC-012 v1 로드', '백엔드 세션 복원 경로만.', 'awaiting_answer'),
  ('01990a66-0000-7000-8000-000000000073', '01990a66-0000-7000-8000-000000000021',
   'TSK-3f77', '스니펫 로더 캐시 헤더', 'in_progress', 'P2',
   '01990a66-0000-7000-8000-000000000052', NULL,
   '01990a66-0000-7000-8000-000000000015', '01990a66-0000-7000-8000-000000000083',
   'SPC-CWC-007 위젯 스니펫 로더의 캐시 헤더 정정', 'PR 1건',
   'nerv_spec_get으로 SPC-CWC-007 v4 로드', '로더 배포 경로만. 위젯 런타임 금지.', NULL);

UPDATE agent_session SET current_task_id = '01990a66-0000-7000-8000-000000000071' WHERE external_session_id = 'S-8f31';
UPDATE agent_session SET current_task_id = '01990a66-0000-7000-8000-000000000072' WHERE external_session_id = 'S-2d04';
UPDATE agent_session SET current_task_id = '01990a66-0000-7000-8000-000000000073' WHERE external_session_id = 'S-b7e9';

INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status,
                   scope_spec_ids, scope_file_globs, lease_expires_at) VALUES
  ('01990a66-0000-7000-8000-000000000091', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000071', '01990a66-0000-7000-8000-000000000081',
   '01990a66-0000-7000-8000-000000000013', 'active',
   ARRAY['01990a66-0000-7000-8000-000000000042']::uuid[],
   ARRAY['codebase/frontend/src/widget/**'], now() + interval '8 minutes'),
  ('01990a66-0000-7000-8000-000000000092', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000072', '01990a66-0000-7000-8000-000000000082',
   '01990a66-0000-7000-8000-000000000014', 'active',
   ARRAY['01990a66-0000-7000-8000-000000000043']::uuid[],
   ARRAY['codebase/backend/src/session-restore/**'], now() + interval '22 minutes'),
  ('01990a66-0000-7000-8000-000000000093', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000073', '01990a66-0000-7000-8000-000000000083',
   '01990a66-0000-7000-8000-000000000015', 'active',
   ARRAY['01990a66-0000-7000-8000-000000000042']::uuid[],
   ARRAY['codebase/frontend/src/loader/**'], now() + interval '21 minutes');

-- 질문 (S-2d04는 awaiting_input — S7 승인함 카드) --------------------------
INSERT INTO question (id, project_id, agent_session_id, task_id, title, body_md,
                      options, urgency, status) VALUES
  ('01990a66-0000-7000-8000-0000000000a1', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000082', '01990a66-0000-7000-8000-000000000072',
   '스토리지 선택',
   '임베드 위젯의 세션 복원을 localStorage로 할지 서버 세션으로 할지 — 스펙에 명시 없음',
   '["localStorage", "서버 세션", "스펙에 남길 질문"]', 'blocking', 'open');

-- 이벤트 (커밋 후 EventService가 §3 규약으로 nerv_events에 PUBLISH) ---------
INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, actor_session_id,
                   is_agent, subject_type, subject_id, from_state, to_state) VALUES
  ('01990a66-0000-7000-8000-0000000000b1', '01990a66-0000-7000-8000-000000000021',
   now() - interval '2 days', 'spec.approved', '01990a66-0000-7000-8000-000000000012', NULL,
   false, 'spec_version', '01990a66-0000-7000-8000-000000000052', 'in_review', 'approved'),
  ('01990a66-0000-7000-8000-0000000000b2', '01990a66-0000-7000-8000-000000000021',
   now() - interval '151 minutes', 'task.claimed', '01990a66-0000-7000-8000-000000000013',
   '01990a66-0000-7000-8000-000000000081', true, 'task',
   '01990a66-0000-7000-8000-000000000071', 'ready', 'claimed'),
  ('01990a66-0000-7000-8000-0000000000b3', '01990a66-0000-7000-8000-000000000021',
   now() - interval '22 minutes', 'question.created', '01990a66-0000-7000-8000-000000000014',
   '01990a66-0000-7000-8000-000000000082', true, 'question',
   '01990a66-0000-7000-8000-0000000000a1', NULL, NULL);

-- 알림 (question.created → 지민 승인함, critical 티어라 immediate) ----------
INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state) VALUES
  ('01990a66-0000-7000-8000-0000000000c1', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000011', '01990a66-0000-7000-8000-0000000000b3',
   'immediate', 'inapp', 'unread');

COMMIT;
