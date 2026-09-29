// 알림 메일 요약 — 켠 사람에게 하루 한 번 (2026-09-28 · 사람 결정 EM1~EM9 · api.md REQ-API-232 · REQ-DB-034)
//
// **알림은 앱 안에만 있었다.** 앱을 자주 열지 않는 사람(기획 · 디자인)에게는 결재와 질문이 와 있는지 알릴 길이
// 없었다. 메일을 새로 보내는 배관(발송 큐 · 워커 · 재시도)은 이미 있어서, 여기서 정하는 것은 "누구에게 무엇을
// 언제" 뿐이다.
//
// 규칙은 넷이다.
//   ① **켠 사람에게만**(기본 꺼짐 · EM3) — 배포하는 날 모든 사람에게 갑자기 메일이 가지 않는다.
//   ② **하루 한 번, 그 사람의 현지 시각**(EM2) — 시간대와 언어는 켤 때 브라우저가 준다(EM5).
//   ③ **안 읽은 것 가운데 새로 생기거나 건수가 늘어난 줄만**(EM4) — 이미 있는 읽음 상태가 중복을 걸러 준다:
//      닫힌 요청의 알림은 읽음이 되고(REQ-API-176), 프로젝트를 "중요만" · "알리지 않음" 으로 둔 사람에게는
//      그 밖의 알림이 읽음으로 들어온다(REQ-API-219). 멤버에서 빠졌거나 보관한 프로젝트는 뺀다(REQ-API-211).
//   ④ **키 · 제목 · 건수 · 이름까지, 본문은 없다**(EM7) — 메일은 NERV 밖으로 나간다.
//
// 메일을 보냈다고 알림을 읽음으로 바꾸지 않는다 — 배지는 앱에서 본 것만 줄어야 한다.

import { Injectable, Logger } from '@nestjs/common';
import {
  DIGEST_DEFAULT_HOUR,
  DIGEST_MAX_LINES,
  isLocale,
  isMessageKey,
  LOCALES,
  msg,
  NERV_ERROR,
  renderMessage,
} from '@nerv/schema';
import type { Locale } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { memberOfProjectSql } from '../../common/member-scope.js';
import { sqlArray } from '../../common/sql-array.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { webUrlFromEnv } from '../../common/origins.js';
import { ApprovalService } from '../approval/approval.service.js';
import { EVENT_SUBJECT_COLUMNS, EVENT_SUBJECT_JOINS } from '../event/event-subject.js';
import { mailEnabled } from '../mail/mail.config.js';
import { MailOutbox } from '../mail/mail.outbox.js';
import {
  hashUnsubscribeToken,
  newUnsubscribeToken,
  unsubscribeWebUrl,
} from '../mail/unsubscribe-link.js';

export interface DigestSetting {
  enabled: boolean;
  hour: number;
  timezone: string | null;
  locale: Locale | null;
  last_sent_at: string | null;
  /** 이 서버가 메일을 보낼 수 있는가 — 꺼져 있으면 화면이 칸을 잠근다 */
  mail_enabled: boolean;
}

type DigestLine = {
  id: string;
  importance: string;
  batch_size: number;
  event_type: string | null;
  actor_name: string | null;
  org_name: string;
  org_slug: string;
  project_name: string;
  project_slug: string;
  spec_key: string | null;
  spec_title: string | null;
  task_key: string | null;
  task_title: string | null;
  question_title: string | null;
  finding_title: string | null;
  review_branch: string | null;
  session_hostname: string | null;
};

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    @InjectDb() private readonly db: NervDb,
    private readonly outbox: MailOutbox,
    private readonly approvals: ApprovalService,
  ) {}

  /** EP-NTF-07 — 내 설정. 행이 없으면 꺼짐이다 */
  async get(userId: string): Promise<DigestSetting> {
    const { rows } = await this.db.execute<{
      hour: number;
      timezone: string;
      locale: string;
      last_sent_at: string | null;
    }>(sql`
      SELECT hour, timezone, locale, last_sent_at::text AS last_sent_at
        FROM notification_digest_setting WHERE user_id = ${userId}
    `);
    const row = rows[0];
    return {
      enabled: row !== undefined,
      hour: row?.hour ?? DIGEST_DEFAULT_HOUR,
      timezone: row?.timezone ?? null,
      locale: row !== undefined && isLocale(row.locale) ? row.locale : null,
      last_sent_at: row?.last_sent_at ?? null,
      mail_enabled: mailEnabled(),
    };
  }

  /**
   * EP-NTF-08 — 켜고 끈다. 끄면 행을 지운다. 켜는 것은 **메일을 보낼 수 있는 서버에서만**이다 — 보낼 수 없는
   * 서버에서 켜 두면 사람은 받는 줄 알고 기다린다.
   */
  async set(input: {
    userId: string;
    enabled: boolean;
    hour?: number | undefined;
    timezone?: string | undefined;
    locale?: string | undefined;
  }): Promise<DigestSetting> {
    if (!input.enabled) {
      await this.db.execute(
        sql`DELETE FROM notification_digest_setting WHERE user_id = ${input.userId}`,
      );
      return this.get(input.userId);
    }
    if (!mailEnabled()) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.digest.mail_disabled'), {
        kind: 'mail_disabled',
      });
    }
    if (input.locale !== undefined && !isLocale(input.locale)) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
        kind: 'invalid_input',
        field: 'locale',
        allowed: [...LOCALES],
      });
    }
    if (input.timezone !== undefined) await this.assertTimezone(input.timezone);

    const current = await this.get(input.userId);
    const timezone = input.timezone ?? current.timezone;
    const locale = input.locale ?? current.locale;
    // 처음 켤 때는 시간대와 언어가 있어야 한다 — 화면은 브라우저의 값을 보낸다(EM5)
    if (timezone === null || locale === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
        kind: 'invalid_input',
        missing: [
          ...(timezone === null ? ['timezone'] : []),
          ...(locale === null ? ['locale'] : []),
        ],
      });
    }
    const hour = input.hour ?? current.hour;
    // 다시 켜도 `enabled_at` 은 처음 켠 때가 아니라 **이번에 켠 때**다 — 끈 동안 쌓인 것을 한꺼번에 보내지 않는다
    await this.db.execute(sql`
      INSERT INTO notification_digest_setting (user_id, hour, timezone, locale)
      VALUES (${input.userId}, ${hour}, ${timezone}, ${locale})
      ON CONFLICT (user_id) DO UPDATE
         SET hour = excluded.hour, timezone = excluded.timezone, locale = excluded.locale,
             updated_at = now()
    `);
    return this.get(input.userId);
  }

  /** 실재하는 IANA 시간대인가 — Postgres 가 아는 이름표로 대조한다(현지 시각 계산도 Postgres 가 한다) */
  private async assertTimezone(timezone: string): Promise<void> {
    const { rows } = await this.db.execute<{ ok: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ${timezone}) AS ok`,
    );
    if (rows[0]?.ok !== true) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
        kind: 'invalid_input',
        field: 'timezone',
      });
    }
  }

  /**
   * EP-NTF-09 — 메일의 끄는 링크로 **로그인 없이** 끈다(2026-09-28 · 사람 결정 EM8 · REQ-API-234). 메일 앱의
   * [구독 취소] 단추(RFC 8058 — 쿠키 없는 POST)와 화면의 확인 단추가 같은 곳을 부른다. 끄는 것은 **메일 요약만**
   * 이다 — 가입 확인 · 재설정 · 초대 메일은 그대로다. 이미 꺼져 있어도 성공이다(두 번 눌러도 같은 결과).
   * 링크는 그 메일 행에 붙어 있어서, 행이 지워지면(보낸 지 7일 · REQ-DB-033) 409 `not_found` 다.
   */
  async unsubscribe(token: string): Promise<{ ok: true; unsubscribed: true }> {
    const { rows } = await this.db.execute<{ user_id: string }>(sql`
      SELECT ref_id AS user_id FROM email_outbox
       WHERE unsubscribe_token_hash = ${hashUnsubscribeToken(token)}
         AND kind = 'notification_digest' AND ref_id IS NOT NULL
    `);
    const userId = rows[0]?.user_id;
    if (userId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.digest.unsubscribe_expired'), {
        kind: 'not_found',
      });
    }
    await this.db.execute(sql`DELETE FROM notification_digest_setting WHERE user_id = ${userId}`);
    return { ok: true, unsubscribed: true };
  }

  /**
   * 워커의 한 판 — 현지 시각이 정한 시를 지났고 **오늘(현지) 아직 판정하지 않은** 사람마다 한 통.
   *
   * 워커의 주기는 메모리에만 있어 재기동하면 곧바로 한 번 돈다. 그래서 "오늘 보냈는가" 는 행(`last_sent_at`)이
   * 들고, 사람마다 그 행을 잠근 트랜잭션 안에서 담기 · 큐에 넣기 · 표시하기를 함께 한다 — 배포 중 두 워커가
   * 겹쳐도 한 통이다.
   */
  async sendDue(): Promise<{ checked: number; sent: number }> {
    if (!mailEnabled()) return { checked: 0, sent: 0 };
    const { rows: due } = await this.db.execute<{ user_id: string }>(sql`
      SELECT s.user_id FROM notification_digest_setting s
        JOIN "user" u ON u.id = s.user_id AND u.state = 'active'
       WHERE ${dueSql}
    `);
    let sent = 0;
    for (const { user_id } of due) {
      try {
        if (await this.sendOne(user_id)) sent += 1;
      } catch (error) {
        // 한 사람의 실패가 다른 사람의 요약을 막지 않는다 — 다음 판에 다시 본다
        this.logger.warn(`메일 요약을 만들지 못했다(${user_id}): ${String(error)}`);
      }
    }
    return { checked: due.length, sent };
  }

  private async sendOne(userId: string): Promise<boolean> {
    // 결정 대기 수는 받은 요청의 판정 그대로다(D-05) — 잠긴 카드는 세지 않는다
    const inbox = await this.approvals.inboxGlobal({
      actor: { userId, isAgent: false },
      userId,
      state: 'pending',
      limit: 1,
    });
    const pending = inbox.actionable_total ?? inbox.total;

    return this.db.transaction(async (tx) => {
      const { rows: settings } = await tx.execute<{
        email: string;
        name: string;
        hour: number;
        timezone: string;
        locale: string;
      }>(sql`
        SELECT u.email, u.display_name AS name, s.hour, s.timezone, s.locale
          FROM notification_digest_setting s JOIN "user" u ON u.id = s.user_id
         WHERE s.user_id = ${userId} AND ${dueSql}
         FOR UPDATE OF s SKIP LOCKED
      `);
      const setting = settings[0];
      if (setting === undefined) return false;
      const locale: Locale = isLocale(setting.locale) ? setting.locale : 'ko';

      const { rows: lines } = await tx.execute<DigestLine>(sql`
        SELECT n.id, n.importance::text AS importance, n.batch_size,
               e.type AS event_type, au.display_name AS actor_name,
               o.name AS org_name, o.slug AS org_slug, p.name AS project_name, p.slug AS project_slug,
               ${EVENT_SUBJECT_COLUMNS}
          FROM notification n
          JOIN notification_digest_setting s ON s.user_id = n.user_id
          JOIN project p ON p.id = n.project_id
          JOIN organization o ON o.id = p.org_id
     LEFT JOIN event e ON e.id = n.event_id
     LEFT JOIN "user" au ON au.id = e.actor_user_id
     ${EVENT_SUBJECT_JOINS}
         WHERE n.user_id = ${userId} AND n.state = 'unread' AND n.channel = 'inapp'
           -- 지난 요약 뒤에 새로 생기거나 건수가 늘어난 줄만 — 켜기 전의 것은 담지 않는다
           AND (n.delivered_at IS NULL OR n.last_at > n.delivered_at)
           AND n.last_at > s.enabled_at
           AND p.archived_at IS NULL
           AND ${memberOfProjectSql(userId)}
         ORDER BY o.name, p.name, (n.importance = 'immediate') DESC, n.last_at DESC
      `);

      // 보낼 것이 없는 날도 판정은 끝났다 — 오늘 다시 보지 않는다
      if (lines.length > 0) {
        // 끄는 링크는 메일마다 새 토큰이다 — 원문은 메일에만 있고 행에는 해시만 남는다(EM8)
        const unsubscribeToken = newUnsubscribeToken();
        const outboxId = await this.outbox.enqueueDigest(tx, {
          email: setting.email,
          locale,
          userId,
          unsubscribeToken,
          ...render({ lines, pending, locale, name: setting.name, setting, unsubscribeToken }),
        });
        await tx.execute(sql`
          UPDATE notification SET delivered_at = now(), digest_batch_id = ${outboxId}
           WHERE id = ANY(${sqlArray(
             lines.map((l) => l.id),
             'uuid',
           )})
        `);
      }
      await tx.execute(
        sql`UPDATE notification_digest_setting SET last_sent_at = now() WHERE user_id = ${userId}`,
      );
      return lines.length > 0;
    });
  }
}

/**
 * 오늘(그 사람의 현지 날짜) 아직 판정하지 않았고, 현지 시각이 정한 시를 지났는가. 별칭 `s` 가 설정 행이어야 한다.
 * 현지 시각 계산은 Postgres 가 한다 — 서머타임까지 IANA 이름표로 맞춘다.
 */
const dueSql = sql`
  extract(hour FROM now() AT TIME ZONE s.timezone) >= s.hour
  AND (s.last_sent_at IS NULL
       OR (s.last_sent_at AT TIME ZONE s.timezone)::date < (now() AT TIME ZONE s.timezone)::date)`;

/** 메일 본문 — 받는 사람의 언어로. 평문이 정본이다(`email_outbox.body_text`) */
function render(input: {
  lines: DigestLine[];
  pending: number;
  locale: Locale;
  name: string;
  setting: { hour: number; timezone: string };
  unsubscribeToken: string;
}): { subject: string; body: string } {
  const { lines, pending, locale } = input;
  const web = webUrlFromEnv().replace(/\/+$/, '');
  const t = (m: Parameters<typeof renderMessage>[0]): string => renderMessage(m, locale);
  const shown = lines.slice(0, DIGEST_MAX_LINES);
  const rest = lines.length - shown.length;

  const out: string[] = [t(msg('mail.digest.intro', { name: input.name })), ''];
  if (pending > 0) {
    out.push(t(msg('mail.digest.pending', { count: pending })), `${web}/inbox`, '');
  }
  // 조직 → 프로젝트 → 중요 · 보통 (EM6)
  let scope = '';
  for (const line of shown) {
    const here = `${line.org_slug}/${line.project_slug}`;
    if (here !== scope) {
      if (scope !== '') out.push('');
      scope = here;
      out.push(`■ ${line.org_name} · ${line.project_name}`);
      const query = new URLSearchParams({ org: line.org_slug, project: line.project_slug });
      out.push(t(msg('mail.digest.open', { url: `${web}/notifications?${query.toString()}` })));
    }
    out.push(`- ${describe(line, t)}`);
  }
  if (rest > 0)
    out.push('', t(msg('mail.digest.more', { count: rest, url: `${web}/notifications` })));
  out.push(
    '',
    '—',
    t(
      msg('mail.digest.footer', {
        hour: input.setting.hour,
        timezone: input.setting.timezone,
        url: `${web}/settings/account?tab=notifications`,
      }),
    ),
    t(msg('mail.digest.unsubscribe', { url: unsubscribeWebUrl(input.unsubscribeToken) })),
  );

  const subject =
    pending > 0
      ? t(msg('mail.digest.subject', { count: lines.length, pending }))
      : t(msg('mail.digest.subject_no_pending', { count: lines.length }));
  return { subject, body: out.join('\n') };
}

/** 한 줄 — `[중요] CLV-S-7KQ2MD 웹챗 위젯 — 승인 요청 · 민서 ×3` */
function describe(line: DigestLine, t: (m: Parameters<typeof renderMessage>[0]) => string): string {
  const key = line.spec_key ?? line.task_key ?? '';
  const title =
    line.spec_title ??
    line.task_title ??
    line.question_title ??
    line.finding_title ??
    line.review_branch ??
    line.session_hostname ??
    '';
  const eventKey = `event.${line.event_type ?? ''}`;
  const what = isMessageKey(eventKey) ? t({ key: eventKey }) : (line.event_type ?? '');
  const parts = [
    line.importance === 'immediate' ? t(msg('mail.digest.important')) : '',
    key,
    title,
  ].filter((p) => p !== '');
  const head = parts.join(' ');
  const tail = [what, line.actor_name ?? ''].filter((p) => p !== '').join(' · ');
  const count = line.batch_size > 1 ? ` ×${line.batch_size}` : '';
  return `${head}${head === '' || tail === '' ? '' : ' — '}${tail}${count}`;
}
