CREATE TYPE "public"."activity_type" AS ENUM('thought', 'action', 'elicitation', 'response', 'error');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('claude-code', 'codex', 'web', 'other');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approve', 'reject', 'comment');--> statement-breakpoint
CREATE TYPE "public"."approval_subject_type" AS ENUM('spec_version', 'change_request', 'plan', 'question', 'gate_bypass');--> statement-breakpoint
CREATE TYPE "public"."change_kind" AS ENUM('added', 'modified', 'removed', 'unchanged');--> statement-breakpoint
CREATE TYPE "public"."change_origin" AS ENUM('human', 'agent', 'spec_drift');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('open', 'in_review', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."change_risk" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."claim_release_reason" AS ENUM('done', 'manual', 'expired', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('active', 'released', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."comment_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."dependency_kind" AS ENUM('blocks', 'relates');--> statement-breakpoint
CREATE TYPE "public"."escalate_reason" AS ENUM('no', 'spec', 'user-decision', 'infra', 'e2e-fail-3x', 'sensitive-fix');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('code_path', 'test', 'pr', 'commit', 'review', 'user_guide');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('agent', 'human', 'ci');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'fixed', 'dismissed', 'wont_fix');--> statement-breakpoint
CREATE TYPE "public"."impl_status" AS ENUM('unimplemented', 'in_progress', 'implemented', 'verified');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'planner', 'designer', 'developer', 'qa', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('inapp', 'slack', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_importance" AS ENUM('immediate', 'digest');--> statement-breakpoint
CREATE TYPE "public"."notification_state" AS ENUM('unread', 'read', 'archived');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('open', 'answered', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."question_urgency" AS ENUM('blocking', 'normal');--> statement-breakpoint
CREATE TYPE "public"."requirement_priority" AS ENUM('must', 'should', 'could');--> statement-breakpoint
CREATE TYPE "public"."resolution_kind" AS ENUM('fixed', 'deferred', 'dismissed', 'escalated', 'spec_change');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('code', 'consistency', 'spec_coverage', 'merge');--> statement-breakpoint
CREATE TYPE "public"."review_risk" AS ENUM('none', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_trigger" AS ENUM('auto', 'manual', 'gate');--> statement-breakpoint
CREATE TYPE "public"."session_end_reason" AS ENUM('complete', 'error', 'stopped', 'stale');--> statement-breakpoint
CREATE TYPE "public"."session_state" AS ENUM('pending', 'active', 'awaiting_input', 'complete', 'error', 'stale');--> statement-breakpoint
CREATE TYPE "public"."spec_relation_kind" AS ENUM('references', 'refines', 'depends_on', 'duplicates', 'supersedes');--> statement-breakpoint
CREATE TYPE "public"."spec_type" AS ENUM('vision', 'area', 'feature', 'design', 'convention', 'adr');--> statement-breakpoint
CREATE TYPE "public"."spec_version_status" AS ENUM('draft', 'in_review', 'approved', 'superseded', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('P0', 'P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'ready', 'claimed', 'in_progress', 'in_review', 'done', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."user_state" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"repo_url" text,
	"default_branch" text,
	"gate_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"state" "user_state" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"type" "activity_type" NOT NULL,
	"title" text,
	"body_md" text,
	"tool_name" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_pkey" PRIMARY KEY("id","created_at")
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_type" "agent_type" NOT NULL,
	"agent_version" text,
	"hostname" text NOT NULL,
	"cwd" text,
	"worktree_path" text,
	"branch" text,
	"external_session_id" text,
	"state" "session_state" DEFAULT 'pending' NOT NULL,
	"model" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" "session_end_reason",
	"diff_added" integer DEFAULT 0 NOT NULL,
	"diff_removed" integer DEFAULT 0 NOT NULL,
	"token_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"base_version_id" uuid NOT NULL,
	"proposed_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"rationale_md" text,
	"status" "change_request_status" DEFAULT 'open' NOT NULL,
	"risk" "change_risk" DEFAULT 'normal' NOT NULL,
	"origin" "change_origin" DEFAULT 'human' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_session_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"statement_md" text NOT NULL,
	"acceptance_md" text,
	"priority" "requirement_priority" NOT NULL,
	"impl_status" "impl_status" DEFAULT 'unimplemented' NOT NULL,
	"introduced_in_version_id" uuid NOT NULL,
	"current_version_id" uuid NOT NULL,
	"removed_in_version_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_version" (
	"requirement_id" uuid NOT NULL,
	"spec_version_id" uuid NOT NULL,
	"change_kind" "change_kind" NOT NULL,
	"statement_md" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_version_pkey" PRIMARY KEY("requirement_id","spec_version_id")
);
--> statement-breakpoint
CREATE TABLE "spec" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"type" "spec_type" NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"sort_key" text DEFAULT '' NOT NULL,
	"current_version_id" uuid,
	"owner_role" "member_role",
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_baseline" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note_md" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_baseline_item" (
	"baseline_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"spec_version_id" uuid NOT NULL,
	CONSTRAINT "spec_baseline_item_pkey" PRIMARY KEY("baseline_id","spec_id")
);
--> statement-breakpoint
CREATE TABLE "spec_comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"spec_version_id" uuid NOT NULL,
	"anchor" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_session_id" uuid,
	"body_md" text NOT NULL,
	"status" "comment_status" DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_in_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spec_relation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"from_spec_id" uuid NOT NULL,
	"to_spec_id" uuid NOT NULL,
	"kind" "spec_relation_kind" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spec_relation_self_ck" CHECK ("spec_relation"."from_spec_id" <> "spec_relation"."to_spec_id")
);
--> statement-breakpoint
CREATE TABLE "spec_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"spec_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "spec_version_status" DEFAULT 'draft' NOT NULL,
	"body_md" text NOT NULL,
	"content_hash" "bytea" NOT NULL,
	"base_version_id" uuid,
	"change_summary_md" text,
	"author_user_id" uuid NOT NULL,
	"author_session_id" uuid,
	"change_request_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"superseded_by_version_id" uuid,
	"edit_lease_user_id" uuid,
	"edit_lease_session_id" uuid,
	"edit_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spec_version_no_positive_ck" CHECK ("spec_version"."version_no" >= 1),
	CONSTRAINT "spec_version_lease_draft_only_ck" CHECK ("spec_version"."status" = 'draft' OR ("spec_version"."edit_lease_user_id" IS NULL AND "spec_version"."edit_lease_session_id" IS NULL AND "spec_version"."edit_lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_session_id" uuid,
	"user_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'active' NOT NULL,
	"scope_spec_ids" uuid[] DEFAULT '{}' NOT NULL,
	"scope_file_globs" text[] DEFAULT '{}' NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" "claim_release_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid,
	"spec_version_id" uuid,
	"task_id" uuid,
	"kind" "evidence_kind" NOT NULL,
	"locator" text NOT NULL,
	"repo" text,
	"source" "evidence_source" NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_anchor_ck" CHECK ("evidence"."requirement_id" IS NOT NULL OR "evidence"."spec_version_id" IS NOT NULL OR "evidence"."task_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"priority" "task_priority" DEFAULT 'P2' NOT NULL,
	"source_spec_version_id" uuid,
	"source_requirement_id" uuid,
	"baseline_id" uuid,
	"rebrief_required_at" timestamp with time zone,
	"assignee_user_id" uuid,
	"delegate_session_id" uuid,
	"goal_md" text,
	"output_format_md" text,
	"tools_sources_md" text,
	"boundaries_md" text,
	"spec_impact" jsonb,
	"blocked_reason" text,
	"done_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_delegation_spec_ck" CHECK ("task"."status" IN ('backlog', 'blocked') OR ("task"."goal_md" IS NOT NULL AND "task"."output_format_md" IS NOT NULL AND "task"."tools_sources_md" IS NOT NULL AND "task"."boundaries_md" IS NOT NULL)),
	CONSTRAINT "task_done_spec_impact_ck" CHECK ("task"."status" <> 'done' OR "task"."spec_impact" IS NOT NULL),
	CONSTRAINT "task_done_at_ck" CHECK ("task"."status" <> 'done' OR "task"."done_at" IS NOT NULL),
	CONSTRAINT "task_blocked_reason_ck" CHECK ("task"."status" <> 'blocked' OR "task"."blocked_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"kind" "dependency_kind" DEFAULT 'blocks' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependency_pkey" PRIMARY KEY("task_id","depends_on_task_id"),
	CONSTRAINT "task_dependency_self_ck" CHECK ("task_dependency"."task_id" <> "task_dependency"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"detail_md" text,
	"suggestion_md" text,
	"file_path" text,
	"line_start" integer,
	"symbol" text,
	"spec_version_id" uuid,
	"requirement_id" uuid,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"first_session_id" uuid NOT NULL,
	"last_session_id" uuid NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_occurrence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"finding_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"reviewer_report_id" uuid,
	"round_no" integer NOT NULL,
	"display_no" integer NOT NULL,
	"raw_severity" "finding_severity" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"finding_id" uuid NOT NULL,
	"kind" "resolution_kind" NOT NULL,
	"commit_sha" text,
	"change_request_id" uuid,
	"escalate_reason" "escalate_reason",
	"rationale_md" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolution_fixed_commit_ck" CHECK ("resolution"."kind" <> 'fixed' OR "resolution"."commit_sha" IS NOT NULL),
	CONSTRAINT "resolution_spec_change_cr_ck" CHECK ("resolution"."kind" <> 'spec_change' OR "resolution"."change_request_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "review_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "review_kind" NOT NULL,
	"trigger" "review_trigger" NOT NULL,
	"agent_session_id" uuid,
	"task_id" uuid,
	"branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"changeset_hash" "bytea" NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"round_no" integer DEFAULT 1 NOT NULL,
	"previous_session_id" uuid,
	"routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"forced_roles" text[] DEFAULT '{}' NOT NULL,
	"forced_coverage_ok" boolean DEFAULT false NOT NULL,
	"state" "review_state" DEFAULT 'running' NOT NULL,
	"risk" "review_risk",
	"block" boolean DEFAULT false NOT NULL,
	"prompt_blob_uri" text,
	"prompt_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"risk" "review_risk" NOT NULL,
	"body_md" text,
	"has_report" boolean DEFAULT true NOT NULL,
	"forced" boolean DEFAULT false NOT NULL,
	"recovered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_type" "approval_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_by_session_id" uuid,
	"assignee_user_id" uuid,
	"assignee_role" "member_role",
	"decision" "approval_decision",
	"comment_md" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"is_bypass" boolean DEFAULT false NOT NULL,
	"bypass_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_bypass_reason_ck" CHECK (NOT "approval"."is_bypass" OR "approval"."bypass_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_session_id" uuid NOT NULL,
	"task_id" uuid,
	"title" text NOT NULL,
	"body_md" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"urgency" "question_urgency" DEFAULT 'normal' NOT NULL,
	"status" "question_status" DEFAULT 'open' NOT NULL,
	"answer_key" text,
	"answer_md" text,
	"answered_by_user_id" uuid,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_session_id" uuid,
	"is_agent" boolean DEFAULT false NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	CONSTRAINT "event_pkey" PRIMARY KEY("id","occurred_at")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"importance" "notification_importance" NOT NULL,
	"channel" "notification_channel" DEFAULT 'inapp' NOT NULL,
	"state" "notification_state" DEFAULT 'unread' NOT NULL,
	"digest_batch_id" uuid,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_base_version_id_spec_version_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_proposed_version_id_spec_version_id_fk" FOREIGN KEY ("proposed_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_created_by_session_id_agent_session_id_fk" FOREIGN KEY ("created_by_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_introduced_in_version_id_spec_version_id_fk" FOREIGN KEY ("introduced_in_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_current_version_id_spec_version_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_removed_in_version_id_spec_version_id_fk" FOREIGN KEY ("removed_in_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_version" ADD CONSTRAINT "requirement_version_requirement_id_requirement_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_version" ADD CONSTRAINT "requirement_version_spec_version_id_spec_version_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec" ADD CONSTRAINT "spec_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_baseline" ADD CONSTRAINT "spec_baseline_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_baseline" ADD CONSTRAINT "spec_baseline_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_baseline_item" ADD CONSTRAINT "spec_baseline_item_baseline_id_spec_baseline_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."spec_baseline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_baseline_item" ADD CONSTRAINT "spec_baseline_item_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_baseline_item" ADD CONSTRAINT "spec_baseline_item_spec_version_id_spec_version_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_spec_version_id_spec_version_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_author_session_id_agent_session_id_fk" FOREIGN KEY ("author_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_comment" ADD CONSTRAINT "spec_comment_resolved_in_version_id_spec_version_id_fk" FOREIGN KEY ("resolved_in_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_relation" ADD CONSTRAINT "spec_relation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_relation" ADD CONSTRAINT "spec_relation_from_spec_id_spec_id_fk" FOREIGN KEY ("from_spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_relation" ADD CONSTRAINT "spec_relation_to_spec_id_spec_id_fk" FOREIGN KEY ("to_spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_spec_id_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."spec"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_author_session_id_agent_session_id_fk" FOREIGN KEY ("author_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_edit_lease_user_id_user_id_fk" FOREIGN KEY ("edit_lease_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_version" ADD CONSTRAINT "spec_version_edit_lease_session_id_agent_session_id_fk" FOREIGN KEY ("edit_lease_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_agent_session_id_agent_session_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_requirement_id_requirement_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_spec_version_id_spec_version_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_spec_version_id_spec_version_id_fk" FOREIGN KEY ("source_spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_requirement_id_requirement_id_fk" FOREIGN KEY ("source_requirement_id") REFERENCES "public"."requirement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_baseline_id_spec_baseline_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."spec_baseline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_delegate_session_id_agent_session_id_fk" FOREIGN KEY ("delegate_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_depends_on_task_id_task_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_spec_version_id_spec_version_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_requirement_id_requirement_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_first_session_id_review_session_id_fk" FOREIGN KEY ("first_session_id") REFERENCES "public"."review_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_last_session_id_review_session_id_fk" FOREIGN KEY ("last_session_id") REFERENCES "public"."review_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_occurrence" ADD CONSTRAINT "finding_occurrence_finding_id_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."finding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_occurrence" ADD CONSTRAINT "finding_occurrence_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_occurrence" ADD CONSTRAINT "finding_occurrence_reviewer_report_id_reviewer_report_id_fk" FOREIGN KEY ("reviewer_report_id") REFERENCES "public"."reviewer_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_finding_id_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."finding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_change_request_id_change_request_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_actor_session_id_agent_session_id_fk" FOREIGN KEY ("actor_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_agent_session_id_agent_session_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_report" ADD CONSTRAINT "reviewer_report_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_requested_by_session_id_agent_session_id_fk" FOREIGN KEY ("requested_by_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_agent_session_id_agent_session_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_answered_by_user_id_user_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_actor_session_id_agent_session_id_fk" FOREIGN KEY ("actor_session_id") REFERENCES "public"."agent_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_project_user" ON "api_token" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_user_scope_uq" ON "membership" USING btree ("user_id",coalesce("project_id", "org_id"));--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_key_uq" ON "project" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_uq" ON "project" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "activity_session_time" ON "activity" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_project_time" ON "activity" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_session_board" ON "agent_session" USING btree ("project_id","state","last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_external_uq" ON "agent_session" USING btree ("project_id","external_session_id") WHERE "agent_session"."external_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_ref_uq" ON "requirement" USING btree ("project_id","ref");--> statement-breakpoint
CREATE INDEX "requirement_spec_impl" ON "requirement" USING btree ("spec_id","impl_status");--> statement-breakpoint
CREATE INDEX "requirement_statement_trgm" ON "requirement" USING gin ("statement_md" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "spec_tree" ON "spec" USING btree ("project_id","parent_id","sort_key");--> statement-breakpoint
CREATE INDEX "spec_title_fts" ON "spec" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE INDEX "spec_title_trgm" ON "spec" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "spec_baseline_name_uq" ON "spec_baseline" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "spec_comment_open" ON "spec_comment" USING btree ("spec_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_relation_uq" ON "spec_relation" USING btree ("from_spec_id","to_spec_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_version_no_uq" ON "spec_version" USING btree ("spec_id","version_no");--> statement-breakpoint
CREATE INDEX "spec_version_spec_status" ON "spec_version" USING btree ("spec_id","status");--> statement-breakpoint
CREATE INDEX "spec_version_body_fts" ON "spec_version" USING gin (to_tsvector('simple', "body_md"));--> statement-breakpoint
CREATE INDEX "spec_version_body_trgm" ON "spec_version" USING gin ("body_md" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "claim_task_active_uq" ON "claim" USING btree ("task_id") WHERE "claim"."status" = 'active';--> statement-breakpoint
CREATE INDEX "claim_scope_specs_gin" ON "claim" USING gin ("scope_spec_ids");--> statement-breakpoint
CREATE INDEX "claim_scope_globs_gin" ON "claim" USING gin ("scope_file_globs");--> statement-breakpoint
CREATE INDEX "claim_project_active" ON "claim" USING btree ("project_id") WHERE "claim"."status" = 'active';--> statement-breakpoint
CREATE INDEX "evidence_requirement" ON "evidence" USING btree ("requirement_id") WHERE NOT "evidence"."stale";--> statement-breakpoint
CREATE UNIQUE INDEX "task_key_uq" ON "task" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "task_ready_queue" ON "task" USING btree ("project_id","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_fingerprint_uq" ON "finding" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "finding_queue" ON "finding" USING btree ("project_id","status","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_occurrence_uq" ON "finding_occurrence" USING btree ("finding_id","review_session_id");--> statement-breakpoint
CREATE INDEX "review_session_gate" ON "review_session" USING btree ("project_id","head_sha");--> statement-breakpoint
CREATE INDEX "review_session_round" ON "review_session" USING btree ("changeset_hash","round_no");--> statement-breakpoint
CREATE UNIQUE INDEX "reviewer_report_role_uq" ON "reviewer_report" USING btree ("review_session_id","role");--> statement-breakpoint
CREATE INDEX "approval_inbox" ON "approval" USING btree ("project_id","assignee_user_id") WHERE "approval"."decision" IS NULL;--> statement-breakpoint
CREATE INDEX "question_open" ON "question" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "event_project_time" ON "event" USING btree ("project_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_subject" ON "event" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "notification_inbox" ON "notification" USING btree ("user_id","state","created_at" DESC NULLS LAST);