-- 조직 초대 (2026-08-27 · 사람 결정)
--
-- **초대는 레코드다.** membership 을 바로 만들 수 없다 — 초대받은 사람이 아직 가입하지
-- 않았으면 `user` 행이 없기 때문이다. 그리고 "누가 누구를 언제 불렀나"는 감사 대상이고
-- (FR-16), 만료와 회수는 상태를 가진 것만이 가질 수 있다.
--
-- 토큰은 **해시만** 남긴다(PAT 와 같은 규율 · D-08). 대기 중 초대의 유일성은 부분
-- 인덱스로 잡는다 — 수락·회수된 것은 기록으로 남아야 하므로 지우지 않는다.
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"email" "citext" NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_user_id_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_uq" ON "invitation" USING btree ("email",coalesce("project_id", "org_id")) WHERE accepted_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "invitation_email" ON "invitation" USING btree ("email");