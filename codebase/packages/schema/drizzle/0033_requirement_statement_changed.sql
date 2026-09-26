-- 검증 서명은 그 문장에 대한 것이다 (2026-09-26 · 사람 결정 · spec-workflow §1.3 · REQ-API-190)
--
-- 새 버전 승인이 요구사항 문장을 바꿔도 `verified` 가 그대로 남아, 검증 배지가 아무도 확인하지
-- 않은 문장을 보증했다. 문장이 바뀐 시각을 남기고, 그보다 앞선 서명은 지금 문장을 보증하지
-- 않는 것으로 본다 — 검증이 풀리고 "다시 검증 필요" 가 선다. 과거 행은 NULL(바뀐 적 없음)로 둔다:
-- 이 열이 생기기 전의 변경은 알 수 없고, 실데이터에 서명된 증적이 아직 없다.
ALTER TABLE "requirement" ADD COLUMN "statement_changed_at" timestamp with time zone;