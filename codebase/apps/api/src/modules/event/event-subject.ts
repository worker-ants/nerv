// 이벤트가 **무엇에** 일어났나 — 피드와 알림이 같은 규칙으로 대상을 읽는다 (2026-09-24 · REQ-API-181)
//
// event 행은 대상을 `(subject_type, subject_id)` 로만 든다 — 키도 제목도 없다(키는 방송 봉투에만 실린다).
// 그래서 피드는 "초안 수정 · 관리자 · 16일 전" 을 여덟 줄 늘어놓아도 어느 스펙인지 말하지 못했고,
// 알림 목록은 스펙·작업 주체만 조인해서 **가장 무거운 알림**(결재 요청 · 에이전트 질문)이 키도 제목도
// 없이 "승인 요청" 만 반복했다. 대상이 결재·질문·클레임·리뷰처럼 한 단계 건너에 있을 때도 그 너머의
// 스펙·작업·발견까지 따라가 같은 칸으로 싣는다:
//
//   spec_key · spec_title · version_no — 스펙 버전 · 스펙 · 결재(스펙 버전) · 질문(스펙)
//   task_key · task_title              — 작업 · 결재(플랜) · 클레임 · 리뷰 세션 · 질문(작업)
//   finding_id · finding_title         — 발견 · 결재(critical 하향)
//   question_title                     — 질문 · 결재(질문)
//   review_branch                      — 리뷰 세션
//   session_hostname · session_agent_type — 에이전트 세션(시스템이 낸 `session.stale` 은 행위자가 없다)
//
// 두 목록이 이 조각 하나를 쓴다 — 자리마다 조인을 다시 적으면 한쪽만 자라고, 같은 이벤트가 피드와
// 알림에서 다른 대상을 말하게 된다. 별칭은 `sj_` 로 시작한다: 부르는 쪽의 조인과 겹치지 않게.

import { sql } from 'drizzle-orm';

/** SELECT 목록에 넣는 대상 칸 — 앞뒤 쉼표는 부르는 쪽이 둔다 */
export const EVENT_SUBJECT_COLUMNS = sql`
       sj_s.key AS spec_key, sj_s.title AS spec_title, sj_sv.version_no AS version_no,
       sj_t.key AS task_key, sj_t.title AS task_title,
       sj_f.id AS finding_id, sj_f.title AS finding_title,
       sj_q.title AS question_title,
       sj_rs.branch AS review_branch,
       sj_as.hostname AS session_hostname, sj_as.agent_type::text AS session_agent_type`;

/** FROM 뒤에 붙이는 조인 — 이벤트의 별칭이 `e` 여야 한다 */
export const EVENT_SUBJECT_JOINS = sql`
   LEFT JOIN approval sj_ap ON sj_ap.id = e.subject_id AND e.subject_type = 'approval'
   LEFT JOIN question sj_q ON sj_q.id = CASE WHEN e.subject_type = 'question' THEN e.subject_id
                                              WHEN sj_ap.subject_type = 'question' THEN sj_ap.subject_id END
   LEFT JOIN claim sj_cl ON sj_cl.id = e.subject_id AND e.subject_type = 'claim'
   LEFT JOIN review_session sj_rs ON sj_rs.id = e.subject_id AND e.subject_type = 'review_session'
   LEFT JOIN agent_session sj_as ON sj_as.id = e.subject_id AND e.subject_type = 'agent_session'
   LEFT JOIN spec_version sj_sv ON sj_sv.id = CASE WHEN e.subject_type = 'spec_version' THEN e.subject_id
                                                    WHEN sj_ap.subject_type = 'spec_version' THEN sj_ap.subject_id END
   LEFT JOIN spec sj_s ON sj_s.id = coalesce(sj_sv.spec_id,
                                             CASE WHEN e.subject_type = 'spec' THEN e.subject_id END,
                                             sj_q.spec_id)
   LEFT JOIN task sj_t ON sj_t.id = CASE WHEN e.subject_type = 'task' THEN e.subject_id
                                         WHEN sj_ap.subject_type = 'plan' THEN sj_ap.subject_id
                                         ELSE coalesce(sj_cl.task_id, sj_rs.task_id, sj_q.task_id) END
   LEFT JOIN finding sj_f ON sj_f.id = CASE WHEN e.subject_type = 'finding' THEN e.subject_id
                                            WHEN sj_ap.subject_type = 'finding' THEN sj_ap.subject_id END`;
