// 알림 메일 요약 — 켠 사람에게 하루 한 번 (2026-09-28 · 사람 결정 EM1~EM9 · api.md REQ-API-232 · REQ-DB-034)
//
// 무엇을 담는지가 이 기능의 전부다. 안 읽은 것 가운데 지난 요약 뒤에 새로 생기거나 건수가 늘어난 줄만 —
// 읽은 것 · 켜기 전의 것 · 보관한 프로젝트 · 멤버에서 빠진 프로젝트는 담지 않는다. 그리고 하루 한 통이다.

import { createHash } from 'node:crypto';
import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NervDb } from '../../src/common/database.module.js';
import { DigestService } from '../../src/modules/digest/digest.service.js';
import { MailOutbox } from '../../src/modules/mail/mail.outbox.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let digests: DigestService;
let userId: string;
let actorId: string;
let orgId: string;
let projectId: string;
let archivedProjectId: string;
let otherProjectId: string;
/** 결정 대기 수 — 받은 요청의 판정은 그 서비스의 스위트가 본다. 여기서는 그 값을 메일이 옮겨 적는지만 본다 */
let pending = 0;

beforeAll(async () => {
  db = await createScratchDb('nerv_digest');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const orm = drizzle(pool) as unknown as NervDb;
  digests = new DigestService(orm, new MailOutbox(orm), {
    inboxGlobal: async () => ({
      items: [],
      next_cursor: null,
      total: pending,
      actionable_total: pending,
    }),
  } as never);
  process.env['NERV_MAIL_HOST'] = 'mailpit';
  process.env['NERV_MAIL_FROM'] = 'NERV <no-reply@example.com>';
  process.env['NERV_WEB_URL'] = 'https://app.nerv.test';
  process.env['NERV_API_URL'] = 'https://api.nerv.test';

  orgId = newId();
  userId = newId();
  actorId = newId();
  projectId = newId();
  archivedProjectId = newId();
  otherProjectId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','에이크미')`, [
    orgId,
  ]);
  for (const [id, email, name] of [
    [userId, 'jimin@mail.test', '지민'],
    [actorId, 'minseo@mail.test', '민서'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  for (const [id, slug, archived] of [
    [projectId, 'webchat', false],
    [archivedProjectId, 'old', true],
    [otherProjectId, 'other', false],
  ] as const) {
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name, archived_at)
       VALUES ($1,$2,$3,upper($3),$3, ${archived ? 'now()' : 'NULL'})`,
      [id, orgId, slug],
    );
  }
  // 지민은 webchat · old 의 멤버다. other 에서는 빠졌다(알림 행은 남아 있다)
  for (const p of [projectId, archivedProjectId]) {
    await pool.query(
      `INSERT INTO membership (id, user_id, org_id, project_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), userId, orgId, p],
    );
  }
});

afterAll(async () => {
  delete process.env['NERV_MAIL_HOST'];
  delete process.env['NERV_MAIL_FROM'];
  delete process.env['NERV_WEB_URL'];
  delete process.env['NERV_API_URL'];
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  pending = 0;
  await pool.query('DELETE FROM email_outbox');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM notification_digest_setting');
});

/** 켜 둔다 — 시(時)는 0 이라 언제나 "지났다", 켠 때는 하루 전이다 */
async function enable(): Promise<void> {
  await digests.set({ userId, enabled: true, hour: 0, timezone: 'UTC', locale: 'ko' });
  await pool.query(
    `UPDATE notification_digest_setting SET enabled_at = now() - interval '1 day' WHERE user_id = $1`,
    [userId],
  );
}

/** 알림 한 줄 — 스펙을 대상으로 한 이벤트와 함께 */
async function notify(input: {
  project?: string;
  type?: string;
  importance?: 'immediate' | 'digest';
  state?: 'unread' | 'read';
  batchSize?: number;
  lastAt?: string;
  specKey?: string;
}): Promise<string> {
  const project = input.project ?? projectId;
  const specId = newId();
  const eventId = newId();
  const id = newId();
  const key = input.specKey ?? `CLV-S-${id.slice(-6).toUpperCase()}`;
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$4)`,
    [specId, project, key, `문서 ${key}`],
  );
  await pool.query(
    `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, occurred_at)
     VALUES ($1,$2,$3,'spec',$4,$5, now())`,
    [eventId, project, input.type ?? NERV_EVENT.SPEC_RECHECK_REQUESTED, specId, actorId],
  );
  await pool.query(
    `INSERT INTO notification (id, project_id, user_id, event_id, importance, state, batch_size, last_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, ${input.lastAt ?? 'now()'})`,
    [
      id,
      project,
      userId,
      eventId,
      input.importance ?? 'digest',
      input.state ?? 'unread',
      input.batchSize ?? 1,
    ],
  );
  return id;
}

async function mails(): Promise<{ subject: string; body_text: string; locale: string }[]> {
  const { rows } = await pool.query<{ subject: string; body_text: string; locale: string }>(
    `SELECT subject, body_text, locale FROM email_outbox
      WHERE kind = 'notification_digest' AND to_email = 'jimin@mail.test'`,
  );
  return rows;
}

describe('설정 (EP-NTF-07 · 08)', () => {
  it('기본은 꺼짐이고, 켜면 시간대 · 언어 · 시를 저장한다 — 끄면 행을 지운다', async () => {
    expect(await digests.get(userId)).toMatchObject({
      enabled: false,
      hour: 9,
      mail_enabled: true,
    });
    const on = await digests.set({
      userId,
      enabled: true,
      timezone: 'Asia/Seoul',
      locale: 'en',
    });
    expect(on).toMatchObject({ enabled: true, hour: 9, timezone: 'Asia/Seoul', locale: 'en' });
    const off = await digests.set({ userId, enabled: false });
    expect(off.enabled).toBe(false);
  });

  it('없는 시간대 · 모르는 언어는 400 이고, 처음 켤 때 시간대가 없으면 무엇이 없는지 말한다', async () => {
    await expect(
      digests.set({ userId, enabled: true, timezone: 'Mars/Olympus', locale: 'ko' }),
    ).rejects.toMatchObject({ details: { kind: 'invalid_input', field: 'timezone' } });
    await expect(
      digests.set({ userId, enabled: true, timezone: 'UTC', locale: 'fr' }),
    ).rejects.toMatchObject({ details: { kind: 'invalid_input', field: 'locale' } });
    await expect(digests.set({ userId, enabled: true, locale: 'ko' })).rejects.toMatchObject({
      details: { kind: 'invalid_input', missing: ['timezone'] },
    });
  });

  it('메일을 보내지 않는 서버에서는 켤 수 없다 — 받는 줄 알고 기다리게 두지 않는다', async () => {
    delete process.env['NERV_MAIL_HOST'];
    try {
      await expect(
        digests.set({ userId, enabled: true, timezone: 'UTC', locale: 'ko' }),
      ).rejects.toMatchObject({ details: { kind: 'mail_disabled' } });
      expect((await digests.get(userId)).mail_enabled).toBe(false);
    } finally {
      process.env['NERV_MAIL_HOST'] = 'mailpit';
    }
  });
});

describe('무엇을 담는가 (REQ-API-232)', () => {
  it('안 읽은 새 줄만 담는다 — 읽은 것 · 켜기 전 · 보관한 프로젝트 · 빠진 프로젝트는 뺀다', async () => {
    await enable();
    pending = 2;
    const important = await notify({
      type: NERV_EVENT.APPROVAL_REQUESTED,
      importance: 'immediate',
      specKey: 'CLV-S-IMPORT',
    });
    const grouped = await notify({ batchSize: 3, specKey: 'CLV-S-GROUPD' });
    await notify({ state: 'read', specKey: 'CLV-S-READ01' });
    await notify({ lastAt: `now() - interval '2 days'`, specKey: 'CLV-S-BEFORE' });
    await notify({ project: archivedProjectId, specKey: 'CLV-S-ARCHIV' });
    await notify({ project: otherProjectId, specKey: 'CLV-S-OTHERP' });

    expect(await digests.sendDue()).toEqual({ checked: 1, sent: 1 });
    const [mail] = await mails();
    expect(mail?.locale).toBe('ko');
    expect(mail?.subject).toBe('[NERV] 알림 2건 · 결정 대기 2건');
    const body = mail?.body_text ?? '';
    expect(body).toContain('지민 님');
    expect(body).toContain('결정을 기다리는 받은 요청이 2건 있습니다.');
    expect(body).toContain('https://app.nerv.test/inbox');
    expect(body).toContain('■ 에이크미 · webchat');
    expect(body).toContain('[중요] CLV-S-IMPORT 문서 CLV-S-IMPORT — 승인 요청 · 민서');
    expect(body).toContain('CLV-S-GROUPD 문서 CLV-S-GROUPD — 참조 문서 재확인 요청 · 민서 ×3');
    expect(body).toContain('https://app.nerv.test/settings/account?tab=notifications');
    for (const hidden of ['CLV-S-READ01', 'CLV-S-BEFORE', 'CLV-S-ARCHIV', 'CLV-S-OTHERP']) {
      expect(body, hidden).not.toContain(hidden);
    }
    // 중요가 보통보다 먼저다
    expect(body.indexOf('CLV-S-IMPORT')).toBeLessThan(body.indexOf('CLV-S-GROUPD'));

    const { rows } = await pool.query<{ id: string; delivered: boolean; state: string }>(
      `SELECT id, delivered_at IS NOT NULL AND digest_batch_id IS NOT NULL AS delivered, state::text AS state
         FROM notification WHERE id = ANY($1::uuid[])`,
      [[important, grouped]],
    );
    // 메일을 보냈다고 읽음이 되지 않는다 — 배지는 앱에서 본 것만 줄어야 한다
    expect(rows.every((r) => r.delivered && r.state === 'unread')).toBe(true);
  });

  it('하루 한 통이다 — 같은 날 다시 돌아도 보내지 않고, 다음 날에는 늘어난 묶음만 다시 담는다', async () => {
    await enable();
    const grouped = await notify({ batchSize: 2, specKey: 'CLV-S-AGAIN1' });
    await notify({ specKey: 'CLV-S-QUIET1' });
    expect((await digests.sendDue()).sent).toBe(1);
    expect(await digests.sendDue()).toEqual({ checked: 0, sent: 0 });

    // 다음 날 — 한 줄만 건수가 늘었다
    await pool.query(
      `UPDATE notification_digest_setting SET last_sent_at = now() - interval '1 day' WHERE user_id = $1`,
      [userId],
    );
    await pool.query(
      `UPDATE notification SET batch_size = 4, last_at = now() + interval '1 second' WHERE id = $1`,
      [grouped],
    );
    expect((await digests.sendDue()).sent).toBe(1);
    const all = await mails();
    expect(all).toHaveLength(2);
    const second = all.find((m) => m.body_text.includes('×4'))?.body_text ?? '';
    expect(second).toContain('CLV-S-AGAIN1');
    expect(second).not.toContain('CLV-S-QUIET1');
  });

  it('담을 것이 없으면 보내지 않지만 오늘의 판정은 끝낸다', async () => {
    await enable();
    pending = 5;
    expect(await digests.sendDue()).toEqual({ checked: 1, sent: 0 });
    expect(await mails()).toHaveLength(0);
    expect(await digests.sendDue()).toEqual({ checked: 0, sent: 0 });
  });

  it('줄이 많으면 20줄까지 적고 나머지는 "그 밖에 N건" 으로 알림 화면에 보낸다', async () => {
    await enable();
    for (let i = 0; i < 23; i += 1)
      await notify({ specKey: `CLV-S-MANY${String(i).padStart(2, '0')}` });
    await digests.sendDue();
    const [mail] = await mails();
    expect(mail?.body_text.match(/^- /gm)).toHaveLength(20);
    expect(mail?.body_text).toContain(
      '그 밖에 3건이 더 있습니다: https://app.nerv.test/notifications',
    );
  });

  it('정한 시가 아직 오지 않았으면 보내지 않는다 — 현지 시각으로 본다', async () => {
    await enable();
    // 지금 UTC 시각보다 한 시간 뒤 — 자정 직전이면 판정이 넘어가므로 그때는 이 검사를 건너뛴다
    const { rows } = await pool.query<{ h: number }>(
      `SELECT extract(hour FROM now() AT TIME ZONE 'UTC')::int AS h`,
    );
    const later = (rows[0]?.h ?? 0) + 1;
    if (later > 23) return;
    await pool.query(`UPDATE notification_digest_setting SET hour = $2 WHERE user_id = $1`, [
      userId,
      later,
    ]);
    await notify({ specKey: 'CLV-S-EARLY1' });
    expect(await digests.sendDue()).toEqual({ checked: 0, sent: 0 });
  });
});

describe('로그인 없이 끄는 링크 (EM8 · REQ-API-234 · REQ-DB-035)', () => {
  /** 한 통 보내고 그 메일의 토큰 원문을 본문에서 꺼낸다 — 원문은 메일에만 있다 */
  async function sendOneAndToken(): Promise<{
    token: string;
    row: { body_text: string; headers: Record<string, string>; unsubscribe_token_hash: string };
  }> {
    await enable();
    await notify({});
    await digests.sendDue();
    const { rows } = await pool.query<{
      body_text: string;
      headers: Record<string, string>;
      unsubscribe_token_hash: string;
    }>(`SELECT body_text, headers, unsubscribe_token_hash FROM email_outbox`);
    expect(rows).toHaveLength(1);
    const token = /\/unsubscribe\/([A-Za-z0-9_-]{43})\b/.exec(rows[0]!.body_text)?.[1];
    expect(token).toBeDefined();
    return { token: token!, row: rows[0]! };
  }

  it('메일마다 새 토큰 — 행에는 해시만 남고, 머리글은 한 번에 끄는 API 주소 · 본문은 화면 주소다', async () => {
    const { token, row } = await sendOneAndToken();
    expect(row.unsubscribe_token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.body_text).toContain(`https://app.nerv.test/unsubscribe/${token}`);
    expect(row.headers).toEqual({
      'List-Unsubscribe': `<https://api.nerv.test/api/v1/mail/unsubscribe/${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    });
  });

  it('토큰으로 끄면 그 사람의 메일 요약만 꺼진다 — 두 번 눌러도 같은 답이다', async () => {
    const { token } = await sendOneAndToken();
    await expect(digests.unsubscribe(token)).resolves.toEqual({ ok: true, unsubscribed: true });
    expect((await digests.get(userId)).enabled).toBe(false);
    await expect(digests.unsubscribe(token)).resolves.toEqual({ ok: true, unsubscribed: true });
  });

  it('모르는 토큰 · 지워진 메일의 토큰은 409 not_found — 켜 둔 설정은 그대로다', async () => {
    const { token } = await sendOneAndToken();
    await expect(digests.unsubscribe('x'.repeat(43))).rejects.toMatchObject({
      details: { kind: 'not_found' },
    });
    // 보낸 지 7일이 지나 보존 잡이 메일 행을 지웠다(REQ-DB-033) — 링크도 함께 죽는다
    await pool.query('DELETE FROM email_outbox');
    await expect(digests.unsubscribe(token)).rejects.toMatchObject({
      details: { kind: 'not_found' },
    });
    expect((await digests.get(userId)).enabled).toBe(true);
  });
});
