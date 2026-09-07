-- event 는 DB 가 append-only 를 지킨다 (2026-09-07 · REQ-DB-023 · D-10 · FR-16)
--
-- "모든 상태 전이가 append-only 로 남는다" 는 FR-16 의 문장인데, 그 규칙을 지키는 것이
-- **코드 규약뿐**이었다: `event` 에 INSERT 하는 경로가 하나(`EventService.emit`)라는
-- 사실에 기대고 있었다. `spec_version` 은 같은 성질을 트리거로 못 박아 두었는데
-- (0000 의 `nerv_freeze_approved_spec_version`) 감사 로그는 그렇지 않았다 — 감사에서
-- 더 중요한 쪽이 규약만으로 서 있었다는 뜻이다.
--
-- **막지 않는 것 둘을 명시한다.**
--   ① `TRUNCATE` — 스크래치 DB 를 비우는 유일한 길이다(L2 는 매 스위트가 자기 DB 를 만든다).
--   ② 파티션 `DROP` — 보존 정책이 월 파티션을 통째로 떼는 정당한 지우기다(4.3 §2.14).
-- 둘 다 "행 하나를 몰래 고치는 것" 과 성질이 다르다: 흔적이 남고, 범위가 선언적이다.
--
-- 파티션 부모의 행 트리거는 PG13+ 에서 기존·이후 파티션에 복제된다(운영·CI 는 pg17).
CREATE OR REPLACE FUNCTION nerv_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event 는 append-only 다 — % 는 허용되지 않는다 (D-10 · FR-16)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER event_append_only
  BEFORE UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION nerv_event_immutable();
