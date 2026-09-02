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
  isAgentScope,
  isHumanOnlyScope,
  msg,
  newId,
  GatePolicySchema,
  NERV_ERROR,
  RetentionSchema,
} from '@nerv/schema';
import type { AgentScope } from '@nerv/schema';
import { scopesForRoles } from '@nerv/schema';
import type { RoleScope } from '@nerv/schema';
import { sqlArray } from '../../common/sql-array.js';
import { assertScope as assertScopeOf } from '../../common/scope-check.js';
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
  /**
   * **겸직은 합집합이다.** 하나를 고르면 planner+developer 중 하나가 사라진다.
   * 세션 주체는 비어 있다가 ProjectAccessGuard 가 채운다 — 프로젝트를 알아야 정해진다.
   */
  roles: MembershipRole[];
  /** 역할이 허용하는 스코프 ∩ (PAT 이면) 토큰 스코프 — 유효 권한 */
  scopes: string[];
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
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.user_not_found'), {
        kind: 'not_found',
      });
    }
    const { rows: memberships } = await this.db.execute<Record<string, unknown>>(sql`
      -- 겸직은 **행 여럿**이다(0003_multi_role). 스코프 단위로 묶어 역할을 배열로 준다 —
      -- 화면이 "하나 고르기"를 하면 planner+developer 중 하나가 조용히 사라진다.
      SELECT min(m.id::text) AS id, array_agg(DISTINCT m.role::text ORDER BY m.role::text) AS roles,
             o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
             p.id AS project_id, p.slug AS project_slug, p.name AS project_name
        FROM membership m
        JOIN organization o ON o.id = m.org_id
   LEFT JOIN project p ON p.id = m.project_id
       WHERE m.user_id = ${userId}
       GROUP BY o.id, o.slug, o.name, p.id, p.slug, p.name
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
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.not_found'), {
        kind: 'not_found',
        org: input.orgSlug,
      });
    }
    return org;
  }

  /**
   * EP-ORG-03 — 조직 생성. **만든 사람이 그 조직의 admin 이 된다** — 아무도 admin 이
   * 아닌 조직은 만들자마자 아무도 손댈 수 없는 껍데기다.
   */
  async createOrg(input: {
    userId: string;
    slug: string;
    name: string;
  }): Promise<Record<string, unknown>> {
    if (input.slug.trim() === '' || input.name.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.missing_fields'), {
        kind: 'missing_fields',
      });
    }
    const orgId = newId();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO organization (id, slug, name) VALUES (${orgId}, ${input.slug}, ${input.name})
      `);
      await tx.execute(sql`
        INSERT INTO membership (id, org_id, project_id, user_id, role)
        VALUES (${newId()}, ${orgId}, NULL, ${input.userId}, 'admin')
      `);
    });
    return this.org({ userId: input.userId, orgSlug: input.slug });
  }

  /** EP-ORG-04 — 조직 이름 변경(admin). **slug 는 바꾸지 않는다** — 링크의 축이다(D-09). */
  async updateOrg(input: {
    userId: string;
    orgSlug: string;
    name: string;
  }): Promise<Record<string, unknown>> {
    await this.assertOrgAdmin(input.userId, input.orgSlug);
    if (input.name.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.missing_fields'), {
        kind: 'missing_fields',
      });
    }
    await this.db.execute(
      sql`UPDATE organization SET name = ${input.name} WHERE slug = ${input.orgSlug}`,
    );
    return this.org({ userId: input.userId, orgSlug: input.orgSlug });
  }

  /**
   * EP-ORG-05 — 조직 삭제. **비어 있을 때만.**
   *
   * 프로젝트가 하나라도 남아 있으면 거부한다. 조직 아래에는 스펙·Task·리뷰·이벤트가
   * 달려 있고, 그것을 지우는 것은 감사 기록(FR-16 append-only)을 지우는 일이다 —
   * "정리"처럼 보이는 한 번의 클릭으로 일어나서는 안 된다. 프로젝트를 먼저 **보관**한
   * 뒤 지우게 하면, 되돌릴 수 없는 일 앞에 되돌릴 수 있는 단계가 하나 선다.
   */
  async deleteOrg(input: { userId: string; orgSlug: string }): Promise<{ deleted: true }> {
    const orgId = await this.assertOrgAdmin(input.userId, input.orgSlug);
    const { rows } = await this.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM project WHERE org_id = ${orgId}`,
    );
    if ((rows[0]?.n ?? 0) > 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.not_empty'), {
        kind: 'not_empty',
        projects: rows[0]?.n ?? 0,
      });
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM membership WHERE org_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM organization WHERE id = ${orgId}`);
    });
    return { deleted: true };
  }

  /**
   * EP-PRJ-05 — 프로젝트 보관·복구(admin). **지우지 않는다.**
   *
   * `archived_at` 이 이 자리에 있는 이유가 그것이다. 프로젝트에는 스펙 141편·Task
   * 484건·리뷰 1,984건이 달려 있고(clemvion 실측), 그것을 지우는 버튼은 사고를 한 번
   * 클릭으로 만든다. 보관은 목록에서 빠지되 링크는 살아 있다 — 스펙 아카이브와 같은
   * 규약이다(EP-SPEC-16·17).
   */
  async setProjectArchived(input: {
    projectId: string;
    roles: readonly MembershipRole[];
    archived: boolean;
  }): Promise<Record<string, unknown>> {
    this.assertAdmin(input.roles);
    await this.db.execute(sql`
      UPDATE project SET archived_at = ${input.archived ? sql`now()` : sql`NULL`}
       WHERE id = ${input.projectId}
    `);
    return this.project(input.projectId);
  }

  /** 조직 admin 인지 보고 조직 id 를 돌려준다 — 세 곳이 같은 판정을 쓴다. */
  private async assertOrgAdmin(userId: string, orgSlug: string): Promise<string> {
    const { rows } = await this.db.execute<{ id: string; roles: string[] }>(sql`
      SELECT o.id, array_agg(DISTINCT m.role::text) AS roles FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${userId}
       WHERE o.slug = ${orgSlug}
       GROUP BY o.id
    `);
    const org = rows[0];
    if (org === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.not_found'), {
        kind: 'not_found',
        org: orgSlug,
      });
    }
    this.assertAdmin(org.roles as MembershipRole[]);
    return org.id;
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
    const { rows: orgRows } = await this.db.execute<{ id: string; roles: string[] }>(sql`
      -- **고르지 않고 합친다.** 예전의 "admin 우선 1건" 정렬은 겸직에서 역할 하나만
      -- 남겨 planner+developer 의 절반을 잃는다(0003_multi_role).
      SELECT o.id, array_agg(DISTINCT m.role::text) AS roles FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${input.userId}
       WHERE o.slug = ${input.orgSlug}
       GROUP BY o.id
    `);
    const org = orgRows[0];
    if (org === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.not_found'), {
        kind: 'not_found',
        org: input.orgSlug,
      });
    }
    this.assertAdmin(org.roles as MembershipRole[]);
    if (input.slug.trim() === '' || input.key.trim() === '' || input.name.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.missing_fields'), {
        kind: 'missing_fields',
      });
    }

    // **이미 쓰는 slug 는 500 이 아니라 이유다.** 예전에는 유니크 제약 위반이 그대로
    // 올라와 "internal error" 로 보였고, 보관한 프로젝트와 같은 이름을 다시 만들려던
    // 사람은 무엇이 막고 있는지 알 수 없었다(사람 보고 · 실측 500). 보관된 것이 그
    // 자리를 쥐고 있으면 **그 사실을 말해야** 복구라는 길이 보인다.
    const { rows: taken } = await this.db.execute<{ slug: string; archived_at: string | null }>(sql`
      SELECT slug, archived_at::text FROM project WHERE org_id = ${org.id} AND slug = ${input.slug}
    `);
    const clash = taken[0];
    if (clash !== undefined) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        clash.archived_at === null
          ? msg('error.project.slug_taken', { slug: input.slug })
          : msg('error.project.slug_archived', { slug: input.slug }),
        { kind: clash.archived_at === null ? 'slug_taken' : 'slug_archived', slug: input.slug },
      );
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
    const { rows: orgRows } = await this.db.execute<{ id: string; roles: string[] }>(sql`
      -- **고르지 않고 합친다.** 예전의 "admin 우선 1건" 정렬은 겸직에서 역할 하나만
      -- 남겨 planner+developer 의 절반을 잃는다(0003_multi_role).
      SELECT o.id, array_agg(DISTINCT m.role::text) AS roles FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${input.actorUserId}
       WHERE o.slug = ${input.orgSlug}
       GROUP BY o.id
    `);
    const org = orgRows[0];
    if (org === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.not_found'), {
        kind: 'not_found',
      });
    }
    this.assertAdmin(org.roles as MembershipRole[]);

    const { rows: userRows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE email = ${input.email}`,
    );
    const userId = userRows[0]?.id;
    if (userId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.auth.not_registered'), {
        kind: 'user_not_found',
        email: input.email,
        // 힌트도 응답에 실린다 — 사용자가 읽는 문장이므로 키로 남기고 표면이 문장을 만든다
        hint_key: 'error.auth.not_registered_hint',
      });
    }

    let projectId: string | null = null;
    if (input.projectSlug != null && input.projectSlug !== '') {
      const { rows } = await this.db.execute<{ id: string }>(
        sql`SELECT id FROM project WHERE org_id = ${org.id} AND slug = ${input.projectSlug}`,
      );
      projectId = rows[0]?.id ?? null;
      if (projectId === null) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
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
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.membership.duplicate'), {
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
    const { rows: orgRows } = await this.db.execute<{ roles: string[] }>(sql`
      SELECT array_agg(DISTINCT m.role::text) AS roles FROM organization o
        JOIN membership m ON m.org_id = o.id AND m.user_id = ${input.actorUserId}
       WHERE o.slug = ${input.orgSlug}
       GROUP BY o.id
    `);
    const roles = orgRows[0]?.roles;
    if (roles === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.org.not_found'), {
        kind: 'not_found',
      });
    }
    return this.orgTokens({ orgSlug: input.orgSlug, actorRoles: roles as MembershipRole[] });
  }

  /**
   * 멤버십 하나의 조직 안에서 호출자가 admin 인지 — EP-MBR-03·04 의 경로에는
   * 프로젝트가 없어서(문서 경로가 `/memberships/{id}`) 여기서 되짚는다.
   */
  async assertAdminOfMembership(membershipId: string, actorUserId: string): Promise<void> {
    const { rows } = await this.db.execute<{ roles: string[] | null }>(sql`
      -- 행위자의 역할 **전부**. "admin 우선 1건" 정렬은 겸직에서 절반을 잃는다.
      SELECT array_remove(array_agg(DISTINCT actor.role::text), NULL) AS roles
        FROM membership target
   LEFT JOIN membership actor ON actor.org_id = target.org_id AND actor.user_id = ${actorUserId}
       WHERE target.id = ${membershipId}
       GROUP BY target.id
    `);
    if (rows[0] === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.membership.not_found'), {
        kind: 'not_found',
      });
    }
    // 행이 없으면 위에서 걸렸다. 여기서 빈 배열은 "대상은 있는데 행위자는 남이다"다.
    this.assertAdmin((rows[0].roles ?? []) as MembershipRole[]);
  }

  /** EP-PRJ-01 — 조직 멤버가 볼 수 있는 프로젝트. 조직 멤버십은 프로젝트 전체를 덮는다. */
  async projects(input: {
    userId: string;
    orgSlug: string;
    includeArchived?: boolean;
  }): Promise<Record<string, unknown>[]> {
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
         -- 보관한 프로젝트는 **목록에서 빠진다**(스펙 아카이브와 같은 규약).
         -- 링크는 살아 있으므로 주소를 아는 사람은 그대로 들어갈 수 있다.
         ${input.includeArchived === true ? sql`` : sql`AND p.archived_at IS NULL`}
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
               WHERE a.project_id = p.id AND a.decision IS NULL)::int AS pending_approvals,
             -- 사이드바가 **무엇이 위험한지**를 화면에 들어가기 전에 말한다(S6 배지).
             -- 세션 건수와 같은 이유의 같은 처방이다: 들어가야 아는 숫자면 그 화면을
             -- 열기 전에는 아무도 모른다.
             (SELECT count(*) FROM finding f
               WHERE f.project_id = p.id AND f.status = 'open'
                 AND f.severity = 'critical')::int AS open_critical_findings
        FROM project p JOIN organization o ON o.id = p.org_id
       WHERE p.id = ${projectId}
    `);
    const project = rows[0];
    if (project === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
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
    roles: readonly MembershipRole[];
    name?: string | null;
    description?: string | null;
    repoUrl?: string | null;
    defaultBranch?: string | null;
    gatePolicy?: Record<string, unknown> | null;
    retention?: Record<string, unknown> | null;
  }): Promise<Record<string, unknown>> {
    if ((input.gatePolicy != null || input.retention != null) && !input.roles.includes('admin')) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.admin_only_policy'), {
        kind: 'role_required',
        required: ['admin'],
        actual: input.roles,
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
    actorRoles: readonly MembershipRole[];
  }): Promise<Record<string, unknown>> {
    this.assertAdmin(input.actorRoles);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE membership SET role = ${input.role}::member_role WHERE id = ${input.membershipId}
      RETURNING id, role::text AS role, user_id
    `);
    const updated = rows[0];
    if (updated === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.membership.not_found'), {
        kind: 'not_found',
      });
    }
    return updated;
  }

  /** EP-MBR-04 */
  async removeMembership(input: {
    membershipId: string;
    actorRoles: readonly MembershipRole[];
  }): Promise<{ ok: true }> {
    this.assertAdmin(input.actorRoles);
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
    actorRoles: readonly MembershipRole[];
  }): Promise<Record<string, unknown>[]> {
    this.assertAdmin(input.actorRoles);
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

  /** 겸직이면 **하나라도** admin 이면 통과다 — 역할은 합집합이다(0003_multi_role). */
  private assertAdmin(roles: readonly MembershipRole[]): void {
    if (!roles.includes('admin')) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.admin_only'), {
        kind: 'role_required',
        required: ['admin'],
        actual: roles,
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
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.human_only_scope'), {
        kind: 'human_only_scope',
        scopes: humanOnly,
      });
    }
    const unknown = input.scopes.filter((s) => !isAgentScope(s));
    if (unknown.length > 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.auth.unknown_scope'), {
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
              ${sqlArray(scopes, 'text')},
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
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.auth.token_not_found'), {
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
      throw new NervError(NERV_ERROR.UNAVAILABLE, msg('error.auth.unavailable'), {
        kind: 'auth_unavailable',
      });
    }
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    const userId = session?.user?.id;
    if (session === null || userId === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.session_invalid'), {
        kind: 'invalid_session',
      });
    }
    return {
      userId,
      displayName: session.user.name ?? session.user.email,
      isAgent: false,
      projectId: null,
      // 세션은 요청 경로가 프로젝트를 정하므로 여기서는 비어 있다 —
      // ProjectAccessGuard 가 멤버십을 읽어 역할·스코프를 채운다.
      roles: [],
      scopes: [],
      tokenId: null,
    };
  }

  async verifyPat(raw: string, hostname: string | null = null): Promise<Principal> {
    if (!raw.startsWith(TOKEN_PREFIX)) {
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
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
      roles: MembershipRole[] | null;
    }>(sql`
      SELECT t.id, t.project_id, t.user_id, u.display_name, t.token_hash, t.scopes,
             t.expires_at, t.revoked_at,
             -- 토큰 주체의 역할 **전부**. 하나만 뽑던 자리다 — 겸직이면 절반을 잃고,
             -- 그 절반에 admin 이 있으면 조용히 권한이 사라진다(0003_multi_role).
             (SELECT array_agg(DISTINCT m.role::text) FROM membership m
               WHERE m.user_id = t.user_id
                 AND (m.project_id = t.project_id OR m.project_id IS NULL)) AS roles
        FROM api_token t JOIN "user" u ON u.id = t.user_id
       WHERE t.token_hash = decode(${digest.toString('hex')}, 'hex')
    `);

    const token = rows[0];
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
    if (token === undefined) throw unauthenticated('알 수 없는 토큰입니다.');

    // 해시 조회로 이미 찾았지만 상수 시간 비교를 한 번 더 한다 — 저장값 손상 방어
    const stored = Buffer.isBuffer(token.token_hash)
      ? token.token_hash
      : Buffer.from(String(token.token_hash).replace(/^\\x/, ''), 'hex');
    if (stored.length !== digest.length || !timingSafeEqual(stored, digest)) {
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
      throw unauthenticated('토큰이 일치하지 않습니다.');
    }

    // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
    if (token.revoked_at !== null) throw unauthenticated('폐기된 토큰입니다.');
    if (token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now()) {
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
      throw unauthenticated('만료된 토큰입니다.');
    }
    if (token.roles === null || token.roles.length === 0) {
      // 토큰은 살아 있는데 멤버십이 사라진 경우 — 권한은 사용자의 부분집합이므로 0이다
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.not_member'), {
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
      roles: token.roles ?? [],
      // **토큰이 역할보다 넓을 수 없다.** 발급 뒤 역할이 낮아졌다면 낮아진 쪽을 따른다 —
      // 토큰에 박힌 스코프만 보면 강등이 반영되지 않는다.
      scopes: (token.scopes ?? []).filter((s) => scopesForRoles(token.roles ?? []).has(s as never)),
      tokenId: token.id,
    };
  }

  /**
   * 프로젝트 멤버십 검사 — REST·WS join·SSE 가 **같은 판정을 쓴다**(D-05).
   * 표면마다 따로 구현하면 어딘가는 느슨해진다.
   */
  async assertMembership(userId: string, projectId: string): Promise<MembershipRole[]> {
    // **하나만 고르지 않는다.** 프로젝트 스코프와 조직 스코프 양쪽의 역할을 합친다 —
    // 조직 admin 이면서 프로젝트 developer 인 사람은 둘 다여야 맞다.
    //
    // **조직이 경계다**(2026-08-24 정정). `project_id IS NULL` 만 보고 `org_id` 를 보지
    // 않아, A 조직의 조직 단위 admin 이 **B 조직의 프로젝트에서도 admin** 이었다. 이
    // 판정은 REST·WS join·SSE 가 함께 쓰는 한 곳이라 여기가 새면 전부 샌다.
    const { rows } = await this.db.execute<{ role: MembershipRole }>(sql`
      SELECT DISTINCT m.role FROM membership m
        JOIN project p ON p.id = ${projectId}
       WHERE m.user_id = ${userId}
         AND m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
    `);
    const roles = rows.map((r) => r.role);
    if (roles.length === 0) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.not_member'), {
        kind: 'no_membership',
        project_id: projectId,
      });
    }
    return roles;
  }

  /** 판정 정본은 `common/scope-check.ts` 다 — 여기서는 위임만 한다(D-05). */
  assertScope(principal: Principal, required: RoleScope): void {
    assertScopeOf(principal, required);
  }

  /** 토큰이 붙은 프로젝트 밖을 건드리려 할 때 — 스코프 밖 프로젝트는 거부다. */
  assertProjectScope(principal: Principal, projectId: string): void {
    if (principal.projectId !== null && principal.projectId !== projectId) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.project_out_of_scope'), {
        kind: 'project_scope',
        token_project_id: principal.projectId,
        requested_project_id: projectId,
      });
    }
  }

  /**
   * 프로젝트 slug → id 해소. 경로 파라미터 {proj} 는 slug 다(api.md §1.2).
   *
   * **보관한 프로젝트도 해소한다**(2026-08-27 정정). 여기서 `archived_at IS NULL` 로
   * 걸렀더니 보관은 **되돌릴 수 없는 일**이 됐다 — 복구 엔드포인트(EP-PRJ-05)까지
   * 프로젝트 경로라 가드가 먼저 "없는 프로젝트"로 막았고, 주소로 열람도 되지 않았다
   * (사람 보고 · 실측 409). 보관의 뜻은 "목록에서 뺀다"이지 "없앤다"가 아니다 —
   * 스펙 아카이브와 같은 규약이다. 보관 여부는 함께 실어 보내 화면이 그 사실을 말할 수
   * 있게 한다.
   */
  async resolveProject(
    slug: string,
  ): Promise<{ id: string; key: string; archivedAt: string | null } | null> {
    const { rows } = await this.db.execute<{
      id: string;
      key: string;
      archived_at: string | null;
    }>(sql`SELECT id, key, archived_at::text FROM project WHERE slug = ${slug}`);
    const row = rows[0];
    return row === undefined ? null : { id: row.id, key: row.key, archivedAt: row.archived_at };
  }
}

/**
 * 인증 실패는 **왜 실패했는지 말하지 않는다.**
 *
 * 주석은 원래 "사유는 로그에만"이라고 적혀 있었는데 `reason` 이 응답 `details` 에 그대로
 * 실려 나갔다(실측 2026-08-23). "형식이 아니다 / 모르는 토큰이다 / 만료됐다"를 구분해
 * 주면 유효한 토큰을 찾는 쪽에 단서가 된다 — 막으려던 것이 그것이다.
 *
 * 사유는 서버 로그에만 남긴다. 운영자는 로그를 보고, 호출자는 401 만 본다.
 */
function unauthenticated(message: string): NervError {
  new Logger('Auth').debug(`인증 실패 — ${message}`);
  return new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.invalid'), {
    kind: 'invalid_credential',
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
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.request.bad_field', { field }), {
      kind: 'invalid_policy',
      field,
      issues: (issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}
