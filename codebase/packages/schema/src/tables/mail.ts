// 메일 아웃박스 — 정본: docs/04-mvp/database.md §2.17 (2026-09-22 · 사람 결정)
//
// **표면은 행을 넣고, 워커가 보낸다.** 인라인 발송을 고르지 않은 이유가 셋이다.
//   ① better-auth 문서 자신이 발송을 `await` 하지 말라고 적는다 — 응답 시간이 "그 이메일이
//      존재하는가" 를 흘린다(타이밍 공격)
//   ② SMTP 는 느리고 죽는다. 사내 메일 서버가 잠깐 막히면 초대 만들기가 함께 막힌다
//   ③ 이 저장소에는 이미 그 배관이 있다 — 워커·advisory lock 단일 실행(REQ-CB-011)·잡 루프·
//      보존 잡. 새 개념이 아니라 여덟 번째 잡이다
//
// **`notification` 을 재사용하지 않는다.** 그 표는 `project_id`·`event_id`·`user_id` 가 전부
// NOT NULL 인데, 초대받은 사람은 **계정조차 없을 수 있고** 어느 프로젝트에도 속하지 않았다.
// 억지로 끼우면 그 세 열이 거짓말을 한다(FR-12 의 "알림의 메일 채널" 은 별개의 일이다).
//
// **본문은 넣을 때 만들어져 들어온다.** 워커는 렌더링하지 않는다 — 템플릿이 바뀌어도 이미
// 줄 서 있던 메일의 내용은 바뀌지 않는다. 그리고 도메인 엔티티가 아니라 **보내고 나면 치우는
// 큐**라, 테이블 카운트(§2)의 33종에 들지 않는다(`spec_chunk_embedding` 과 같은 자리다).

import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { emailKind } from '../enums.js';
import { citext, createdAt, idPk, ts } from './_columns.js';

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: idPk(),
    kind: emailKind('kind').notNull(),
    toEmail: citext('to_email').notNull(),
    /** 받는 **사람**의 언어다 — 초대한 사람의 것이 아니다. 모르면 `ko`(DEFAULT_LOCALE) */
    locale: text('locale').notNull().default('ko'),
    subject: text('subject').notNull(),
    /** 평문이 정본이다 — 평문 없는 메일은 스팸 점수를 스스로 올린다 */
    bodyText: text('body_text').notNull(),
    /** 없으면 평문만 보낸다 */
    bodyHtml: text('body_html'),
    /**
     * 무엇 때문에 생긴 메일인가(`invitation` · `user`). FK 로 걸지 않는 이유는 대상이
     * 테이블마다 다르고, 원본이 지워져도 **보냈다는 기록은 남아야** 하기 때문이다.
     */
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    attempts: integer('attempts').notNull().default(0),
    /** 다음에 집을 시각 — 실패하면 지수 백오프로 뒤로 민다 */
    nextAttemptAt: ts('next_attempt_at').notNull().default(new Date(0)),
    sentAt: ts('sent_at'),
    /** 상한까지 실패해 포기한 시각. 여기까지 오면 잡이 더 집지 않는다 */
    failedAt: ts('failed_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    // 잡이 집는 줄만 보는 부분 인덱스 — 보낸 것이 쌓여도 큐 조회 비용은 그대로다
    index('email_outbox_due')
      .on(t.nextAttemptAt)
      .where(sql`sent_at IS NULL AND failed_at IS NULL`),
    // 보존 잡이 보낸 지 오래된 것을 치운다(본문에 살아 있는 링크가 들어 있다)
    index('email_outbox_sent').on(t.sentAt),
  ],
);
