// 조직 초대 — 사람 결정 2026-08-27 (api.md §2.1b)
//
// **초대는 레코드다.** membership 을 바로 만들 수 없기 때문이다: 초대받은 사람이 아직
// 가입하지 않았으면 `user` 행이 없다. 그리고 "누가 누구를 언제 불렀나"는 감사 대상이며
// (FR-16), 만료와 회수는 상태를 가진 것만이 가질 수 있다.
//
// **토큰은 해시만 남긴다** — PAT 와 같은 규율이다(D-08). 원문은 발급 응답에 한 번 나가고
// 그 뒤로 서버는 그것을 모른다. 링크가 새는 사고는 막을 수 없어도, DB 가 새는 사고에서
// 링크까지 함께 새지는 않게 한다.

import { pgTable, uniqueIndex, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { bytea, citext, createdAt, idPk, ts } from './_columns.js';
import { memberRole } from '../enums.js';
import { organization, project, user } from './tenancy.js';

export const invitation = pgTable(
  'invitation',
  {
    id: idPk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    /** NULL = 조직 전역 초대. 값이 있으면 그 프로젝트 스코프로 들어온다 */
    projectId: uuid('project_id').references(() => project.id),
    /**
     * **초대한 이메일로만 수락된다**(사람 결정 2026-08-27). 토큰만으로 아무 계정이나
     * 받아 주면 링크가 새는 순간 아무나 들어온다 — 링크는 메신저를 타고 흐른다.
     */
    email: citext('email').notNull(),
    role: memberRole('role').notNull(),
    /** 원문은 발급 때 한 번만 — 여기에는 sha256 만 있다(PAT 와 같은 컬럼 형태) */
    tokenHash: bytea('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => user.id),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    acceptedUserId: uuid('accepted_user_id').references(() => user.id),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // 같은 사람에게 같은 스코프의 초대가 **둘 살아 있지 않게** 한다. 수락·회수된 것은
    // 기록으로 남아야 하므로 부분 인덱스다 — 지우는 대신 상태를 남긴다.
    uniqueIndex('invitation_pending_uq')
      .on(t.email, sql`coalesce(${t.projectId}, ${t.orgId})`)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
    // 받는 사람의 화면이 이메일로 자기 초대를 찾는다(EP-INV-06)
    index('invitation_email').on(t.email),
  ],
);
