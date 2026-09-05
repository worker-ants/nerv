// 테넌시 — organization · user · project · membership · api_token
// DDL 정본: docs/04-mvp/database.md §2.2 · 필드 의미: data-model §2.1
//
// AuthModule 이 소유한다(codebase.md §2.3). project.id 는 전 도메인 테이블의 파티션 키다.

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { memberRole, userState } from '../enums.js';
import { bytea, citext, createdAt, idPk, ts } from './_columns.js';

export const organization = pgTable('organization', {
  id: idPk(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** 기본 게이트 정책·보존 기간(프로젝트가 덮어쓴다) */
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
});

/** 예약어라 항상 따옴표. **사람 계정만** 담는다 — 에이전트는 사용자가 아니다(D-08). */
export const user = pgTable('user', {
  id: idPk(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  state: userState('state').notNull().default('invited'),
  // ↓ 인증 스택(better-auth) 요구 2컬럼. 도메인 필드가 아니라 인증 인프라의 요구다 —
  //   tables/auth.ts 머리말과 같은 등급(4.3 §2.16). 도메인 코드는 이 둘을 읽지 않는다.
  emailVerified: boolean('email_verified').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const project = pgTable(
  'project',
  {
    id: idPk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    /** URL·MCP project 인자용 식별자(소문자 kebab) — 표시 접두 key 와는 별개 필드(api.md §1.2) */
    slug: text('slug').notNull(),
    /** 사람이 읽는 짧은 키. 표시 ID 접두사(예: CLV) */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    repoUrl: text('repo_url'),
    defaultBranch: text('default_branch'),
    /** 위험도별 게이트 임계(D-06), fail-open 격상 임계(D-14). 키 스키마는 api.md §2.1a */
    gatePolicy: jsonb('gate_policy').notNull().default({}),
    /** Activity·프롬프트 보존 기간(data-model §5.4) */
    retention: jsonb('retention').notNull().default({}),
    /** 삭제는 아카이브가 원칙이다(§1.3) */
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('project_org_key_uq').on(t.orgId, t.key),
    uniqueIndex('project_org_slug_uq').on(t.orgId, t.slug),
  ],
);

export const membership = pgTable(
  'membership',
  {
    id: idPk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    /** NULL = 조직 전역 역할 */
    projectId: uuid('project_id').references(() => project.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: memberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // 중복 배정 차단 — 표현식 unique(§2.12). project 권한이 없으면 org 권한으로 접힌다.
    //
    // **유일성의 축에 역할이 들어간다**(0003_multi_role). 겸직이 흔한 형태라 한 사람이 한
    // 소속에서 역할을 여럿 가진다 — 축에서 역할을 빼면 그 겸직이 제약으로 막힌다.
    //
    // 이 선언이 0003 이후로 **실물과 어긋나 있었다**(2026-08-27 정정). 마이그레이션은 raw
    // SQL 로 축을 바꿨는데 테이블 선언과 스냅샷 5개가 옛 축에 머물러, 선언상으로는 "한
    // 권한에 역할 하나"였다. 지금 당장은 `db:generate` 가 무변경이라 조용했지만, 이
    // 표를 누가 건드리는 순간 생성된 마이그레이션이 겸직을 도로 막았을 것이다.
    uniqueIndex('membership_user_scope_role_uq').on(
      t.userId,
      sql`coalesce(${t.projectId}, ${t.orgId})`,
      t.role,
    ),
  ],
);

/**
 * PAT — (사용자, 프로젝트, 역할, 소속) 튜플 바인딩. 권한은 소유 사용자의 부분집합을 넘지 못한다(D-08).
 * 원문은 저장하지 않는다 — 해시만 두고 앞 8자만 식별·감사용으로 남긴다(api.md §1.3).
 */
export const apiToken = pgTable(
  'api_token',
  {
    id: idPk(),
    /** 토큰은 항상 프로젝트 소속다 */
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    /** 위임자 */
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    /** 예: "노트북 Claude Code" */
    name: text('name').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    /** 'spec:read' 'spec:draft' 'task:claim' 'import:write' … (api.md §1.3) */
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
    /**
     * 이 토큰을 마지막으로 쓴 머신(`X-NERV-Host`). **유출 판단의 첫 단서**다(NFR-03) —
     * "내 토큰이 모르는 호스트에서 쓰이고 있다"를 S8 목록에서 바로 보게 한다(REQ-WEB-026).
     * 헤더가 없으면 NULL 이고, 그 자체가 "호스트를 밝히지 않은 호출"이라는 정보다.
     */
    lastUsedHostname: text('last_used_hostname'),
    createdAt: createdAt(),
  },
  (t) => [index('api_token_project_user').on(t.projectId, t.userId)],
);
