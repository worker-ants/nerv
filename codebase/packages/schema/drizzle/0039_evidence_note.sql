-- 증적 설명 — 이 증적이 무엇을 보여 주는가 (2026-09-28 · 사람 결정 · REQ-DB-032 · api.md REQ-API-229)
--
-- 설명을 남길 자리가 없어서, 에이전트가 커밋 SHA 뒤에 설명을 붙이면 형식 검사에 걸렸고(다른 프로젝트에서
-- 실제로 겪었다) 항목 안에 따로 칸을 두면 조용히 버려졌다. 선택 칸이고 500자까지다(EVIDENCE_NOTE_MAX).
-- 있던 증적은 비어 있다.
ALTER TABLE "evidence" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_note_len_ck" CHECK (char_length("evidence"."note") <= 500);