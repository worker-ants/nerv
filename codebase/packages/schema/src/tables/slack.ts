// Slack 채널 발신 — 프로젝트의 웹훅과 보낼 줄 (2026-10-17 · 사람 결정 D1 · D2 · database.md §2.18 · REQ-DB-054)
//
// **웹훅 주소는 비밀이다.** 주소를 아는 사람은 누구나 그 채널에 글을 쓸 수 있다. 그래서 DB 에는 암호문만 두고
// (`NERV_ENCRYPTION_KEY` 의 AES-256-GCM — api `common/secret-box.ts`), 화면에는 끝 몇 글자(`webhook_hint`)만 보인다.
// 키가 없는 배치는 연결을 받지 않는다 — env 한 줄에 주소를 두는 안은 버렸다: 배포 하나에 값 하나라 프로젝트마다 다른
// 채널을 둘 수 없다(사람 결정 D2).
//
// **보낼 줄은 이벤트마다 하나다**(D1). 받는 사람이 여럿이어도 채널에는 한 번 게시하고 이름을 적는다 — 사람마다 쓰면 같은
// 채널에 같은 글이 그 수만큼 쌓인다. 메일 아웃박스(§2.17)와 같은 모양이고, 보내기 직전에 받은 요청이 이미 처리됐는지 다시
// 본다(`skipped_at` — 크로스 채널 dedup · spec-workflow §6.4).
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, idPk, ts } from './_columns.js';
import { project, user } from './tenancy.js';

export const projectSlack = pgTable('project_slack', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  /** `v1:<iv>:<tag>:<암호문>`(base64url) — 원문은 저장하지 않는다 */
  webhookCipher: text('webhook_cipher').notNull(),
  /** 원문의 끝 네 글자 — 어느 웹훅이 걸려 있는지 사람이 알아보게 */
  webhookHint: text('webhook_hint').notNull(),
  connectedBy: uuid('connected_by')
    .notNull()
    .references(() => user.id),
  connectedAt: ts('connected_at')
    .notNull()
    .default(sql`now()`),
});

export const slackOutbox = pgTable(
  'slack_outbox',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    /** 게시의 원인 — event 는 월 파티션이라 FK 를 걸지 않는다(email_outbox.ref_id 와 같다) */
    eventId: uuid('event_id').notNull(),
    /** 보내기 직전의 dedup 이 이 둘로 요청이 닫혔는지 본다 */
    eventType: text('event_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** 게시할 글 — 딥링크와 받는 사람 이름뿐이다(본문을 넣지 않는다 · §6.4) */
    body: text('body').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().default(new Date(0)),
    sentAt: ts('sent_at'),
    /** 보내기 전에 받은 요청에서 처리됐거나 연결이 끊겼다 — 보내지 않았다 */
    skippedAt: ts('skipped_at'),
    failedAt: ts('failed_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('slack_outbox_event').on(t.eventId),
    index('slack_outbox_due')
      .on(t.nextAttemptAt)
      .where(sql`sent_at IS NULL AND skipped_at IS NULL AND failed_at IS NULL`),
    index('slack_outbox_project').on(t.projectId, t.createdAt),
  ],
);
