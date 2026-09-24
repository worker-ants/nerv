-- 누가 결정했는가를 한 열에 둔다 (2026-09-24 · 사람 결정 · database.md §2.8)
--
-- **그 사실이 경로마다 다른 열에 있었다.** `decide()` 는 `assignee_user_id` 를 COALESCE 로
-- 채우고, 게이트 면제는 그 열을 비운 채 `requested_by_user_id` 만 남기며, 지정 카드를
-- admin 이 대신 결정하면 `assignee_user_id` 는 **지정된 사람**(결정자가 아니다)으로 남는다.
-- 한 사실이 세 곳에 흩어져 있으니 "내가 결정한 것" 을 묻는 화면은 어느 쪽을 봐도 틀린다 —
-- 받은 요청의 처리됨 탭이 그렇게 **자기가 끝낸 것은 빼고 남이 낸 면제는 싣고** 있었다.
--
-- **DDL 은 drizzle-kit 이 만든 그대로고, 순서만 바꿨다**: CHECK 가 백필보다 앞에 서면
-- 이미 결정된 행이 전부 그 제약을 어겨 마이그레이션 자체가 실패한다.
ALTER TABLE "approval" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- **백필의 정답은 이미 `event` 에 있다.** `approval.decided` · `gate.bypassed` 는 둘 다
-- 주체를 `approval` 로 두고 `actor_user_id` 를 남긴다(§3.2 봉투) — 감사 로그가 여기서
-- 유일하게 정확한 출처다(지정 카드를 admin 이 결정한 경우도 옳게 답하는 것은 이것뿐이다).
-- 한 결재에 이벤트가 여럿이면 가장 최근 것을 쓴다 — 재결정은 막혀 있지만 그 사실에
-- 기대지 않는다. `event_subject` 인덱스가 그대로 탄다.
UPDATE "approval" a
   SET "decided_by_user_id" = e.actor_user_id
  FROM (
    SELECT DISTINCT ON (subject_id) subject_id, actor_user_id
      FROM "event"
     WHERE subject_type = 'approval'
       AND type IN ('approval.decided', 'gate.bypassed')
       AND actor_user_id IS NOT NULL
     ORDER BY subject_id, occurred_at DESC
  ) e
 WHERE e.subject_id = a.id AND a."decision" IS NOT NULL;--> statement-breakpoint

-- 이벤트가 남지 않은 옛 행(감사 로그보다 먼저 들어온 것 · 개발 시드)은 두 열로 떨어진다.
-- **면제가 `requested_by_user_id` 쪽이다** — 면제는 낸 사람이 곧 결정한 사람이다.
-- `requested_by_user_id` 가 NOT NULL 이라 이 UPDATE 뒤에는 NULL 이 남지 않는다.
UPDATE "approval"
   SET "decided_by_user_id" = COALESCE("assignee_user_id", "requested_by_user_id")
 WHERE "decision" IS NOT NULL AND "decided_by_user_id" IS NULL;--> statement-breakpoint

-- 처리됨 목록의 짝 — 대기 쪽 `approval_inbox` 와 같은 모양이다
CREATE INDEX "approval_decided" ON "approval" USING btree ("project_id","decided_by_user_id") WHERE "approval"."decision" IS NOT NULL;--> statement-breakpoint

-- **DB 가 붙잡는다.** 결정된 행에 결정자가 없으면 그 행은 처리됨 탭에서 사라지는데,
-- 사라진 것은 아무도 못 본다 — `approval_bypass_reason_ck` 를 세운 것과 같은 자리다.
ALTER TABLE "approval" ADD CONSTRAINT "approval_decided_by_ck" CHECK ("approval"."decision" IS NULL OR "approval"."decided_by_user_id" IS NOT NULL);
