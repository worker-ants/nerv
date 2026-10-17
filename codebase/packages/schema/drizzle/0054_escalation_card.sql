-- 에스컬레이션 카드와 기다리는 세션 · 변경 요청에 묶인 발견 (2026-10-16 · 사람 결정 D3 · REQ-DB-049 · api.md REQ-API-333 ~ 338)
--
-- ① 결재 대상에 `escalation` 을 더한다 — 발견을 사람에게 넘긴 처분 한 건(`resolution` · `kind = escalated`)이 받은 요청의 카드가
--    된다. 사유마다 받는 사람이 다르다(spec → planner · infra · sensitive-fix → admin · 그 밖 → 작업 담당자와 기본 큐). critical
--    하향 카드(`finding`)와 나눈 이유는 그 값의 승인이 하향을 연다는 데 있다. 값을 더하기만 하고 이 마이그레이션 안에서 쓰지
--    않으므로 트랜잭션 안에서도 된다(0050 · 0053 과 같다).
-- ② `resolution.blocking` — 넘긴 세션이 결정을 기다리는가. 참이면 그 세션은 `awaiting_input` 이 되고 카드의 결정이 푼다.
--    있던 행은 거짓이다 — 이 열이 생기기 전의 에스컬레이션은 카드도 기다림도 없었다.
-- ③ 변경 요청으로 보낸 발견을 CR 에서 찾는 색인 — CR 이 승인되면 그 발견은 `fixed`(스펙 수정), 거절되면 `dismissed` 와 되돌림
--    작업이 된다(spec-workflow §3.4).
ALTER TYPE "public"."approval_subject_type" ADD VALUE 'escalation';--> statement-breakpoint
ALTER TABLE "resolution" ADD COLUMN "blocking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "resolution_change_request" ON "resolution" USING btree ("change_request_id") WHERE "resolution"."change_request_id" IS NOT NULL;