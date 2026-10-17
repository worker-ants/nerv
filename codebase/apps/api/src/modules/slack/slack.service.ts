// Slack 채널 연결과 발송 큐 — 판정은 여기 한 곳이다(D-05) · 2026-10-17 · 사람 결정 D1 · D2 · E17-S03
//
// 연결은 프로젝트마다 Incoming Webhook 하나다(D1 = A). 사람마다 Slack 계정을 잇지 않고 Slack 앱 승인도 필요 없다. 그 대신
// 웹훅은 채널 하나에만 게시하므로 critical 은 「Slack DM」이 아니라 「프로젝트 채널」로 간다 — DM 은 알림 피로(성공 기준 2-10)를
// 본 뒤의 일이다(spec-workflow §6.2). 첫 조각은 critical 만 보낸다.
//
// 연결 · 끊기 · 시험은 admin 이고 사람만 한다(REQ-API-355). 에이전트 토큰이 팀 채널로 나가는 길을 바꾸면 안 된다 — 게이트 정책과
// 같은 무게다(EP-PRJ-04).
import { Injectable, Logger } from '@nestjs/common';
import {
  msg,
  newId,
  NERV_ERROR,
  NERV_EVENT,
  SLACK_BATCH_SIZE,
  SLACK_MAX_ATTEMPTS,
  SLACK_WEBHOOK_HINT_LENGTH,
  text,
} from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { assertHuman } from '../../common/human-only.js';
import type { Actor } from '../../common/human-only.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { webUrlFromEnv } from '../../common/origins.js';
import { encryptionKeyFromEnv, open, seal } from '../../common/secret-box.js';
import { sqlArray } from '../../common/sql-array.js';
import { backoffMinutes } from '../mail/mail.outbox.js';
import { EventService } from '../event/event.service.js';
import { slackBody, slackLink, slackWebhookPrefix } from './slack.message.js';
import type { SlackProjectRef } from './slack.message.js';
import { SlackSender } from './slack.sender.js';

export interface SlackStatus {
  /** 이 배치가 연결을 받을 수 있는가 — `NERV_ENCRYPTION_KEY` 가 있어야 한다 */
  enabled: boolean;
  /** 웹훅 주소가 시작해야 하는 곳 */
  webhook_prefix: string;
  connection: { hint: string; connected_at: string; connected_by: string | null } | null;
  /** 가장 최근에 끝난 발송 하나 — 보냈는가 · 포기했는가 · 왜 */
  last_delivery: {
    event_type: string;
    state: 'sent' | 'skipped' | 'failed';
    at: string;
    error: string | null;
  } | null;
  /** 아직 보내지 않은 줄 수 */
  pending: number;
}

export interface DueSlack extends Record<string, unknown> {
  id: string;
  project_id: string;
  event_type: string;
  subject_id: string;
  body: string;
  attempts: number;
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(
    @InjectDb() private readonly db: NervDb,
    private readonly events: EventService,
    private readonly sender: SlackSender,
  ) {}

  /** 키가 있는 배치만 연결 · 발송한다 — 키가 틀린 모양이면 기동이 이미 거부됐다 */
  get enabled(): boolean {
    return encryptionKeyFromEnv() !== null;
  }

  /** EP-PRJ-07 — 프로젝트 멤버면 본다(주소는 끝 몇 글자뿐이다) */
  async status(projectId: string): Promise<SlackStatus> {
    const { rows: link } = await this.db.execute<{
      hint: string;
      at: string;
      by: string | null;
    }>(sql`
      SELECT s.webhook_hint AS hint, s.connected_at::text AS at, u.display_name AS by
        FROM project_slack s LEFT JOIN "user" u ON u.id = s.connected_by
       WHERE s.project_id = ${projectId}
    `);
    const { rows: last } = await this.db.execute<{
      event_type: string;
      state: 'sent' | 'skipped' | 'failed';
      at: string;
      error: string | null;
    }>(sql`
      SELECT event_type,
             CASE WHEN sent_at IS NOT NULL THEN 'sent' WHEN skipped_at IS NOT NULL THEN 'skipped' ELSE 'failed' END AS state,
             coalesce(sent_at, skipped_at, failed_at)::text AS at, last_error AS error
        FROM slack_outbox
       WHERE project_id = ${projectId} AND (sent_at IS NOT NULL OR skipped_at IS NOT NULL OR failed_at IS NOT NULL)
       ORDER BY coalesce(sent_at, skipped_at, failed_at) DESC
       LIMIT 1
    `);
    const { rows: pending } = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM slack_outbox
       WHERE project_id = ${projectId} AND sent_at IS NULL AND skipped_at IS NULL AND failed_at IS NULL
    `);
    const row = link[0];
    return {
      enabled: this.enabled,
      webhook_prefix: slackWebhookPrefix(),
      connection:
        row === undefined ? null : { hint: row.hint, connected_at: row.at, connected_by: row.by },
      last_delivery: last[0] ?? null,
      pending: pending[0]?.n ?? 0,
    };
  }

  /** EP-PRJ-08 — 연결하거나 바꾼다. 같은 프로젝트의 웹훅은 하나다 */
  async connect(input: {
    actor: Actor;
    roles: readonly string[];
    projectId: string;
    webhookUrl: string;
  }): Promise<SlackStatus> {
    this.assertAdmin(input.actor, input.roles);
    const key = this.requireKey();
    const url = input.webhookUrl.trim();
    const prefix = slackWebhookPrefix();
    if (!url.startsWith(prefix) || url.length <= prefix.length) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.slack.webhook_prefix', { prefix }), {
        kind: 'invalid_input',
        field: 'webhook_url',
        prefix,
      });
    }
    const hint = url.slice(-SLACK_WEBHOOK_HINT_LENGTH);
    await this.events.transact(async (tx, emit) => {
      await tx.execute(sql`
        INSERT INTO project_slack (project_id, webhook_cipher, webhook_hint, connected_by)
        VALUES (${input.projectId}, ${seal(url, key)}, ${hint}, ${input.actor.userId})
        ON CONFLICT (project_id) DO UPDATE
           SET webhook_cipher = EXCLUDED.webhook_cipher, webhook_hint = EXCLUDED.webhook_hint,
               connected_by = EXCLUDED.connected_by, connected_at = now()
      `);
      // 감사는 프로젝트 설정의 변경으로 남는다 — 주소는 넣지 않는다(끝 글자만)
      await emit({
        type: NERV_EVENT.PROJECT_UPDATED,
        projectId: input.projectId,
        subjectType: 'project',
        subjectId: input.projectId,
        actorUserId: input.actor.userId,
        isAgent: false,
        payload: { fields: ['slack'], slack: 'connected', hint },
      });
    });
    return this.status(input.projectId);
  }

  /** EP-PRJ-09 — 끊는다. 아직 안 보낸 줄은 보내지 않는다(끊은 뒤에 글이 나가면 안 된다) */
  async disconnect(input: {
    actor: Actor;
    roles: readonly string[];
    projectId: string;
  }): Promise<SlackStatus> {
    this.assertAdmin(input.actor, input.roles);
    await this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ project_id: string }>(
        sql`DELETE FROM project_slack WHERE project_id = ${input.projectId} RETURNING project_id`,
      );
      if (rows.length === 0) return;
      await tx.execute(sql`
        UPDATE slack_outbox SET skipped_at = now(), last_error = 'disconnected'
         WHERE project_id = ${input.projectId} AND sent_at IS NULL AND skipped_at IS NULL AND failed_at IS NULL
      `);
      await emit({
        type: NERV_EVENT.PROJECT_UPDATED,
        projectId: input.projectId,
        subjectType: 'project',
        subjectId: input.projectId,
        actorUserId: input.actor.userId,
        isAgent: false,
        payload: { fields: ['slack'], slack: 'disconnected' },
      });
    });
    return this.status(input.projectId);
  }

  /** EP-PRJ-10 — 연결 시험. 큐를 거치지 않고 바로 보내 결과를 돌려준다 */
  async test(input: {
    actor: Actor;
    roles: readonly string[];
    projectId: string;
  }): Promise<{ ok: true }> {
    this.assertAdmin(input.actor, input.roles);
    const url = await this.webhookOf(input.projectId);
    if (url === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.slack.not_connected'), {
        kind: 'not_connected',
      });
    }
    const project = await this.projectRef(input.projectId);
    const settings = `${webUrlFromEnv().replace(/\/+$/, '')}/settings/integrations`;
    const result = await this.sender.post(
      url,
      text('slack.test_message', { project: project?.name ?? '', link: settings }),
    );
    if (result.kind !== 'sent') {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.slack.rejected', { reason: result.reason }),
        {
          kind: 'slack_rejected',
          reason: result.reason,
        },
      );
    }
    return { ok: true };
  }

  /**
   * 알림 파생이 critical 이벤트마다 부른다 — 연결된 프로젝트면 한 줄을 넣는다. 같은 이벤트는 한 번이다(유일 인덱스).
   * 키가 없는 배치 · 연결이 없는 프로젝트는 넣지 않는다: 보낼 수 없는 줄이 쌓이면 나중에 연결한 날 지난 일이 한꺼번에 나간다.
   */
  async enqueue(
    event: { id: string; project_id: string; type: string; subject_id: string },
    recipientIds: readonly string[],
  ): Promise<boolean> {
    if (!this.enabled || recipientIds.length === 0) return false;
    const { rows: linked } = await this.db.execute<{ ok: number }>(
      sql`SELECT 1 AS ok FROM project_slack WHERE project_id = ${event.project_id}`,
    );
    if (linked.length === 0) return false;
    const project = await this.projectRef(event.project_id);
    if (project === null) return false;
    const { rows: people } = await this.db.execute<{ name: string }>(sql`
      SELECT coalesce(nullif(display_name, ''), email::text) AS name FROM "user"
       WHERE id = ANY(${sqlArray(recipientIds, 'uuid')}) ORDER BY 1
    `);
    const body = slackBody({
      event,
      project,
      names: people.map((p) => p.name),
      link: slackLink(webUrlFromEnv(), event, project),
    });
    const { rows } = await this.db.execute<{ id: string }>(sql`
      INSERT INTO slack_outbox (id, project_id, event_id, event_type, subject_id, body)
      VALUES (${newId()}, ${event.project_id}, ${event.id}, ${event.type}, ${event.subject_id}, ${body})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `);
    return rows.length > 0;
  }

  /** 보낼 때가 된 줄 — 메일과 같이 `FOR UPDATE SKIP LOCKED` 로 집고 집는 순간 뒤로 민다 */
  async claimDue(limit: number = SLACK_BATCH_SIZE): Promise<DueSlack[]> {
    const { rows } = await this.db.execute<DueSlack>(sql`
      WITH due AS (
        SELECT id FROM slack_outbox
         WHERE sent_at IS NULL AND skipped_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE slack_outbox o
         SET attempts = o.attempts + 1, next_attempt_at = now() + interval '1 minute'
        FROM due
       WHERE o.id = due.id
      RETURNING o.id, o.project_id, o.event_type, o.subject_id::text AS subject_id, o.body, o.attempts
    `);
    return rows;
  }

  async markSent(id: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE slack_outbox SET sent_at = now(), last_error = NULL WHERE id = ${id}`,
    );
  }

  /** 보내지 않기로 했다 — 받은 요청에서 이미 처리됐거나(`handled`) 연결이 없다(`disconnected`) */
  async markSkipped(id: string, reason: 'handled' | 'disconnected'): Promise<void> {
    await this.db.execute(
      sql`UPDATE slack_outbox SET skipped_at = now(), last_error = ${reason} WHERE id = ${id}`,
    );
  }

  /**
   * 못 보냈다. 다시 보내도 같은 것(4xx)은 바로 포기하고, 나머지는 상한까지 백오프로 다시 — `Retry-After` 가 있으면 그것을
   * 따른다. 포기한 줄은 지우지 않는다(왜 안 갔는지가 기록이다 · 화면의 「마지막 발송」이 보인다).
   */
  async markFailure(
    row: DueSlack,
    reason: string,
    opts: { permanent: boolean; afterSeconds: number | null },
  ): Promise<void> {
    const error = reason.slice(0, 500);
    if (opts.permanent || row.attempts >= SLACK_MAX_ATTEMPTS) {
      await this.db.execute(
        sql`UPDATE slack_outbox SET failed_at = now(), last_error = ${error} WHERE id = ${row.id}`,
      );
      this.logger.warn(`Slack 게시를 포기했다(${row.event_type} · ${row.attempts}회): ${error}`);
      return;
    }
    const seconds = opts.afterSeconds ?? backoffMinutes(row.attempts) * 60;
    await this.db.execute(sql`
      UPDATE slack_outbox SET last_error = ${error}, next_attempt_at = now() + make_interval(secs => ${seconds})
       WHERE id = ${row.id}
    `);
  }

  /** 저장된 웹훅의 원문 — 키가 없거나 연결이 없으면 null */
  async webhookOf(projectId: string): Promise<string | null> {
    const key = encryptionKeyFromEnv();
    if (key === null) return null;
    const { rows } = await this.db.execute<{ cipher: string }>(
      sql`SELECT webhook_cipher AS cipher FROM project_slack WHERE project_id = ${projectId}`,
    );
    const cipher = rows[0]?.cipher;
    return cipher === undefined ? null : open(cipher, key);
  }

  private async projectRef(projectId: string): Promise<SlackProjectRef | null> {
    const { rows } = await this.db.execute<{ name: string; slug: string; org: string }>(sql`
      SELECT p.name, p.slug, o.slug AS org FROM project p JOIN organization o ON o.id = p.org_id WHERE p.id = ${projectId}
    `);
    const row = rows[0];
    return row === undefined ? null : { name: row.name, slug: row.slug, orgSlug: row.org };
  }

  private requireKey(): Buffer {
    const key = encryptionKeyFromEnv();
    if (key === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.slack.disabled'), {
        kind: 'slack_disabled',
      });
    }
    return key;
  }

  private assertAdmin(actor: Actor, roles: readonly string[]): void {
    assertHuman(actor, 'project_admin', '/settings/integrations');
    if (!roles.includes('admin')) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.slack.admin_only'), {
        kind: 'role_required',
        required: ['admin'],
        actual: roles,
      });
    }
  }
}
