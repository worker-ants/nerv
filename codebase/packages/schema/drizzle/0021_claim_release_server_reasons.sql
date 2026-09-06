-- 세션 종료와 강제 정지를 저장에서 구별한다 (2026-09-06 · 사람 결정)
--
-- 0019 가 인계와 포기를 갈랐는데, **같은 결함이 두 경로에 그대로 남아 있었다**:
-- `nerv_session_end` 로 끝난 세션의 회수와 사람이 EP-SES-04 로 중단한 회수가 둘 다
-- `manual` 이었다. 다음 사람이 "왜 내려놨나" 를 물으면 답할 수 있는 것은 `release_note`
-- 뿐이고, 노트를 안 남기면 그것도 없다 — 0019 가 적은 문장 그대로다.
--
-- **`handoff`·`abandon` 에 얹지 않는다.** 그 둘은 사람·에이전트가 **고른** 값이고
-- 이 둘은 서버가 **판정한** 값이다. 축이 다른 것을 같은 이름에 넣으면 0019 가 고친
-- 오류를 반대 방향으로 반복하게 된다 — 고르지 않은 것을 고른 것처럼 적는 일이다.
--
-- `manual` 은 걷지 않는다: 옛 행이 그 값을 들고 있고 소급 변환하지 않는다(0019 와 같은
-- 판단). `conflict` 는 남기되 **생산자가 없다** — 이 설계에서 겹침은 회수가 아니라
-- 거절이다(D-04). 그 사실은 `enums.ts` 주석이 적는다.
--
-- 값 추가는 기존 행에 영향이 없다(0004·0019 와 같은 형태).
ALTER TYPE "public"."claim_release_reason" ADD VALUE 'session_end' BEFORE 'conflict';--> statement-breakpoint
ALTER TYPE "public"."claim_release_reason" ADD VALUE 'stopped' BEFORE 'conflict';
