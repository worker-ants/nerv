-- 스펙 안정 키는 프로젝트 안에서 유일하다 (2026-08-30 — 사람 결정 · api.md §1.4i)
--
-- 도구·URL·본문 링크가 전부 이 키로 문서를 가리키는데 유일하지 않았다. 같은 키를 가진
-- 문서 둘 중 하나는 어느 조회에도 걸리지 않는 유령이 된다.
CREATE UNIQUE INDEX "spec_key_uq" ON "spec" USING btree ("project_id","key");
