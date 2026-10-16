-- 작업의 증적을 찾는 인덱스 (2026-10-15 · REQ-DB-045 · api.md REQ-API-314 · 315)
--
-- done 게이트의 커밋 신선도와 구현 축의 커밋 범위가 작업의 최신 `commit` 증적(`task_id` 로 찾고 받은 순서
-- `created_at DESC, id DESC` 의 첫 행)을 읽는데 `evidence` 에 `task_id` 인덱스가 없어 표 전체를 훑었다. 같은 순서의
-- 오름차순 인덱스를 두면 최신 커밋은 거꾸로 읽어 첫 행에서 멈출 수 있고, 작업의 증적 목록 · 수 · 웹훅 dedup 도 그 작업의
-- 행만 읽는다. 작업에 묶이지 않은 증적(요구사항 · 스펙 버전에만 묶인 것)은 넣지 않는다. 확장만 한다.
CREATE INDEX "evidence_task" ON "evidence" USING btree ("task_id","created_at","id") WHERE "evidence"."task_id" IS NOT NULL;