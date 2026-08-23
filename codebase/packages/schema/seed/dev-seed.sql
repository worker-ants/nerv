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

-- **관리자는 온보딩 인물과 분리한다.** 아래 다섯은 화면을 채우기 위한 등장인물이고
-- (기획자·디자이너·개발자 — 각 화면이 비어 보이지 않게 하는 것이 목적이다),
-- admin 은 조직을 세우는 사람이다. 둘을 겸하게 두면 두 가지가 어긋난다:
--   ① 지시자≠승인자(D-06) 같은 규칙을 시연할 때 admin 이 모든 자리에 앉아 있게 된다
--   ② 새 조직을 꾸릴 때 "어느 계정이 관리용인가"가 인물 설정에 묻힌다
-- 그래서 조직 스코프(project_id NULL) 멤버십을 가진 admin 을 따로 둔다.
INSERT INTO "user" (id, email, display_name, state) VALUES
  ('01990a66-0000-7000-8000-000000000010', 'admin@example.com',  '관리자', 'active'),
  ('01990a66-0000-7000-8000-000000000011', 'jimin@example.com',  '지민', 'active'),
  ('01990a66-0000-7000-8000-000000000012', 'seoyeon@example.com','서연', 'active'),
  ('01990a66-0000-7000-8000-000000000013', 'dohyun@example.com', '도현', 'active'),
  ('01990a66-0000-7000-8000-000000000014', 'yuna@example.com',   '유나', 'active'),
  ('01990a66-0000-7000-8000-000000000015', 'hana@example.com',   '하나', 'active');

INSERT INTO project (id, org_id, slug, key, name, repo_url, default_branch) VALUES
  ('01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000001',
   'clemvion', 'CLV', 'clemvion', 'https://git.example.com/nerv/clemvion.git', 'main');

INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
  -- 조직 스코프(project_id NULL) — 프로젝트가 늘어도 이 한 행이 조직 전체를 관리한다
  ('01990a66-0000-7000-8000-000000000030', '01990a66-0000-7000-8000-000000000001', NULL, '01990a66-0000-7000-8000-000000000010', 'admin'),
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
-- sort_key 는 **폭을 고정한다**(4.7 §2.2 — `0` + 6자리 zero-pad, 접두 없으면 `1`).
-- 임포터가 만드는 값과 같은 규약이어야 한 트리 안에서 섞이지 않는다: 옛 표기 '7' 은
-- 텍스트 정렬에서 임포트한 '0000007' 보다 뒤로 가 노드 하나가 엉뚱한 자리에 선다(실측).
INSERT INTO spec (id, project_id, parent_id, type, key, title, sort_key) VALUES
  ('01990a66-0000-7000-8000-000000000041', '01990a66-0000-7000-8000-000000000021', NULL,
   'area', 'channel-web-chat', '채널 · 웹챗', '0000007'),
  -- 표시 ID(SPC-*)를 key로 심는다 — 웹 라우트 /p/clemvion/specs/SPC-CWC-007 정합
  ('01990a66-0000-7000-8000-000000000042', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000041', 'feature', 'SPC-CWC-007', '웹챗 위젯 임베드 v2', '0000002'),
  ('01990a66-0000-7000-8000-000000000043', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000041', 'feature', 'SPC-CWC-012', '세션 복원 API', '0000003');

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
   'CLV-T-1KTDCK', '위젯 상태별 렌더링', 'in_progress', 'P1',
   '01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000061',
   '01990a66-0000-7000-8000-000000000013', '01990a66-0000-7000-8000-000000000081',
   'SPC-CWC-007 v4의 위젯 상태별(로딩·빈·오프라인) 렌더링 구현 — REQ-CWC-031 연계',
   'PR 1건 + 상태별 스냅샷 테스트', 'nerv_spec_get으로 SPC-CWC-007 v4 본문·REQ 로드',
   '프론트엔드 위젯 코드만. 서버 세션 API는 별도 Task.', NULL),
  ('01990a66-0000-7000-8000-000000000072', '01990a66-0000-7000-8000-000000000021',
   'CLV-T-TRA25N', '세션 복원 API', 'blocked', 'P1',
   '01990a66-0000-7000-8000-000000000053', NULL,
   '01990a66-0000-7000-8000-000000000014', '01990a66-0000-7000-8000-000000000082',
   'SPC-CWC-012 v1의 세션 복원 API 구현', 'PR 1건 + 통합 테스트',
   'nerv_spec_get으로 SPC-CWC-012 v1 로드', '백엔드 세션 복원 경로만.', 'awaiting_answer'),
  ('01990a66-0000-7000-8000-000000000073', '01990a66-0000-7000-8000-000000000021',
   'CLV-T-0CFQC2', '스니펫 로더 캐시 헤더', 'in_progress', 'P2',
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

-- Activity 타임라인 (§2.6 · S5 세션 상세 — ui-wireframes §2.5 둘째 그림) ------
--
-- 이 화면의 값어치는 **사람의 개입이 에이전트의 행동과 같은 줄에 섞이는 것**인데,
-- 시드가 이 테이블을 비워 두어 개발 환경에서는 늘 빈 목록이었다(실측 2026-08-23).
-- 화면의 중심이 비어 있으면 "안 만든 껍데기"로 보인다.
--
-- `created_at` 은 **월 파티션 키**다(§2.14). 초기 스냅샷은 이번 달과 다음 달만 만들므로
-- 월초에 시드를 돌리면 음수 오프셋이 지난달로 넘어가 파티션이 없어 실패한다 —
-- 그래서 이번 달 시작으로 자른다. 순서는 `seq` 가 정하니 잘려도 이야기는 안 흐트러진다.
--
-- 도구 이름은 **MVP 16종**만 쓴다(scope.md §4.2). 와이어프레임에는 `nerv_review_submit`
-- 이 있으나 그것은 Phase 2 라, 없는 도구를 개발 데이터가 보여 주면 안 된다.
INSERT INTO activity (id, session_id, project_id, seq, type, title, body_md, tool_name, created_at)
SELECT v.id::uuid, v.session_id::uuid, '01990a66-0000-7000-8000-000000000021'::uuid,
       v.seq, v.type::activity_type, v.title, v.body_md, v.tool_name,
       greatest(now() - (v.ago_min || ' minutes')::interval, date_trunc('month', now()))
  FROM (VALUES
    -- S-8f31 · 도현 · mac-02 — 클레임부터 질문·응답까지 한 줄기로 읽힌다
    ('01990a66-0000-7000-8000-0000000000c1', '01990a66-0000-7000-8000-000000000081', 1,
     'thought', 'ready 큐 1순위 확인, scope 겹침 없음', NULL, NULL, 151),
    ('01990a66-0000-7000-8000-0000000000c2', '01990a66-0000-7000-8000-000000000081', 2,
     'action', 'nerv_task_next → 후보 3건', '기준 SpecVersion 포함', 'nerv_task_next', 150),
    ('01990a66-0000-7000-8000-0000000000c3', '01990a66-0000-7000-8000-000000000081', 3,
     'action', 'nerv_task_claim(CLV-T-1KTDCK) → ok · 리스 30:00', NULL, 'nerv_task_claim', 149),
    ('01990a66-0000-7000-8000-0000000000c4', '01990a66-0000-7000-8000-000000000081', 4,
     'action', 'nerv_spec_get(SPC-CWC-007@v4) · REQ 3건 로드', NULL, 'nerv_spec_get', 145),
    ('01990a66-0000-7000-8000-0000000000c5', '01990a66-0000-7000-8000-000000000081', 5,
     'thought', '위젯 상태 4종 중 empty·error 를 먼저 구현', NULL, NULL, 120),
    -- 사람이 끼어드는 지점 — 이 두 줄이 위아래 행동 사이에 섞여야 화면이 제 일을 한다
    ('01990a66-0000-7000-8000-0000000000c6', '01990a66-0000-7000-8000-000000000081', 6,
     'elicitation', '"세션 복원 저장소" → 질문 생성, awaiting_input', '스펙에 명시 없음 — 사람 판단 필요', 'nerv_question_create', 96),
    ('01990a66-0000-7000-8000-0000000000c7', '01990a66-0000-7000-8000-000000000081', 7,
     'response', '지민 응답 (B) 서버 세션 → active 복귀', NULL, NULL, 65),
    ('01990a66-0000-7000-8000-0000000000c8', '01990a66-0000-7000-8000-000000000081', 8,
     'action', 'nerv_task_heartbeat → pending 0', NULL, 'nerv_task_heartbeat', 8),
    -- S-2d04 · codex · linux-ci-01 — **왜 stale 인지가 마지막 줄에 있다**
    ('01990a66-0000-7000-8000-0000000000d1', '01990a66-0000-7000-8000-000000000082', 1,
     'action', 'nerv_task_claim(CLV-T-TRA25N) → ok · 리스 30:00', NULL, 'nerv_task_claim', 80),
    ('01990a66-0000-7000-8000-0000000000d2', '01990a66-0000-7000-8000-000000000082', 2,
     'thought', '세션 복원 API 계약부터 확정한다', NULL, NULL, 74),
    ('01990a66-0000-7000-8000-0000000000d3', '01990a66-0000-7000-8000-000000000082', 3,
     'elicitation', '"스토리지 선택" → 질문 생성, blocking', 'localStorage / 서버 세션', 'nerv_question_create', 70),
    ('01990a66-0000-7000-8000-0000000000d4', '01990a66-0000-7000-8000-000000000082', 4,
     'error', '답을 기다리다 하트비트 끊김 — 무활동 30분 초과', '리스가 회수됐다(D-13)', NULL, 33),
    -- S-b7e9 · 하나 · mac-07
    ('01990a66-0000-7000-8000-0000000000e1', '01990a66-0000-7000-8000-000000000083', 1,
     'action', 'nerv_task_claim(CLV-T-0CFQC2) → ok', NULL, 'nerv_task_claim', 48),
    ('01990a66-0000-7000-8000-0000000000e2', '01990a66-0000-7000-8000-000000000083', 2,
     'action', 'nerv_spec_get(SPC-CWC-007@v4) · 캐시 헤더 절 확인', NULL, 'nerv_spec_get', 45),
    ('01990a66-0000-7000-8000-0000000000e3', '01990a66-0000-7000-8000-000000000083', 3,
     'thought', 'max-age 와 stale-while-revalidate 를 나눠 둔다', NULL, NULL, 40)
  ) AS v(id, session_id, seq, type, title, body_md, tool_name, ago_min);

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
