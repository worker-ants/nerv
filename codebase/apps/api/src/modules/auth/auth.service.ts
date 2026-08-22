// 인증 2경로 — 정본: docs/04-mvp/api.md §1.3 · agent-integration §6.1(D-08)
//
//   ① 웹 세션 : better-auth 세션 쿠키 — 브라우저 SPA (E08-S01 에서 배선)
//   ② PAT     : Authorization: Bearer — 에이전트(MCP)·CI·외부 연동·md 미러
//
// PAT 는 **(사용자, 프로젝트, 역할, 스코프) 튜플에 바인딩**되고 권한은 소유 사용자의
// 부분집합을 넘지 못한다(D-08). 에이전트는 사용자가 아니다 — 항상 사람의 위임으로 존재한다.
//
// ※ 구현 근거 하나를 남긴다. 4.1 §2.1 은 PAT 를 "better-auth api-key 플러그인 기반"이라 적었고
//   4.3 §2.2 는 `api_token` 테이블(token_hash·prefix·scopes)을 DDL 로 확정했다. 두 저장 스키마는
//   서로 다르다 — better-auth 의 apiKey 테이블을 함께 쓰면 토큰이 두 곳에 살게 된다.
//   **DDL 이 실물 정본이므로 api_token 을 쓴다.** better-auth 는 웹 세션(organization 플러그인)
//   경로에서 도입한다(E08-S01). 문서에 이 갈래의 판정을 남길 필요가 있다.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  GatePolicySchema,
  NERV_ERROR,
  RetentionSchema,
  isAgentScope,
  isHumanOnlyScope,
  newId,
} from '@nerv/schema';
import type { AgentScope } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import type pg from 'pg';
import { InjectDb, NERV_PG_POOL } from '../../common/database.module.js';
import { createBetterAuth } from './better-auth.js';
import type { NervAuth } from './better-auth.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { AuthContext } from '../../common/auth.guard.js';

/** membership.role 정본 — docs/03-proposal/data-model.md §2.1 */
export type MembershipRole = 'admin' | 'planner' | 'designer' | 'developer' | 'qa' | 'viewer';

export interface Principal {
  userId: string;
  displayName: string;
  /** PAT 로 들어온 요청인가 — 감사의 is_agent 와 이어진다(FR-16) */
  isAgent: boolean;
  /** PAT 는 항상 프로젝트 스코프다. 세션 쿠키는 프로젝트가 없다(요청 경로가 정한다) */
  projectId: string | null;
  role: MembershipRole | null;
  scopes: readonly string[];
  tokenId: string | null;
}

/** PAT 원문 형식 — `nerv_` + 32바이트 난수의 base64url (api.md §1.3) */
const TOKEN_PREFIX = 'nerv_';
const TOKEN_BYTES = 32;
/** 식별·감사용으로 남기는 앞자리 수 */
const PREFIX_CHARS = 8;

export function hashToken(raw: string): Buffer {
  return createHash('sha256').update(raw, 'utf8').digest();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** better-auth 인스턴스. 풀 주입이 없는 테스트 컨텍스트에서는 null 이다. */
  private betterAuth: NervAuth | null = null;

  constructor(
    @InjectDb() private readonly db: NervDb,
    @Inject(NERV_PG_POOL) pool?: pg.Pool,
  ) {
    if (pool !== undefined) this.betterAuth = createBetterAuth(pool);
  }

  /** better-auth 핸들러(`/api/auth/*`)를 마운트하는 컨트롤러가 쓴다. */
  get handler(): NervAuth | null {
    return this.betterAuth;
  }

  /**
   * PAT 발급. 원문은 **이 응답에서 한 번만** 나간다 — 서버는 해시만 보관한다.
   * 사람 전용 스코프는 요청에 섞여도 부여하지 않는다(불변식 — api.md §1.3).
   */
  /** EP-AUTH-01 — 프로필 + 멤버십·역할 목록. 웹 셸의 첫 질문("나는 누구이고 무엇을 볼 수 있나")의 답이다. */
  async me(userId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT id, email, display_name, avatar_url, state::text AS state, created_at
        FROM "user" WHERE id = ${userId}
    `);
    const user = rows[0];
    if (user === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '사용자를 찾을 수 없습니다.', {
        kind: 'not_found',
      });
    }
    const { rows: memberships } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT m.id, m.role::text AS role, o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
             p.id AS project_id, p.slug AS project_slug, p.name AS project_name
        FROM membership m
        JOIN organization o ON o.id = m.org_id
   LEFT JOIN project p ON p.id = m.project_id
       WHERE m.user_id = ${userId}
       ORDER BY o.slug, p.slug NULLS FIRST
    `);
    return { ...user, memberships };
  }

  /** EP-ORG-01 */
  async orgs(userId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT DISTINCT o.id, o.slug, o.name, o.created_at
        FROM organization o JOIN membership m ON m.org_id = o.id
       WHERE m.user_id = ${userId} ORDER BY o.slug
    `);
    return rows;
  }

  /** EP-ORG-02 — 조직 상세. 멤버가 아니면 존재 자체를 알려주지 않는다. */
  async org(input: { userId: string; orgSlug: string }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT o.id, o.slug, o.name, o.settings, o.created_at,
             (SELECT count(*) FROM project p WHERE p.org_id = o.id)::int AS project_count,
             (SELECT count(DISTINCT m2.user_id) FROM membership m2 WHERE m2.org_id = o.id)::int
               AS member_count
        FROM organization o
       WHERE o.slug = ${input.orgSlug}
         AND EXISTS (SELECT 1 FROM membership m WHERE m.org_id = o.id AND m.user_id = ${input.userId})
    `);
    const org = rows[0];
    if (org === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '조직을 찾을 수 없습니다.', {
        kind: 'not_found',
        org: input.orgSlug,
      });
    }
    return org;
  }

  /**
   * EP-PRJ-02 — 프로젝트 생성(admin). 만든 사람을 자동으로 admin 멤버로 넣는다 —
   * 넣지 않으면 만든 즉시 자기가 못 들어가는 프로젝트가 생긴다.
   */
  async createProject(input: {
    userId: string;
    orgSlug: string;
    slug: string;
    key: string;
    name: string;
    description?: string | null;
  }): Promise<Record<string, unknown>> {
    const { rows: orgRows } = await this.db.execute<{ id: string; role: string }>(sql`
      SELECT o.id, m.role::text AS role FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${input.userId}
       WHERE o.slug = ${input.orgSlug}
       ORDER BY (m.role = 'admin') DESC LIMIT 1
    `);
    const org = orgRows[0];
    if (org === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '조직을 찾을 수 없습니다.', {
        kind: 'not_found',
        org: input.orgSlug,
      });
    }
    this.assertAdmin(org.role as MembershipRole);
    if (input.slug.trim() === '' || input.key.trim() === '' || input.name.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, 'slug·key·name 이 필요합니다.', {
        kind: 'missing_fields',
      });
    }

    const projectId = newId();
    await this.db.execute(sql`
      INSERT INTO project (id, org_id, slug, key, name, description)
      VALUES (${projectId}, ${org.id}, ${input.slug}, ${input.key}, ${input.name},
              ${input.description ?? null})
    `);
    await this.db.execute(sql`
      INSERT INTO membership (id, org_id, project_id, user_id, role)
      VALUES (${newId()}, ${org.id}, ${projectId}, ${input.userId}, 'admin')
    `);
    return this.project(projectId);
  }

  /**
   * EP-MBR-02 — 멤버 배정. **MVP 초대는 기존 사용자 배정이다**(메일 발송은 Phase 2) —
   * 그래서 없는 이메일이면 만들지 않고 거절한다. 조용히 계정을 만들면 그 계정은
   * 비밀번호가 없어 아무도 못 쓰는 유령이 된다.
   */
  async addMember(input: {
    actorUserId: string;
    orgSlug: string;
    email: string;
    role: string;
    projectSlug?: string | null;
  }): Promise<Record<string, unknown>> {
    const { rows: orgRows } = await this.db.execute<{ id: string; role: string }>(sql`
      SELECT o.id, m.role::text AS role FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${input.actorUserId}
       WHERE o.slug = ${input.orgSlug}
       ORDER BY (m.role = 'admin') DESC LIMIT 1
    `);
    const org = orgRows[0];
    if (org === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '조직을 찾을 수 없습니다.', {
        kind: 'not_found',
      });
    }
    this.assertAdmin(org.role as MembershipRole);

    const { rows: userRows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE email = ${input.email}`,
    );
    const userId = userRows[0]?.id;
    if (userId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '가입한 사용자가 아닙니다.', {
        kind: 'user_not_found',
        email: input.email,
        hint: 'MVP 초대는 기존 사용자 배정입니다 — 먼저 가입해야 합니다.',
      });
    }

    let projectId: string | null = null;
    if (input.projectSlug != null && input.projectSlug !== '') {
      const { rows } = await this.db.execute<{ id: string }>(
        sql`SELECT id FROM project WHERE org_id = ${org.id} AND slug = ${input.projectSlug}`,
      );
      projectId = rows[0]?.id ?? null;
      if (projectId === null) {
        throw new NervError(NERV_ERROR.PRECONDITION, '프로젝트를 찾을 수 없습니다.', {
          kind: 'not_found',
          project: input.projectSlug,
        });
      }
    }

    const membershipId = newId();
    const { rows: inserted } = await this.db.execute<Record<string, unknown>>(sql`
      INSERT INTO membership (id, org_id, project_id, user_id, role)
      VALUES (${membershipId}, ${org.id}, ${projectId}, ${userId}, ${input.role}::member_role)
      ON CONFLICT DO NOTHING
      RETURNING id, role::text AS role, user_id, project_id
    `);
    if (inserted[0] === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '이미 같은 스코프의 멤버입니다.', {
        kind: 'duplicate_membership',
      });
    }
    return inserted[0];
  }

  /** EP-TOK-04 — admin 의 조직 전체 토큰 표. 여기에도 원문은 없다. */
  async orgTokensBySlug(input: {
    actorUserId: string;
    orgSlug: string;
  }): Promise<Record<string, unknown>[]> {
    const { rows: orgRows } = await this.db.execute<{ role: string }>(sql`
      SELECT m.role::text AS role FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${input.actorUserId}
       WHERE o.slug = ${input.orgSlug}
       ORDER BY (m.role = 'admin') DESC LIMIT 1
    `);
    const role = orgRows[0]?.role;
    if (role === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '조직을 찾을 수 없습니다.', {
        kind: 'not_found',
      });
    }
    return this.orgTokens({ orgSlug: input.orgSlug, actorRole: role as MembershipRole });
  }

  /**
   * 멤버십 하나의 조직 안에서 호출자가 admin 인지 — EP-MBR-03·04 의 경로에는
   * 프로젝트가 없어서(문서 경로가 `/memberships/{id}`) 여기서 되짚는다.
   */
  async assertAdminOfMembership(membershipId: string, actorUserId: string): Promise<void> {
    const { rows } = await this.db.execute<{ role: string | null }>(sql`
      SELECT actor.role::text AS role
        FROM membership target
   LEFT JOIN membership actor ON actor.org_id = target.org_id AND actor.user_id = ${actorUserId}
       WHERE target.id = ${membershipId}
       ORDER BY (actor.role = 'admin') DESC
       LIMIT 1
    `);
    if (rows[0] === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '멤버십을 찾을 수 없습니다.', {
        kind: 'not_found',
      });
    }
    this.assertAdmin((rows[0].role ?? 'viewer') as MembershipRole);
  }

  /** EP-PRJ-01 — 조직 멤버가 볼 수 있는 프로젝트. 조직 멤버십은 프로젝트 전체를 덮는다. */
  async projects(input: { userId: string; orgSlug: string }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT p.id, p.slug, p.key, p.name, p.description, p.archived_at,
             (SELECT count(*) FROM agent_session se
               WHERE se.project_id = p.id AND se.state IN ('pending','active','awaiting_input'))::int
               AS active_sessions,
             (SELECT count(*) FROM approval a
               WHERE a.project_id = p.id AND a.decision IS NULL)::int AS pending_approvals
        FROM project p
        JOIN organization o ON o.id = p.org_id
       WHERE o.slug = ${input.orgSlug}
         AND EXISTS (
           SELECT 1 FROM membership m
            WHERE m.user_id = ${input.userId} AND m.org_id = o.id
              AND (m.project_id IS NULL OR m.project_id = p.id)
         )
       ORDER BY p.slug
    `);
    return rows;
  }

  /** EP-PRJ-03 — 게이트 정책·보존·카운트 포함 */
  async project(projectId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT p.id, p.slug, p.key, p.name, p.description, p.repo_url, p.default_branch,
             p.gate_policy, p.retention, p.archived_at, o.slug AS org_slug, o.name AS org_name,
             (SELECT count(*) FROM agent_session se
               WHERE se.project_id = p.id AND se.state IN ('pending','active','awaiting_input'))::int
               AS active_sessions,
             (SELECT count(*) FROM approval a
               WHERE a.project_id = p.id AND a.decision IS NULL)::int AS pending_approvals
        FROM project p JOIN organization o ON o.id = p.org_id
       WHERE p.id = ${projectId}
    `);
    const project = rows[0];
    if (project === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '프로젝트를 찾을 수 없습니다.', {
        kind: 'not_found',
      });
    }
    return project;
  }

  /**
   * EP-PRJ-04 — **게이트 정책 편집은 admin 전용**이다(spec-workflow §1.6 매트릭스).
   * 이 검사가 API 쪽 절반이고, 나머지 절반은 화면의 비활성 버튼이다(REQ-WEB-003) —
   * 둘 중 하나만 있으면 게이트가 우회 가능해지거나, 사용자가 이유 없이 막힌다.
   */
  async updateProject(input: {
    projectId: string;
    role: MembershipRole;
    name?: string | null;
    description?: string | null;
    repoUrl?: string | null;
    defaultBranch?: string | null;
    gatePolicy?: Record<string, unknown> | null;
    retention?: Record<string, unknown> | null;
  }): Promise<Record<string, unknown>> {
    if ((input.gatePolicy != null || input.retention != null) && input.role !== 'admin') {
      throw new NervError(NERV_ERROR.FORBIDDEN, '게이트 정책·보존 설정은 admin 만 바꿉니다.', {
        kind: 'role_required',
        required: ['admin'],
        actual: input.role,
      });
    }
    // 정책 jsonb 는 저장 전에 검증한다 — 웹 폼·API·워커가 같은 스키마를 본다(REQ-CB-006).
    // 알 수 없는 키를 관대하게 받으면 오타 정책이 조용히 무시되고 게이트가 꺼진 줄 모르게 된다.
    const gatePolicy =
      input.gatePolicy == null
        ? null
        : parsePolicy(GatePolicySchema, input.gatePolicy, 'gate_policy');
    const retention =
      input.retention == null ? null : parsePolicy(RetentionSchema, input.retention, 'retention');

    await this.db.execute(sql`
      UPDATE project
         SET name = coalesce(${input.name ?? null}, name),
             description = coalesce(${input.description ?? null}, description),
             repo_url = coalesce(${input.repoUrl ?? null}, repo_url),
             default_branch = coalesce(${input.defaultBranch ?? null}, default_branch),
             gate_policy = coalesce(${gatePolicy == null ? null : JSON.stringify(gatePolicy)}::jsonb, gate_policy),
             retention = coalesce(${retention == null ? null : JSON.stringify(retention)}::jsonb, retention)
       WHERE id = ${input.projectId}
    `);
    return this.project(input.projectId);
  }

  /** EP-MBR-01 */
  async members(orgSlug: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT m.id, m.role::text AS role, m.created_at, u.id AS user_id, u.email,
             u.display_name, u.state::text AS user_state, p.slug AS project_slug
        FROM membership m
        JOIN organization o ON o.id = m.org_id
        JOIN "user" u ON u.id = m.user_id
   LEFT JOIN project p ON p.id = m.project_id
       WHERE o.slug = ${orgSlug}
       ORDER BY u.display_name, p.slug NULLS FIRST
    `);
    return rows;
  }

  /** EP-MBR-03 — 역할 변경. 6종 밖의 값은 enum 이 DB 에서 막는다. */
  async updateMembership(input: {
    membershipId: string;
    role: string;
    actorRole: MembershipRole;
  }): Promise<Record<string, unknown>> {
    this.assertAdmin(input.actorRole);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE membership SET role = ${input.role}::member_role WHERE id = ${input.membershipId}
      RETURNING id, role::text AS role, user_id
    `);
    const updated = rows[0];
    if (updated === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '멤버십을 찾을 수 없습니다.', {
        kind: 'not_found',
      });
    }
    return updated;
  }

  /** EP-MBR-04 */
  async removeMembership(input: {
    membershipId: string;
    actorRole: MembershipRole;
  }): Promise<{ ok: true }> {
    this.assertAdmin(input.actorRole);
    await this.db.execute(sql`DELETE FROM membership WHERE id = ${input.membershipId}`);
    return { ok: true };
  }

  /** EP-TOK-01 — **원문은 없다.** 발급 응답에서 한 번 보여준 뒤로는 어디에도 남지 않는다. */
  async tokens(userId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.name, t.prefix, t.scopes, t.expires_at, t.revoked_at, t.last_used_at,
             t.last_used_hostname,
             t.created_at, p.slug AS project_slug, p.name AS project_name
        FROM api_token t JOIN project p ON p.id = t.project_id
       WHERE t.user_id = ${userId}
       ORDER BY t.created_at DESC
    `);
    return rows;
  }

  /** EP-TOK-04 — admin 의 조직 전체 토큰 표(S8). 여기에도 원문은 없다. */
  async orgTokens(input: {
    orgSlug: string;
    actorRole: MembershipRole;
  }): Promise<Record<string, unknown>[]> {
    this.assertAdmin(input.actorRole);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.name, t.prefix, t.scopes, t.expires_at, t.revoked_at, t.last_used_at,
             t.last_used_hostname,
             u.display_name AS owner, p.slug AS project_slug
        FROM api_token t
        JOIN project p ON p.id = t.project_id
        JOIN organization o ON o.id = p.org_id
        JOIN "user" u ON u.id = t.user_id
       WHERE o.slug = ${input.orgSlug}
       ORDER BY t.created_at DESC
    `);
    return rows;
  }

  private assertAdmin(role: MembershipRole): void {
    if (role !== 'admin') {
      throw new NervError(NERV_ERROR.FORBIDDEN, 'admin 만 할 수 있습니다.', {
        kind: 'role_required',
        required: ['admin'],
        actual: role,
      });
    }
  }

  async issueToken(input: {
    projectId: string;
    userId: string;
    name: string;
    scopes: string[];
    expiresAt?: Date | null;
  }): Promise<{ tokenId: string; token: string; prefix: string; scopes: AgentScope[] }> {
    const humanOnly = input.scopes.filter(isHumanOnlyScope);
    if (humanOnly.length > 0) {
      throw new NervError(NERV_ERROR.FORBIDDEN, '사람 전용 스코프는 토큰에 부여할 수 없습니다.', {
        kind: 'human_only_scope',
        scopes: humanOnly,
      });
    }
    const unknown = input.scopes.filter((s) => !isAgentScope(s));
    if (unknown.length > 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, '알 수 없는 스코프입니다.', {
        kind: 'unknown_scope',
        scopes: unknown,
      });
    }
    const scopes = input.scopes.filter(isAgentScope);

    // 발급자는 그 프로젝트의 멤버여야 한다 — 권한은 소유 사용자의 부분집합을 넘지 못한다(D-08)
    await this.assertMembership(input.userId, input.projectId);

    const raw = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
    const tokenId = newId();
    const prefix = raw.slice(0, PREFIX_CHARS);

    await this.db.execute(sql`
      INSERT INTO api_token (id, project_id, user_id, name, token_hash, prefix, scopes, expires_at)
      VALUES (${tokenId}, ${input.projectId}, ${input.userId}, ${input.name},
              decode(${hashToken(raw).toString('hex')}, 'hex'), ${prefix},
              ${sql.raw(`ARRAY[${scopes.map((s) => `'${s}'`).join(',') || ''}]::text[]`)},
              ${input.expiresAt ?? null})
    `);

    return { tokenId, token: raw, prefix, scopes };
  }

  /** 폐기 — 이관 작업이 끝난 import:write 토큰을 지우는 기본 운용 경로다(EP-TOK-03). */
  async revokeToken(tokenId: string, userId: string): Promise<void> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      UPDATE api_token SET revoked_at = now()
       WHERE id = ${tokenId} AND user_id = ${userId} AND revoked_at IS NULL
      RETURNING id
    `);
    if (rows.length === 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, '폐기할 토큰이 없습니다.', {
        kind: 'not_found',
        token_id: tokenId,
      });
    }
  }

  /**
   * 자격증명 검증 → Principal. AuthGuard 가 이 메서드에 연결된다.
   * 검증 실패는 전부 NERV_UNAUTHENTICATED 다 — 만료·폐기·오타를 구분해 알려주지 않는다.
   */
  async verify(auth: AuthContext): Promise<Principal> {
    if (auth.kind === 'session') return this.verifySession(auth.credential);
    return this.verifyPat(auth.credential, auth.hostname ?? null);
  }

  /**
   * 웹 세션 검증 — better-auth 가 쿠키를 해독하고 세션 행을 확인한다(E08-S01).
   *
   * **사람의 principal 에는 스코프가 없다.** 스코프는 PAT 를 좁히기 위한 장치이고(D-08),
   * 사람의 권한은 `membership.role` 이 정한다 — 여기서 스코프를 만들어 붙이면 역할과
   * 스코프라는 두 개의 권한 축이 생기고 둘이 어긋나는 날이 온다.
   */
  async verifySession(cookieHeader: string): Promise<Principal> {
    const auth = this.betterAuth;
    if (auth === null) {
      throw new NervError(NERV_ERROR.UNAVAILABLE, '인증 서비스가 준비되지 않았습니다.', {
        kind: 'auth_unavailable',
      });
    }
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    const userId = session?.user?.id;
    if (session === null || userId === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '세션이 유효하지 않습니다.', {
        kind: 'invalid_session',
      });
    }
    return {
      userId,
      displayName: session.user.name ?? session.user.email,
      isAgent: false,
      projectId: null,
      scopes: [],
      role: null,
      tokenId: null,
    };
  }

  async verifyPat(raw: string, hostname: string | null = null): Promise<Principal> {
    if (!raw.startsWith(TOKEN_PREFIX)) {
      throw unauthenticated('토큰 형식이 아닙니다.');
    }

    const digest = hashToken(raw);
    const { rows } = await this.db.execute<{
      id: string;
      project_id: string;
      user_id: string;
      display_name: string;
      token_hash: Buffer | string;
      scopes: string[];
      expires_at: string | null;
      revoked_at: string | null;
      role: MembershipRole | null;
    }>(sql`
      SELECT t.id, t.project_id, t.user_id, u.display_name, t.token_hash, t.scopes,
             t.expires_at, t.revoked_at,
             (SELECT m.role FROM membership m
               WHERE m.user_id = t.user_id
                 AND (m.project_id = t.project_id OR m.project_id IS NULL)
               ORDER BY m.project_id NULLS LAST LIMIT 1) AS role
        FROM api_token t JOIN "user" u ON u.id = t.user_id
       WHERE t.token_hash = decode(${digest.toString('hex')}, 'hex')
    `);

    const token = rows[0];
    if (token === undefined) throw unauthenticated('알 수 없는 토큰입니다.');

    // 해시 조회로 이미 찾았지만 상수 시간 비교를 한 번 더 한다 — 저장값 손상 방어
    const stored = Buffer.isBuffer(token.token_hash)
      ? token.token_hash
      : Buffer.from(String(token.token_hash).replace(/^\\x/, ''), 'hex');
    if (stored.length !== digest.length || !timingSafeEqual(stored, digest)) {
      throw unauthenticated('토큰이 일치하지 않습니다.');
    }

    if (token.revoked_at !== null) throw unauthenticated('폐기된 토큰입니다.');
    if (token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now()) {
      throw unauthenticated('만료된 토큰입니다.');
    }
    if (token.role === null) {
      // 토큰은 살아 있는데 멤버십이 사라진 경우 — 권한은 사용자의 부분집합이므로 0이다
      throw new NervError(NERV_ERROR.FORBIDDEN, '프로젝트 멤버가 아닙니다.', {
        kind: 'no_membership',
        project_id: token.project_id,
      });
    }

    // last_used 갱신은 감사용이라 실패해도 요청을 막지 않는다.
    // 호스트는 헤더가 준 값이라 신뢰할 수 없다 — 그래서 권한 판정에 쓰지 않고 **표시만** 한다.
    // 그래도 값어치가 있다: 유출된 토큰이 모르는 이름을 남기기 시작하면 사람이 알아본다.
    void this.db
      .execute(
        sql`UPDATE api_token
               SET last_used_at = now(),
                   last_used_hostname = coalesce(${hostname}, last_used_hostname)
             WHERE id = ${token.id}`,
      )
      .catch(() => undefined);

    return {
      userId: token.user_id,
      displayName: token.display_name,
      isAgent: true,
      projectId: token.project_id,
      role: token.role,
      scopes: token.scopes ?? [],
      tokenId: token.id,
    };
  }

  /**
   * 프로젝트 멤버십 검사 — REST·WS join·SSE 가 **같은 판정을 쓴다**(D-05).
   * 표면마다 따로 구현하면 어딘가는 느슨해진다.
   */
  async assertMembership(userId: string, projectId: string): Promise<MembershipRole> {
    const { rows } = await this.db.execute<{ role: MembershipRole }>(sql`
      SELECT role FROM membership
       WHERE user_id = ${userId} AND (project_id = ${projectId} OR project_id IS NULL)
       ORDER BY project_id NULLS LAST LIMIT 1
    `);
    const role = rows[0]?.role;
    if (role === undefined) {
      throw new NervError(NERV_ERROR.FORBIDDEN, '프로젝트 멤버가 아닙니다.', {
        kind: 'no_membership',
        project_id: projectId,
      });
    }
    return role;
  }

  /** 스코프 검사 — PAT 요청은 역할 판정에 **AND 로** 추가된다(api.md §1.3). */
  assertScope(principal: Principal, required: AgentScope): void {
    if (!principal.isAgent) return; // 세션 사용자는 역할 매트릭스가 판정한다
    if (!principal.scopes.includes(required)) {
      throw new NervError(NERV_ERROR.FORBIDDEN, `스코프가 부족합니다: ${required}`, {
        kind: 'missing_scope',
        required,
        granted: principal.scopes,
      });
    }
  }

  /** 토큰이 붙은 프로젝트 밖을 건드리려 할 때 — 스코프 밖 프로젝트는 거부다. */
  assertProjectScope(principal: Principal, projectId: string): void {
    if (principal.projectId !== null && principal.projectId !== projectId) {
      throw new NervError(NERV_ERROR.FORBIDDEN, '토큰의 프로젝트 스코프 밖입니다.', {
        kind: 'project_scope',
        token_project_id: principal.projectId,
        requested_project_id: projectId,
      });
    }
  }

  /** 프로젝트 slug → id 해소. 경로 파라미터 {proj} 는 slug 다(api.md §1.2). */
  async resolveProject(slug: string): Promise<{ id: string; key: string } | null> {
    const { rows } = await this.db.execute<{ id: string; key: string }>(
      sql`SELECT id, key FROM project WHERE slug = ${slug} AND archived_at IS NULL`,
    );
    return rows[0] ?? null;
  }
}

function unauthenticated(message: string): NervError {
  // 사유는 로그에만 남기고 응답에는 싣지 않는다 — 유효한 토큰 탐색의 단서가 된다
  return new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 유효하지 않습니다.', {
    kind: 'invalid_credential',
    reason: message,
  });
}

/** 정책 파싱 실패는 400 이다 — 무엇이 틀렸는지 키 경로와 함께 돌려준다. */
function parsePolicy<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
  field: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    const issues = (parsed.error as { issues?: { path: (string | number)[]; message: string }[] })
      ?.issues;
    throw new NervError(NERV_ERROR.PRECONDITION, `${field} 형식이 올바르지 않습니다.`, {
      kind: 'invalid_policy',
      field,
      issues: (issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}
