ALTER TABLE "spec_version" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- **기존 행은 언제 바뀌었는지 알 수 없다.** DEFAULT now() 를 그대로 두면 모든 스펙이
-- "마이그레이션 시각에 바뀌었다"고 말하게 된다 — 만든 시각이 정직한 하한이다.
UPDATE "spec_version" SET "updated_at" = "created_at";
