// 메일 아웃박스 — 넣는 쪽 (정본: docs/04-mvp/database.md §2.17 · api.md §2.1b)
//
// **표면은 행을 넣고 끝낸다.** 보내는 일은 워커의 `mail.job` 이 한다 — 이유는
// `packages/schema/src/tables/mail.ts` 머리에 적혀 있다.
//
// 본문은 **여기서** 만든다. 워커는 렌더링하지 않는다 — 템플릿이 바뀌어도 이미 줄 서 있던
// 메일의 내용은 바뀌지 않아야 하고, 그래야 "그 사람이 받은 것" 과 "지금 보이는 것" 이 같다.

import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  INVITATION_TTL_DAYS,
  MAIL_BATCH_SIZE,
  MAIL_MAX_ATTEMPTS,
  isLocale,
  msg,
  renderMessage,
} from '@nerv/schema';
import type { Locale } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { newId } from '@nerv/schema';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { webUrlFromEnv } from '../../common/origins.js';
import { mailEnabled } from './mail.config.js';

/** 워커가 집어 가는 한 줄 */
export interface DueMail extends Record<string, unknown> {
  id: string;
  kind: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  ref_type: string | null;
  ref_id: string | null;
  attempts: number;
}

@Injectable()
export class MailOutbox {
  private readonly logger = new Logger(MailOutbox.name);

  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * 초대 메일을 줄 세운다. **초대를 만든 트랜잭션 안에서 부른다** — 초대는 만들어졌는데
   * 메일만 사라지는 상태를 만들지 않는다.
   *
   * SMTP 가 꺼진 배치에서는 **넣지도 않는다.** 보낼 수 없는 줄이 조용히 자라면, 나중에
   * SMTP 를 켠 날 몇 달 치 초대가 한꺼번에 나간다.
   */
  async enqueueInvite(
    tx: NervDb,
    input: {
      token: string;
      email: string;
      orgName: string;
      role: string;
      inviterName: string;
      invitationId: string;
      locale?: string | null;
    },
  ): Promise<boolean> {
    if (!mailEnabled()) return false;
    const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
    // **화면 주소로 만든다 — API 주소가 아니다.** 이 저장소는 그 자리에서 이미 두 번
    // 데였다(REQ-WEB-165·166): 사람이 여는 것은 `app.` 이고 에이전트가 붙는 곳이 `api.` 다.
    const url = `${webUrlFromEnv().replace(/\/+$/, '')}/invite/${input.token}`;
    const values = {
      inviter: input.inviterName,
      org: input.orgName,
      role: input.role,
      url,
      days: INVITATION_TTL_DAYS,
      email: input.email,
    };
    await tx.execute(sql`
      INSERT INTO email_outbox (id, kind, to_email, locale, subject, body_text, ref_type, ref_id)
      VALUES (${newId()}, 'invite', ${input.email}, ${locale},
              ${renderMessage(msg('mail.invite.subject', values), locale)},
              ${renderMessage(msg('mail.invite.body', values), locale)},
              'invitation', ${input.invitationId})
    `);
    return true;
  }

  /**
   * 보낼 때가 된 줄을 집는다 — **`FOR UPDATE SKIP LOCKED`**.
   *
   * 워커는 advisory lock 으로 하나만 돌지만(REQ-CB-011), 그 잠금이 풀리는 순간(배포 중
   * 두 파드가 겹치는 짧은 구간)에도 같은 메일을 두 번 보내지 않아야 한다. 이 저장소가
   * Task 클레임에서 쓰는 그 방식이다 — 동시성은 mock 이 아니라 DB 가 판정한다.
   */
  async claimDue(limit: number = MAIL_BATCH_SIZE): Promise<DueMail[]> {
    const { rows } = await this.db.execute<DueMail>(sql`
      WITH due AS (
        SELECT id FROM email_outbox
         WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE email_outbox o
         SET attempts = o.attempts + 1,
             -- 집는 순간 뒤로 민다. 보내는 동안 다음 틱이 와도 같은 줄을 다시 집지 않는다 —
             -- 성공하면 sent_at 이 서고, 실패하면 아래에서 백오프로 다시 민다.
             next_attempt_at = now() + interval '1 minute'
        FROM due
       WHERE o.id = due.id
      RETURNING o.id, o.kind::text AS kind, o.to_email, o.subject,
                o.body_text, o.body_html, o.ref_type, o.ref_id, o.attempts
    `);
    return rows;
  }

  /** 보냈다. 초대라면 그 초대에도 적어 둔다 — 보존 잡이 이 줄을 치워도 답이 남게 */
  async markSent(mail: DueMail): Promise<void> {
    await this.db.transaction(async (tx: NervDb) => {
      await tx.execute(sql`UPDATE email_outbox SET sent_at = now() WHERE id = ${mail.id}`);
      if (mail.ref_type === 'invitation' && mail.ref_id !== null) {
        await tx.execute(sql`UPDATE invitation SET last_sent_at = now() WHERE id = ${mail.ref_id}`);
      }
    });
  }

  /**
   * 못 보냈다. 상한(`MAIL_MAX_ATTEMPTS`)까지는 지수 백오프로 다시, 넘으면 포기하고 남긴다.
   *
   * **포기한 줄을 지우지 않는다** — 왜 안 갔는지가 기록이고, 그것이 없으면 "보냈는데 안
   * 왔다" 와 "애초에 못 보냈다" 를 아무도 가르지 못한다.
   */
  async markFailure(mail: DueMail, error: string): Promise<void> {
    const reason = error.slice(0, 500);
    if (mail.attempts >= MAIL_MAX_ATTEMPTS) {
      await this.db.execute(sql`
        UPDATE email_outbox SET failed_at = now(), last_error = ${reason} WHERE id = ${mail.id}
      `);
      // 운영자용 로그다(REQ-CB-022 예외) — 사람의 화면에는 나가지 않는다
      this.logger.error(`메일 ${mail.kind} 를 ${mail.attempts}회 시도 후 포기했습니다: ${reason}`);
      return;
    }
    await this.db.execute(sql`
      UPDATE email_outbox
         SET last_error = ${reason},
             next_attempt_at = now() + (${backoffMinutes(mail.attempts)} || ' minutes')::interval
       WHERE id = ${mail.id}
    `);
  }
}

/**
 * 몇 분 뒤에 다시 볼 것인가 — 2의 거듭제곱(1 · 2 · 4 · 8 · 16분).
 *
 * 상한(5회)까지 걸리는 시간이 31분이다. 그보다 길게 잡으면 잠깐 막힌 메일 서버가 돌아온
 * 뒤에도 초대가 한참 오지 않고, 짧게 잡으면 죽은 서버를 쉬지 않고 두드린다.
 */
export function backoffMinutes(attempts: number): number {
  return 2 ** Math.max(0, Math.min(attempts - 1, MAIL_MAX_ATTEMPTS));
}
