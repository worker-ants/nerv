-- 초대받은 사람이 거절할 수 있다 (2026-09-24 · 사람 결정 · REQ-API-178)
--
-- 원치 않는 초대는 거절할 길이 없어 만료(7일)까지 홈·알림 맨 위에 서 있었다. 거절은 회수와
-- **누가 끝냈는가**가 달라 열을 따로 둔다 — 한 열에 담으면 admin 은 자기가 거둔 적 없는 초대가
-- "회수됨" 인 것을 본다. 대기 중 초대의 부분 unique 에도 넣는다: 거절한 초대가 자리를 차지하면
-- 마음을 바꾼 사람을 다시 부를 수 없다.
DROP INDEX "invitation_pending_uq";--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_uq" ON "invitation" USING btree ("email",coalesce("project_id", "org_id")) WHERE accepted_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL;