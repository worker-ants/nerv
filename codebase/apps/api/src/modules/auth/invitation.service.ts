// 조직 초대 — 판정은 여기 한 곳에 있다 (api.md §2.1b · 사람 결정 2026-08-27)
//
// **기존 사용자와 신규 사용자를 분기하지 않는다.** 초대하는 쪽은 상대가 이미 계정을
// 가졌는지 모르고, 알 필요도 없다 — 링크 하나가 둘 다 처리한다. 계정이 있으면 로그인해
// 수락하고, 없으면 가입한 뒤 같은 자리로 돌아온다.
//
// 두 자물쇠가 걸려 있다.
//   ① **초대한 이메일로만** 수락된다(사람 결정) — 링크는 메신저를 타고 흐르고, 새면
//      아무나 들어온다. 토큰만으로 받아 주면 그 링크가 곧 조직의 열쇠가 된다.
//   ② **7일**이면 만료된다(`INVITATION_TTL_DAYS`) — 되찾는 길(재발급)이 있으므로 짧게.

import { Inject, Injectable } from '@nestjs/common';
import { INVITATION_TTL_DAYS, memberRole, msg, NERV_ERROR, newId } from '@nerv/schema';
import type { MembershipRole } from './auth.service.js';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertVocab } from '../../common/query-vocab.js';
import { AuthService, hashToken } from './auth.service.js';

/** 링크에 실리는 값 — 주소에 그대로 들어가므로 url-safe 여야 한다 */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface InvitationRow extends Record<string, unknown> {
  id: string;
  email: string;
  role: string;
  org_slug: string;
  org_name: string;
  project_slug: string | null;
  expires_at: string;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
}

@Injectable()
export class InvitationService {
  constructor(
    @InjectDb() private readonly db: NervDb,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /**
   * EP-INV-01 — 초대를 만든다(admin). **토큰 원문은 이 응답에서 한 번만** 나간다.
   *
   * 이미 멤버인 사람은 초대하지 않는다 — 초대를 수락해도 아무 일이 일어나지 않는 링크를
   * 쥐여 주는 것은 안내가 아니라 혼란이다.
   */
  async create(input: {
    actorUserId: string;
    orgSlug: string;
    email: string;
    role: MembershipRole;
    projectSlug?: string | null;
  }): Promise<Record<string, unknown>> {
    // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-106·112)
    const role = assertVocab([input.role], memberRole.enumValues, 'role')[0];
    const org = await this.assertOrgAdmin(input.actorUserId, input.orgSlug);
    const email = input.email.trim();
    if (email === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.invite.missing_fields'), {
        kind: 'missing_fields',
      });
    }

    const projectId = await this.resolveProjectId(org.id, input.projectSlug ?? null);

    const { rows: already } = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM membership m
        JOIN "user" u ON u.id = m.user_id
       WHERE u.email = ${email} AND m.org_id = ${org.id}
         AND (${projectId}::uuid IS NULL OR m.project_id = ${projectId} OR m.project_id IS NULL)
         AND m.role = ${role}::member_role
    `);
    if ((already[0]?.n ?? 0) > 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.invite.already_member', { email }), {
        kind: 'already_member',
        email,
      });
    }

    // 대기 중 초대는 스코프당 하나다(부분 unique). 다시 부르면 **덮어쓴다** — 오타를
    // 고치거나 만료된 것을 되살리는 것이 실제 사용이고, 그때 "이미 있다"는 막다른 길이다.
    await this.db.execute(sql`
      UPDATE invitation SET revoked_at = now()
       WHERE org_id = ${org.id} AND email = ${email}
         AND coalesce(project_id, org_id) = coalesce(${projectId}::uuid, ${org.id}::uuid)
         AND accepted_at IS NULL AND revoked_at IS NULL
    `);

    const token = newToken();
    const id = newId();
    await this.db.execute(sql`
      INSERT INTO invitation
        (id, org_id, project_id, email, role, token_hash, invited_by_user_id, expires_at)
      VALUES (${id}, ${org.id}, ${projectId}, ${email}, ${role}::member_role,
              ${hashToken(token)}, ${input.actorUserId},
              now() + ${`${INVITATION_TTL_DAYS} days`}::interval)
    `);
    return { id, email, role: input.role, token, expires_in_days: INVITATION_TTL_DAYS };
  }

  /** EP-INV-02 — 조직의 초대 목록(admin). 수락·회수된 것도 기록으로 보인다 */
  async list(input: { actorUserId: string; orgSlug: string }): Promise<InvitationRow[]> {
    await this.assertOrgAdmin(input.actorUserId, input.orgSlug);
    const { rows } = await this.db.execute<InvitationRow>(sql`
      ${this.selectInvitation()}
       WHERE o.slug = ${input.orgSlug}
       ORDER BY i.created_at DESC
       LIMIT 100
    `);
    return rows;
  }

  /** EP-INV-03 — 회수(admin). **지우지 않는다** — 누가 누구를 불렀는지가 기록이다 */
  async revoke(input: { actorUserId: string; invitationId: string }): Promise<{ ok: true }> {
    const { rows } = await this.db.execute<{ org_slug: string }>(sql`
      SELECT o.slug AS org_slug FROM invitation i
        JOIN organization o ON o.id = i.org_id
       WHERE i.id = ${input.invitationId}
    `);
    const orgSlug = rows[0]?.org_slug;
    if (orgSlug === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.invite.not_found'), {
        kind: 'not_found',
      });
    }
    await this.assertOrgAdmin(input.actorUserId, orgSlug);
    await this.db.execute(sql`
      UPDATE invitation SET revoked_at = now()
       WHERE id = ${input.invitationId} AND accepted_at IS NULL AND revoked_at IS NULL
    `);
    return { ok: true };
  }

  /**
   * EP-INV-04 — 링크 미리보기(**공개**).
   *
   * 로그인 전에도 "어느 조직이 무슨 역할로 부르는가"는 보여야 한다 — 모르는 것에
   * 가입부터 하라고 요구할 수는 없다. 다만 **이메일은 가린다**: 토큰을 주운 사람에게
   * 초대받은 사람이 누구인지 알려 줄 이유가 없다.
   */
  async preview(token: string): Promise<Record<string, unknown>> {
    const invite = await this.findByToken(token);
    return {
      org_name: invite.org_name,
      org_slug: invite.org_slug,
      project_slug: invite.project_slug,
      role: invite.role,
      email_hint: maskEmail(invite.email),
      state: invite.state,
    };
  }

  /**
   * EP-INV-05 — 수락. **초대한 이메일과 같은 계정만** 받는다(사람 결정 2026-08-27).
   *
   * 이미 그 역할을 가지고 있어도 초대는 수락 처리한다 — 사람 쪽에서는 "참여했다"가
   * 사실이고, 링크가 영원히 대기로 남는 편이 더 이상하다.
   */
  async accept(input: {
    token?: string;
    invitationId?: string;
    userId: string;
  }): Promise<Record<string, unknown>> {
    // **두 입구, 한 판정.** 링크로 온 사람은 토큰을 들고 오고, 앱 안의 카드에서 누른
    // 사람은 id 를 들고 온다 — 토큰은 해시만 저장하므로 카드가 그것을 알 길이 없다.
    // 어느 쪽이든 이메일 대조는 **똑같이** 거친다: 그것이 이 기능의 안전선이다.
    const invite =
      input.token === undefined
        ? await this.findById(input.invitationId ?? '')
        : await this.findByToken(input.token);
    if (invite.state !== 'pending') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg(`error.invite.${invite.state}` as never), {
        kind: invite.state,
      });
    }

    const { rows: userRows } = await this.db.execute<{ email: string }>(
      sql`SELECT email FROM "user" WHERE id = ${input.userId}`,
    );
    const email = userRows[0]?.email ?? '';
    if (email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.invite.email_mismatch'), {
        kind: 'email_mismatch',
        expected: maskEmail(invite.email),
      });
    }

    await this.db.transaction(async (tx: NervDb) => {
      await tx.execute(sql`
        INSERT INTO membership (id, org_id, project_id, user_id, role)
        SELECT ${newId()}, i.org_id, i.project_id, ${input.userId}, i.role
          FROM invitation i WHERE i.id = ${invite.id}
        ON CONFLICT DO NOTHING
      `);
      await tx.execute(sql`
        UPDATE invitation SET accepted_at = now(), accepted_user_id = ${input.userId}
         WHERE id = ${invite.id}
      `);
    });

    return { org_slug: invite.org_slug, project_slug: invite.project_slug, role: invite.role };
  }

  /**
   * EP-INV-06 — **내게 온 초대**(인증). 화면 셋(홈·온보딩·알림)이 같은 값을 쓴다.
   *
   * 알림 테이블에 싣지 않는 이유가 있다: `notification.project_id` 는 NOT NULL 인데
   * 조직 초대에는 프로젝트가 없고, 무엇보다 **초대받은 사람은 아직 아무 프로젝트의
   * 멤버가 아니다** — 프로젝트 스코프 알림 목록은 그에게 언제나 비어 있다.
   */
  async mine(userId: string): Promise<InvitationRow[]> {
    const { rows } = await this.db.execute<InvitationRow>(sql`
      ${this.selectInvitation()}
        JOIN "user" me ON me.email = i.email
       WHERE me.id = ${userId}
         AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       ORDER BY i.created_at DESC
    `);
    return rows;
  }

  // ── 안쪽 ────────────────────────────────────────────────────────────────

  private selectInvitation() {
    return sql`
      SELECT i.id, i.email, i.role::text AS role, i.expires_at::text AS expires_at,
             i.created_at::text AS created_at,
             o.slug AS org_slug, o.name AS org_name,
             p.slug AS project_slug,
             u.display_name AS invited_by,
             CASE
               WHEN i.revoked_at IS NOT NULL THEN 'revoked'
               WHEN i.accepted_at IS NOT NULL THEN 'accepted'
               WHEN i.expires_at <= now() THEN 'expired'
               ELSE 'pending'
             END AS state
        FROM invitation i
        JOIN organization o ON o.id = i.org_id
        JOIN "user" u ON u.id = i.invited_by_user_id
   LEFT JOIN project p ON p.id = i.project_id`;
  }

  private async findById(id: string): Promise<InvitationRow> {
    const { rows } = await this.db.execute<InvitationRow>(sql`
      ${this.selectInvitation()}
       WHERE i.id = ${id}
    `);
    const invite = rows[0];
    if (invite === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.invite.not_found'), {
        kind: 'not_found',
      });
    }
    return invite;
  }

  private async findByToken(token: string): Promise<InvitationRow> {
    const { rows } = await this.db.execute<InvitationRow>(sql`
      ${this.selectInvitation()}
       WHERE i.token_hash = ${hashToken(token)}
    `);
    const invite = rows[0];
    if (invite === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.invite.not_found'), {
        kind: 'not_found',
      });
    }
    return invite;
  }

  private async assertOrgAdmin(userId: string, orgSlug: string): Promise<{ id: string }> {
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
      });
    }
    if (!org.roles.includes('admin')) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.admin_only'), { kind: 'admin' });
    }
    return { id: org.id };
  }

  private async resolveProjectId(orgId: string, slug: string | null): Promise<string | null> {
    if (slug === null || slug === '') return null;
    const { rows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM project WHERE org_id = ${orgId} AND slug = ${slug}`,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
        project: slug,
      });
    }
    return id;
  }
}

/** `jimin@example.com` → `j***@example.com` — 초대받은 사람인지 **확인**은 되되 알아내지는 못하게 */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
