-- 표면 공용 멱등 저장소 (api.md §1.5 — REQ-API-003·004·019)
--
-- REST 의 `Idempotency-Key` 헤더와 MCP 의 `idempotency_key` 입력이 **같은 행**을 본다.
-- 아웃박스가 큐잉한 쓰기는 어느 표면으로 재전송될지 정해져 있지 않아서, 표면마다
-- 저장소가 다르면 "한 번만 실행된다" 는 약속이 표면이 바뀌는 순간 깨진다.
--
-- 유일 인덱스가 경합의 판정자다: 동시에 들어온 같은 (주체, 키) 중 하나만 INSERT 에
-- 성공하고, 진 쪽은 이긴 쪽의 응답을 재생하거나 "처리 중" 을 받는다.
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response_body" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_uq" ON "idempotency_key" USING btree ("subject","key");--> statement-breakpoint
CREATE INDEX "idempotency_key_created" ON "idempotency_key" USING btree ("created_at");