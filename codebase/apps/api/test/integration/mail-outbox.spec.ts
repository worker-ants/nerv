// 메일 아웃박스 — 2026-09-22 사람 결정 (database.md §2.17)
//
// **여기서 지키는 것은 큐의 성질이다.** 본문이 예쁜가는 L1 이 보고, 실제로 도착하는가는
// L3 가 Mailpit 에서 본다. L2 가 보는 것은 셋이다.
//   ① 초대와 메일이 **한 트랜잭션**에 들어간다 — 갈라지면 "보냈다" 가 거짓이 된다
//   ② 같은 줄을 **두 번 집지 않는다** — `FOR UPDATE SKIP LOCKED` 는 mock 으로 검증할 수
//      없다(규약 4: 동시성은 실제 DB 로만 판정한다)
//   ③ 실패는 뒤로 밀리고, 상한을 넘으면 **포기한 채로 남는다** — 지우면 왜 안 갔는지가 사라진다

import { MAIL_MAX_ATTEMPTS, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { InvitationService } from '../../src/modules/auth/invitation.service.js';
import { MailOutbox } from '../../src/modules/mail/mail.outbox.js';
import type { NervDb } from '../../src/common/database.module.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let orm: NervDb;
let outbox: MailOutbox;
let invitations: InvitationService;
let adminId: string;
let orgId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_mail');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  orm = drizzle(pool) as unknown as NervDb;
  outbox = new MailOutbox(orm);
  invitations = new InvitationService(orm, new AuthService(orm), outbox);
  // 메일이 꺼져 있으면 아무것도 줄 서지 않는다 — 이 스위트는 켜진 배치를 본다
  process.env['NERV_MAIL_HOST'] = 'mailpit';
  process.env['NERV_MAIL_FROM'] = 'NERV <no-reply@example.com>';
  await seed();
});

afterAll(async () => {
  delete process.env['NERV_MAIL_HOST'];
  delete process.env['NERV_MAIL_FROM'];
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_outbox');
  await pool.query('UPDATE invitation SET revoked_at = now() WHERE revoked_at IS NULL');
});

async function seed(): Promise<void> {
  orgId = newId();
  adminId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1, 'acme', '에이스')`, [
    orgId,
  ]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1, 'admin@example.com', '관리자', 'active')`,
    [adminId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1, $2, NULL, $3, 'admin')`,
    [newId(), orgId, adminId],
  );
}

const invite = (email = 'guest@example.com'): Promise<Record<string, unknown>> =>
  invitations.create({ actorUserId: adminId, orgSlug: 'acme', email, role: 'developer' } as never);

/** 아웃박스에 직접 한 줄 — 초대를 거치지 않고 큐의 성질만 볼 때 */
async function enqueueRaw(
  over: { nextAttemptAt?: string; attempts?: number } = {},
): Promise<string> {
  const id = newId();
  await orm.execute(sql`
    INSERT INTO email_outbox (id, kind, to_email, subject, body_text, attempts, next_attempt_at)
    VALUES (${id}, 'invite', 'a@example.com', 's', 'b', ${over.attempts ?? 0},
            now() - ${over.nextAttemptAt ?? '1 hour'}::interval)
  `);
  return id;
}

describe('초대와 메일은 한 트랜잭션이다 (EP-INV-01)', () => {
  it('초대를 만들면 같은 커밋에서 메일이 줄을 선다', async () => {
    const made = await invite();
    expect(made['queued']).toBe(true);
    const { rows } = await pool.query<{ kind: string; to_email: string; ref_id: string }>(
      `SELECT kind::text AS kind, to_email, ref_id FROM email_outbox`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('invite');
    expect(rows[0]?.to_email).toBe('guest@example.com');
    // 무엇 때문에 생긴 메일인지가 남는다 — 그래야 "이 초대를 보냈나" 에 답할 수 있다
    expect(rows[0]?.ref_id).toBe(String(made['id']));
  });

  it('본문에 수락 링크가 들어 있다 — 그것이 이 메일의 전부다', async () => {
    await invite();
    const { rows } = await pool.query<{ body_text: string; subject: string }>(
      `SELECT body_text, subject FROM email_outbox`,
    );
    expect(rows[0]?.body_text).toContain('/invite/');
    // 제목은 **누가 불렀는지**를 말한다 — 받는 사람이 스팸과 가르는 단서다
    expect(rows[0]?.subject).toContain('에이스');
  });

  it('메일이 꺼진 배치에서는 줄 서지 않는다 — 보낼 수 없는 줄을 쌓지 않는다', async () => {
    const saved = process.env['NERV_MAIL_HOST'];
    delete process.env['NERV_MAIL_HOST'];
    try {
      const made = await invite('other@example.com');
      // 초대 자체는 그대로 만들어진다 — 오늘의 [복사] 경로가 살아 있다
      expect(made['token']).toBeTruthy();
      expect(made['queued']).toBe(false);
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM email_outbox`,
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      process.env['NERV_MAIL_HOST'] = saved;
    }
  });
});

describe('큐를 집는 규칙', () => {
  it('때가 된 줄만 집는다 — 미래의 재시도는 건드리지 않는다', async () => {
    await enqueueRaw();
    await orm.execute(sql`
      INSERT INTO email_outbox (id, kind, to_email, subject, body_text, next_attempt_at)
      VALUES (${newId()}, 'invite', 'later@example.com', 's', 'b', now() + interval '1 hour')
    `);
    const due = await outbox.claimDue();
    expect(due.map((m) => m.to_email)).toEqual(['a@example.com']);
  });

  it('두 워커가 동시에 집어도 같은 줄이 두 번 나오지 않는다 (SKIP LOCKED)', async () => {
    // **이것이 mock 으로 검증할 수 없는 자리다.** 배포 중 파드가 겹치는 짧은 구간에도
    // 같은 초대 메일이 두 번 나가면 안 된다.
    for (let i = 0; i < 6; i += 1) await enqueueRaw();
    const [a, b] = await Promise.all([outbox.claimDue(3), outbox.claimDue(3)]);
    const ids = [...a, ...b].map((m) => m.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('집는 순간 뒤로 민다 — 보내는 동안 다음 틱이 같은 줄을 다시 집지 않는다', async () => {
    await enqueueRaw();
    await outbox.claimDue();
    expect(await outbox.claimDue()).toEqual([]);
  });

  it('보낸 줄과 포기한 줄은 다시 집히지 않는다', async () => {
    const sent = await enqueueRaw();
    const failed = await enqueueRaw();
    await orm.execute(sql`UPDATE email_outbox SET sent_at = now() WHERE id = ${sent}`);
    await orm.execute(sql`UPDATE email_outbox SET failed_at = now() WHERE id = ${failed}`);
    expect(await outbox.claimDue()).toEqual([]);
  });
});

describe('보냈다 · 못 보냈다', () => {
  it('보내면 초대에도 적힌다 — 보존 잡이 큐를 치워도 답이 남는다', async () => {
    const made = await invite();
    const [mail] = await outbox.claimDue();
    await outbox.markSent(mail!);
    const { rows } = await pool.query<{ last_sent_at: string | null }>(
      `SELECT last_sent_at FROM invitation WHERE id = $1`,
      [String(made['id'])],
    );
    expect(rows[0]?.last_sent_at).not.toBeNull();
  });

  it('실패하면 뒤로 밀리고 이유가 남는다', async () => {
    await enqueueRaw();
    const [mail] = await outbox.claimDue();
    await outbox.markFailure(mail!, 'ECONNREFUSED');
    const { rows } = await pool.query<{ last_error: string; future: boolean; failed: boolean }>(
      `SELECT last_error, next_attempt_at > now() AS future, failed_at IS NOT NULL AS failed
         FROM email_outbox`,
    );
    expect(rows[0]?.last_error).toBe('ECONNREFUSED');
    expect(rows[0]?.future).toBe(true);
    expect(rows[0]?.failed).toBe(false);
  });

  it('상한을 넘으면 포기하되 **지우지 않는다** — 왜 안 갔는지가 기록이다', async () => {
    await enqueueRaw({ attempts: MAIL_MAX_ATTEMPTS });
    const [mail] = await outbox.claimDue();
    await outbox.markFailure(mail!, 'mailbox unavailable');
    const { rows } = await pool.query<{ n: number; failed: boolean; last_error: string }>(
      `SELECT count(*)::int AS n, bool_or(failed_at IS NOT NULL) AS failed,
              max(last_error) AS last_error FROM email_outbox`,
    );
    expect(rows[0]?.n).toBe(1);
    expect(rows[0]?.failed).toBe(true);
    expect(rows[0]?.last_error).toContain('mailbox unavailable');
  });

  it('긴 오류는 잘라서 담는다 — 한 줄이 로그를 통째로 삼키지 않는다', async () => {
    await enqueueRaw();
    const [mail] = await outbox.claimDue();
    await outbox.markFailure(mail!, 'x'.repeat(5000));
    const { rows } = await pool.query<{ len: number }>(
      `SELECT length(last_error) AS len FROM email_outbox`,
    );
    expect(rows[0]?.len).toBe(500);
  });
});
