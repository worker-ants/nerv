-- 인계와 포기를 저장에서 구별한다 (2026-09-05 · 사람 결정)
--
-- 표면은 `done`/`handoff`/`abandon` 셋을 받는데 저장은 `done` 외를 전부 `manual` 로
-- 뭉치고 있었다 — **인계와 포기가 같은 값이 됐다.** 다음 사람이 "왜 내려놨나" 를 물으면
-- 답할 수 있는 것은 `release_note` 뿐이었고, 노트를 안 남기면 그것도 없었다.
--
-- 셋은 사람·에이전트가 **고른** 이유이고, 둘은 서버가 **판정한** 이유다:
-- `expired` 는 리스 만료, `conflict` 는 겹침 회수다. 축이 다르므로 같은 열에 두되
-- 어느 쪽이 쓴 값인지가 이름으로 드러난다.
--
-- **`manual` 은 걷지 않는다.** 옛 행이 그 값을 들고 있고 소급 변환하지 않는다 —
-- 그때 무엇을 골랐는지 서버는 모른다. 모르는 것을 아는 척 채우면 그 행은 사실이 아니게
-- 된다. 새 행부터 1:1 로 들어간다.
--
-- 값 추가는 기존 행에 영향이 없다(0004 와 같은 형태).
ALTER TYPE "public"."claim_release_reason" ADD VALUE 'handoff' BEFORE 'manual';--> statement-breakpoint
ALTER TYPE "public"."claim_release_reason" ADD VALUE 'abandon' BEFORE 'manual';