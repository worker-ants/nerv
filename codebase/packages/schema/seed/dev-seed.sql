-- 개발 시드 — 정본: docs/04-mvp/database.md §4
--
-- **개발 전용이다.** TRUNCATE 후 재삽입하므로 몇 번을 실행해도 같은 상태다(REQ-DB-002).
-- UUID 는 가독성을 위한 고정값이고(UUIDv7 형식), 표시 문자열은 각 테이블의
-- key(spec·task) · ref(requirement) · external_session_id(agent_session)로 심는다.
--
-- 이 한 벌로 S1 홈(질문 배지 1) · S3 스펙 상세(SPC-CWC-007 v4 + REQ-CWC-031) ·
-- S4 작업 보드(in_progress 2 · blocked 1) · S5 세션 모니터(active 2 · awaiting_input 1) ·
-- S6 리뷰 센터(열린 발견 3 · 브랜치 2 · 면제 1) · S7 승인함(질문 카드 1) ·
-- S4 작업 상세의 증적(6건 — 종류 여섯을 전부)이 전부 비어 있지 않게 뜬다.

BEGIN;
TRUNCATE organization, "user" CASCADE;   -- FK 연쇄로 전 도메인 테이블 초기화

-- 월초 실행 대비 — 시드 이벤트의 과거 시각(최대 2일 전)이 지난달 파티션에 떨어질 수 있다
SELECT nerv_ensure_month_partitions((current_date - interval '1 month')::date);

-- 테넌시 ---------------------------------------------------------------
INSERT INTO organization (id, slug, name) VALUES
  -- 조직명은 **제품명이 아니다**(2026-08-24 정정). 헤더가 로고(제품)와 조직 select 를
  -- 나란히 두는데 둘 다 'NERV' 면 같은 이름이 두 번 서서 중복으로 읽힌다 — 시드의
  -- 조직은 "기본 조직"일 뿐이므로 그렇게 부른다.
  ('01990a66-0000-7000-8000-000000000001', 'default', 'default');

-- **관리자는 온보딩 인물과 분리한다.** 아래 다섯은 화면을 채우기 위한 등장인물이고
-- (기획자·디자이너·개발자 — 각 화면이 비어 보이지 않게 하는 것이 목적이다),
-- admin 은 조직을 세우는 사람이다. 둘을 겸하게 두면 두 가지가 어긋난다:
--   ① 지시자≠승인자(D-06) 같은 규칙을 시연할 때 admin 이 모든 자리에 앉아 있게 된다
--   ② 새 조직을 꾸릴 때 "어느 계정이 관리용인가"가 인물 설정에 묻힌다
-- 그래서 조직 소속(project_id NULL) 멤버십을 가진 admin 을 따로 둔다.
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
  -- 조직 소속(project_id NULL) — 프로젝트가 늘어도 이 한 행이 조직 전체를 관리한다
  ('01990a66-0000-7000-8000-000000000030', '01990a66-0000-7000-8000-000000000001', NULL, '01990a66-0000-7000-8000-000000000010', 'admin'),
  ('01990a66-0000-7000-8000-000000000031', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000011', 'planner'),
  ('01990a66-0000-7000-8000-000000000032', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000012', 'designer'),
  ('01990a66-0000-7000-8000-000000000033', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000013', 'developer'),
  ('01990a66-0000-7000-8000-000000000034', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000014', 'developer'),
  ('01990a66-0000-7000-8000-000000000035', '01990a66-0000-7000-8000-000000000001', '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000015', 'developer');

-- **겸직 한 벌**(0003_multi_role). clemvion 실측에서 `planner/developer`·
-- `project-planner + developer` 같은 복합 표기가 20건이었다 — 예외가 아니라 흔한 형태다.
-- 지민은 planner 이면서 developer 다: 화면과 판정이 "하나 고르기"로 되돌아가면 여기서 깨진다.
INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
  ('01990a66-0000-7000-8000-000000000036', '01990a66-0000-7000-8000-000000000001',
   '01990a66-0000-7000-8000-000000000021', '01990a66-0000-7000-8000-000000000011', 'developer');

INSERT INTO api_token (id, project_id, user_id, name, token_hash, prefix, scopes) VALUES
  ('01990a66-0000-7000-8000-000000000036', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000015', '노트북 Claude Code',
   digest('dev-seed-token-hana', 'sha256'), 'nrv_dev1',
   -- 어휘에 있는 값만 심는다 — 하나는 clemvion 의 developer 다(2026-09-04 정정).
   -- 예전 씨앗은 spec:write·review:write·session:write 를 심었고, 셋 다 어휘에 없어
   -- 사용 시점에 버려지면서 설정 화면에만 남아 있었다.
   ARRAY['spec:read', 'spec:draft', 'task:claim', 'task:update', 'review:submit',
         'agent-session:launch']);

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
-- `blocked_reason` 은 **사람이 읽는 문장**이다(자유 텍스트). 코드처럼 생긴 값을 넣으면
-- 화면에 그대로 찍혀 "awaiting_answer" 가 사용자에게 보인다(실측 2026-08-23) —
-- 막힌 이유를 읽으려는 사람에게 그 토큰은 아무것도 말해 주지 않는다.
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
   'nerv_spec_get으로 SPC-CWC-012 v1 로드', '백엔드 세션 복원 경로만.', '유나의 질문(스토리지 선택)에 답이 오기 전에는 계약을 못 정한다'),
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

-- 리뷰 (S6 리뷰 센터 — screens.md §2.6a) -----------------------------------
--
-- **화면마다 데이터 있음 경로가 뜬다**는 검사에 S6 이 새로 들어왔다. 비워 두면
-- 리뷰 센터가 개발 환경에서 늘 빈 목록이고, 그 화면의 값어치가 "원시 diff 대신
-- 정리된 finding" 인데 정리된 것이 없으면 만들다 만 껍데기로 보인다.
--
-- 한 벌의 모양: 브랜치 둘 × 라운드 체인(1→2) — 통과 하나와 대기 하나를 함께 보여
-- 게이트 판정 3종 중 둘이 화면에 뜨게 한다. 발견 3건은 severity 3종을 채우고,
-- 그중 하나는 **2라운드에서 다시 관측된 같은 지적**이다(fingerprint dedup 표기).
INSERT INTO review_session (id, project_id, kind, "trigger", agent_session_id, task_id,
                            branch, head_sha, base_sha, changeset_hash, file_count, round_no,
                            previous_session_id, state, risk, block, started_at, completed_at)
VALUES
  ('01990a66-0000-7000-8000-0000000000f1', '01990a66-0000-7000-8000-000000000021',
   'code', 'auto', '01990a66-0000-7000-8000-000000000081',
   '01990a66-0000-7000-8000-000000000071',
   'feature/widget-v2', '9a41c2f0e1', '3d90f1aabb', decode(repeat('a1', 32), 'hex'), 4, 1,
   NULL, 'complete', 'high', true, now() - interval '5 hours', now() - interval '5 hours'),
  ('01990a66-0000-7000-8000-0000000000f2', '01990a66-0000-7000-8000-000000000021',
   'code', 'auto', '01990a66-0000-7000-8000-000000000081',
   '01990a66-0000-7000-8000-000000000071',
   'feature/widget-v2', '7b22ce90aa', '9a41c2f0e1', decode(repeat('a2', 32), 'hex'), 2, 2,
   '01990a66-0000-7000-8000-0000000000f1', 'complete', 'medium', true,
   now() - interval '90 minutes', now() - interval '88 minutes'),
  ('01990a66-0000-7000-8000-0000000000f3', '01990a66-0000-7000-8000-000000000021',
   'consistency', 'manual', NULL, NULL,
   'feat/session-restore', '5c31aa7b02', '3d90f1aabb', decode(repeat('a3', 32), 'hex'), 3, 1,
   NULL, 'complete', 'low', false, now() - interval '2 days', now() - interval '2 days');

INSERT INTO reviewer_report (id, review_session_id, role, risk, body_md, has_report) VALUES
  ('01990a66-0000-7000-8000-0000000000f4', '01990a66-0000-7000-8000-0000000000f1',
   'security', 'high', '세션 복원 경로의 저장 매체를 봤다. 토큰이 평문으로 남는다.', true),
  ('01990a66-0000-7000-8000-0000000000f5', '01990a66-0000-7000-8000-0000000000f1',
   'requirement', 'medium', 'REQ-CWC-031 의 오프라인 배너 문구가 구현과 다르다.', true),
  ('01990a66-0000-7000-8000-0000000000f6', '01990a66-0000-7000-8000-0000000000f2',
   'security', 'medium', '토큰 저장은 그대로다. 캐시 헤더가 새로 걸린다.', true),
  ('01990a66-0000-7000-8000-0000000000f7', '01990a66-0000-7000-8000-0000000000f3',
   'cross-spec', 'low', '스펙 간 모순 없음.', true);

-- fingerprint 는 실제 알고리즘의 산출이 아니라 **고정값**이다(시드는 재현이 목적이다).
-- 실물 값은 @nerv/schema/keys 의 findingFingerprint 가 만든다.
INSERT INTO finding (id, project_id, fingerprint, severity, tags, category, title, detail_md,
                     suggestion_md, file_path, line_start, symbol, spec_version_id,
                     requirement_id, status, first_session_id, last_session_id,
                     occurrence_count, created_at) VALUES
  ('01990a66-0000-7000-8000-0000000000f8', '01990a66-0000-7000-8000-000000000021',
   decode(repeat('b1', 32), 'hex'), 'critical', '{}', 'security',
   '세션 토큰이 localStorage 에 평문 저장',
   'XSS 한 번이면 그대로 새어 나간다. 서버 세션 쿠키로 옮겨야 한다.',
   'httpOnly 쿠키 + 서버 세션으로 전환',
   'codebase/frontend/src/widget/session.ts', 88, 'restoreSession',
   '01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000061',
   'open', '01990a66-0000-7000-8000-0000000000f1', '01990a66-0000-7000-8000-0000000000f2',
   2, now() - interval '5 hours'),
  ('01990a66-0000-7000-8000-0000000000f9', '01990a66-0000-7000-8000-000000000021',
   decode(repeat('b2', 32), 'hex'), 'warning', '{spec_drift}', 'requirement',
   '오프라인 재시도 배너 문구가 스펙과 다르다',
   '구현이 더 정확하다 — 스펙 쪽을 CR 로 보정하는 편이 맞다.',
   NULL, 'codebase/frontend/src/widget/offline-banner.tsx', 24, NULL,
   '01990a66-0000-7000-8000-000000000052', '01990a66-0000-7000-8000-000000000061',
   'open', '01990a66-0000-7000-8000-0000000000f1', '01990a66-0000-7000-8000-0000000000f1',
   1, now() - interval '5 hours'),
  ('01990a66-0000-7000-8000-0000000000fa', '01990a66-0000-7000-8000-000000000021',
   decode(repeat('b3', 32), 'hex'), 'info', '{}', 'convention',
   '로더 캐시 헤더 TTL 미지정',
   NULL, 'max-age 와 stale-while-revalidate 를 나눠 적는다',
   'codebase/frontend/src/widget/loader.ts', 12, NULL, NULL, NULL,
   'open', '01990a66-0000-7000-8000-0000000000f2', '01990a66-0000-7000-8000-0000000000f2',
   1, now() - interval '90 minutes'),
  ('01990a66-0000-7000-8000-0000000000fb', '01990a66-0000-7000-8000-000000000021',
   decode(repeat('b4', 32), 'hex'), 'warning', '{}', 'cross-spec',
   '복원 실패 시 재시도 횟수가 스펙에 없다',
   NULL, NULL, 'codebase/frontend/src/widget/session.ts', 141, NULL,
   NULL, NULL,
   'fixed', '01990a66-0000-7000-8000-0000000000f3', '01990a66-0000-7000-8000-0000000000f3',
   1, now() - interval '2 days');

-- 출현 — 같은 지적이 2라운드에 다시 보인 것이 dedup 표기의 근거다(occurrence_count 2)
INSERT INTO finding_occurrence (id, finding_id, review_session_id, reviewer_report_id,
                                round_no, display_no, raw_severity) VALUES
  ('01990a66-0000-7000-8000-0000000000fc', '01990a66-0000-7000-8000-0000000000f8',
   '01990a66-0000-7000-8000-0000000000f1', '01990a66-0000-7000-8000-0000000000f4', 1, 1, 'critical'),
  ('01990a66-0000-7000-8000-0000000000fd', '01990a66-0000-7000-8000-0000000000f8',
   '01990a66-0000-7000-8000-0000000000f2', '01990a66-0000-7000-8000-0000000000f6', 2, 1, 'warning'),
  ('01990a66-0000-7000-8000-0000000000fe', '01990a66-0000-7000-8000-0000000000f9',
   '01990a66-0000-7000-8000-0000000000f1', '01990a66-0000-7000-8000-0000000000f5', 1, 2, 'warning'),
  ('01990a66-0000-7000-8000-0000000000ff', '01990a66-0000-7000-8000-0000000000fa',
   '01990a66-0000-7000-8000-0000000000f2', '01990a66-0000-7000-8000-0000000000f6', 2, 2, 'info'),
  ('01990a66-0000-7000-8000-000000000f01', '01990a66-0000-7000-8000-0000000000fb',
   '01990a66-0000-7000-8000-0000000000f3', '01990a66-0000-7000-8000-0000000000f7', 1, 1, 'warning');

-- 2라운드에서 critical 이 warning 으로 내려왔다(raw_severity 대조로 감사한다).
-- finding.severity 는 처음 값을 지킨다 — 리뷰어가 자기 지적을 조용히 낮추지 못한다.

INSERT INTO resolution (id, finding_id, kind, commit_sha, rationale_md, actor_user_id) VALUES
  ('01990a66-0000-7000-8000-000000000f02', '01990a66-0000-7000-8000-0000000000fb',
   'fixed', 'e91ba7c2', '재시도 3회 + 지수 백오프로 구현하고 스펙에 절을 추가했다.',
   '01990a66-0000-7000-8000-000000000015');

-- 게이트 면제 — **면제도 결재 레코드다**(FR-10). 리뷰 세션을 주체로 붙는다
INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                      decision, decided_at, is_bypass, bypass_reason) VALUES
  ('01990a66-0000-7000-8000-000000000f03', '01990a66-0000-7000-8000-000000000021',
   'gate_bypass', '01990a66-0000-7000-8000-0000000000f3',
   '01990a66-0000-7000-8000-000000000015', 'approve', now() - interval '1 day', true,
   '핫픽스 배포, 사후 리뷰 예약');

-- 증적 (S4 작업 상세 — screens.md §2.5 ⑥) ---------------------------------
--
-- **이 표만 비어 있었다**(2026-09-10). 시드는 리뷰·활동·질문을 다 심으면서 증적은 0건이라,
-- 작업 상세의 증적 카드가 개발 환경에서 늘 "아직 없습니다" 였다 — 그리고 그 카드에 붙은
-- 링크(screens.md REQ-WEB-159~162)는 **시드로는 한 번도 그려진 적이 없다.** 화면에 길을
-- 내고도 그 길을 지나가는 데이터가 없으면 L3 도 스크린샷도 그 길을 보지 못한다.
--
-- 리뷰 블록 **뒤에** 두는 이유는 하나다: `review` 증적의 locator 가 위 finding 을 가리킨다.
-- (locator 는 텍스트라 FK 가 아니지만, 읽는 사람이 위에서 그 id 를 이미 본 편이 낫다.)
--
-- 한 벌의 모양: **종류 여섯을 전부** 쓴다 — 링크가 되는 넷(pr·commit·code_path·review),
-- 매뉴얼로 가는 하나(user_guide), 그리고 **링크가 되지 않는 하나**(test — 저장소마다 모양이
-- 달라 짐작하지 않는다). 그리고 하나는 `repo` 를 달아 **다른 저장소**를 가리킨다:
-- 세션 복원은 백엔드 저장소의 일이고, 그 경로가 화면에 실제로 그려지는 유일한 자리다.
INSERT INTO evidence (id, project_id, requirement_id, task_id, kind, locator, repo, source,
                      created_at) VALUES
  -- 링크가 되는 것들 — 프로젝트의 저장소(repo_url) 위에 선다
  ('01990a66-0000-7000-8000-000000000101', '01990a66-0000-7000-8000-000000000021',
   NULL, '01990a66-0000-7000-8000-000000000071', 'pr',
   'https://git.example.com/nerv/clemvion/pull/481', NULL, 'human', now() - interval '4 hours'),
  ('01990a66-0000-7000-8000-000000000102', '01990a66-0000-7000-8000-000000000021',
   NULL, '01990a66-0000-7000-8000-000000000071', 'commit',
   '7b22ce90aa', NULL, 'ci', now() - interval '90 minutes'),
  -- 요구사항에도 매단다 — S3 요구사항 탭의 증적 수가 0 이 아니게 된다(FR-13)
  ('01990a66-0000-7000-8000-000000000103', '01990a66-0000-7000-8000-000000000021',
   '01990a66-0000-7000-8000-000000000061', '01990a66-0000-7000-8000-000000000071', 'code_path',
   'codebase/frontend/src/widget/session.ts:88', NULL, 'agent', now() - interval '3 hours'),
  -- 리뷰 증적 — 발견 하나를 가리키면 리뷰 센터의 그 지적으로 간다(REQ-WEB-120)
  ('01990a66-0000-7000-8000-000000000104', '01990a66-0000-7000-8000-000000000021',
   NULL, '01990a66-0000-7000-8000-000000000071', 'review',
   '01990a66-0000-7000-8000-0000000000f8', NULL, 'agent', now() - interval '80 minutes'),
  -- 매뉴얼의 장 — 이름이 실재하는 장일 때만 링크가 된다(REQ-WEB-161)
  ('01990a66-0000-7000-8000-000000000105', '01990a66-0000-7000-8000-000000000021',
   NULL, '01990a66-0000-7000-8000-000000000071', 'user_guide',
   '/help/tasks', NULL, 'human', now() - interval '2 hours'),
  -- **링크가 되지 않는 한 줄** — 테스트 이름은 저장소마다 모양이 달라 짐작하지 않는다.
  -- 화면에 평문으로 남는 자리가 하나는 있어야 그 규칙이 눈에 보인다.
  ('01990a66-0000-7000-8000-000000000106', '01990a66-0000-7000-8000-000000000021',
   NULL, '01990a66-0000-7000-8000-000000000071', 'test',
   'widget/session.spec.ts > 이전 대화를 복원한다', NULL, 'ci', now() - interval '70 minutes'),
  -- **다른 저장소에 선 증적** — 세션 복원은 백엔드의 일이다. 호스트는 프로젝트 주소에서
  -- 빌리고 경로만 갈아 끼운다(REQ-API-157)
  ('01990a66-0000-7000-8000-000000000107', '01990a66-0000-7000-8000-000000000021',
   NULL, '01990a66-0000-7000-8000-000000000072', 'commit',
   '5c31aa7b02', 'nerv/clemvion-api', 'ci', now() - interval '2 days');

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
