-- 리뷰 수집(FR-09) 착수 — critical 하향의 승인 카드가 실릴 자리 (2026-08-23)
--
-- `nerv_finding_resolve(critical → dismissed/wont_fix)` 는 A3 다
-- (agent-integration §2.3 — 근거: clemvion 에서 checker 의 CRITICAL 을 `BLOCK: NO` 로
-- 하향한 모순이 732건 중 24건). A3 는 "막는다"가 아니라 **사람의 승인함을 거친다**는
-- 뜻이고, 승인함의 레코드는 `approval` 이다. 그런데 `approval_subject_type` 에
-- `finding` 이 없어 카드를 만들 자리가 없었다 — 리뷰 표면이 Phase 2 라 열거에서 빠져
-- 있었다. 값 하나를 더한다(추가는 기존 행에 영향이 없다).
ALTER TYPE "public"."approval_subject_type" ADD VALUE IF NOT EXISTS 'finding';
