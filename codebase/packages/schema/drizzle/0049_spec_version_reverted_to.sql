-- 되돌리기로 만든 초안이 어느 옛 버전의 본문을 복사했는지 남긴다 (2026-10-15 · 사람 결정 · REQ-DB-042 · api.md REQ-API-308)
--
-- 서버가 옛 버전(승인됨 · 대체됨 · 폐기됨)의 본문을 그대로 복사해 새 초안을 만들 때 그 버전의 번호를 채운다. 제출 · 승인
-- 이벤트가 같은 값을 남기고, 롤백 신호를 게이트에 더할지는 사람이 정한다(3.5 §2.4 점화 기록). 확장만 한다 — 옛 코드는
-- 이 열을 읽지 않고, 기존 행은 NULL(되돌린 적 없음)이다.
ALTER TABLE "spec_version" ADD COLUMN "reverted_to_version_no" integer;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_reverted_to_ck" CHECK ("spec_version"."reverted_to_version_no" IS NULL OR ("spec_version"."reverted_to_version_no" >= 1 AND "spec_version"."reverted_to_version_no" < "spec_version"."version_no"));