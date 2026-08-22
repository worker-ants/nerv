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
import { NERV_ERROR, isAgentScope, isHumanOnlyScope, newId } from '@nerv/schema';
import type { AgentScope } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
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

  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * PAT 발급. 원문은 **이 응답에서 한 번만** 나간다 — 서버는 해시만 보관한다.
   * 사람 전용 스코프는 요청에 섞여도 부여하지 않는다(불변식 — api.md §1.3).
   */
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
    if (auth.kind === 'session') {
      // better-auth 세션 검증은 E08-S01 소관이다.
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '세션 인증이 아직 배선되지 않았습니다.', {
        kind: 'session_not_wired',
        story: 'E08-S01',
      });
    }
    return this.verifyPat(auth.credential);
  }

  async verifyPat(raw: string): Promise<Principal> {
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

    // last_used_at 갱신은 감사용이라 실패해도 요청을 막지 않는다
    void this.db
      .execute(sql`UPDATE api_token SET last_used_at = now() WHERE id = ${token.id}`)
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
