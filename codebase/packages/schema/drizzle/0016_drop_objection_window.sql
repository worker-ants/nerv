-- T1 이의제기 창을 걷는다 (2026-09-02 사람 결정 · spec-workflow §2.4)
--
-- `GatePolicySchema` 는 `.strict()` 라 알 수 없는 키를 거부한다. 스키마에서 키를 빼면
-- **이미 저장된 정책이 400 이 된다** — 게이트 설정 화면이 열리지 않고 저장도 막힌다.
-- 그래서 스키마 변경과 같은 버전에 저장된 값을 지운다.
--
-- 창을 걷는 이유: 구현이 없었다(`appealWindowHours` 를 산출만 하고 아무도 읽지 않았다).
-- 같은 날 신규 문서가 T2 로 올라갔으므로 T1 에 남는 것은 기존 문서의 문구 수정 정도이고,
-- 거기에 되돌리기 창을 만드는 값이 낮다고 판단했다.
UPDATE "project"
   SET "gate_policy" = "gate_policy" #- '{spec_gate,t1_objection_hours}'
 WHERE "gate_policy" #> '{spec_gate,t1_objection_hours}' IS NOT NULL;
