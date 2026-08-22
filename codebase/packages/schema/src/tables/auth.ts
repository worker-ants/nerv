// 인증 인프라 테이블 — better-auth 소유 (도메인 엔티티 아님)
//
// **이 세 테이블은 데이터 모델의 엔티티가 아니다.** `spec_chunk_embedding`(4.3 §2.15)과 같은
// 등급 — 확정 스택(better-auth, 4.1 §2.1)이 자기 동작을 위해 요구하는 물리 테이블이며
// 엔티티 29종 카운트·ERD 에 들지 않는다. 세션을 전부 지워도 사람은 다시 로그인하면 되고,
// 도메인 데이터는 하나도 잃지 않는다.
//
// **organization 플러그인은 쓰지 않는다.** 조직·멤버십은 NERV 도메인 테이블이 이미 소유하고
// (`organization`·`membership`, data-model §2.1 정본이며 역할 6종이 여기 있다), 플러그인을
// 켜면 같은 사실이 두 곳에 저장된다. better-auth 는 **인증**(신원 확인·세션)만 맡고
// **인가**(역할·멤버십)는 도메인이 쥔다 — 그 경계가 D-08(에이전트 권한 ⊆ 사람 권한)의 전제다.

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './tenancy.js';

export const authSession = pgTable('auth_session', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authAccount = pgTable('auth_account', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  issuer: text('issuer'),
  /** 이메일+비밀번호 프로필의 해시. 원문은 어디에도 없다 */
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authVerification = pgTable('auth_verification', {
  id: uuid('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
