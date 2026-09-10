// E14-S02 — 백업·복구 왕복 (codebase.md §6.5 · REQ-CB-019 · 성공 기준 1-9)
//
// **복원이 끝난 것과 데이터가 온전한 것은 다르다.** 이 파일은 그 차이를 두 겹으로 확인한다:
//   ① 행 수 대조 — 통계 뷰가 아니라 실제 count(*) 다(복원 직후에는 통계가 비어 있어
//      "손실 0"과 "아직 세지 않았다"를 구분할 수 없다)
//   ② 기능 확인 — 복원본으로 스펙 조회·세션 보드가 실제로 돈다(REQ-CB-019 의 "동작하는 인스턴스")
//
// 스크립트(deploy/scripts/nerv-*.sh)와 같은 절차를 같은 순서로 태운다 — 문서의 절차가
// 진짜 도는지는 절차를 실행해봐야만 알 수 있다.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations, runSeed } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { createScratchDb, databaseUrl } from './helpers.js';
import type { ScratchDb } from './helpers.js';

// test/integration → apps/api → codebase → 저장소 루트 → deploy/scripts
const SCRIPTS = join(import.meta.dirname, '../../../../../deploy/scripts');
/**
 * pg 클라이언트가 **서버와 짝이 맞는가**. 안 맞으면 사유를 남기고 건너뛴다.
 *
 * 존재만 보던 검사였다. 그런데 `pg_dump` 는 자기보다 새 메이저의 서버를 거부하므로
 * (`aborting because of server version mismatch`), 러너에 구버전 클라이언트가 깔려 있으면
 * skip 이 아니라 **실패**가 됐다 — ubuntu-latest 의 pg16 클라이언트 × pgvector:pg17 서비스가
 * 정확히 그 조합이고, 그래서 L2 잡이 매번 붉었다(실측 2026-09-02).
 *
 * 건너뛰기는 **로컬 장비를 위한 것이지 CI 의 면제가 아니다** — CI 는 짝을 맞춘다
 * (.github/workflows/ci.yml 이 postgresql-client-18 을 설치한다).
 *
 * **서버 메이저를 올릴 때 이 줄을 같이 본다**(2026-09-10 · pg17 → pg18). 서버만 올리면
 * 이 검사가 실패가 아니라 조용한 skip 으로 바뀌어, 초록인데 REQ-CB-019 를 아무도
 * 검증하지 않는 상태가 된다 — 건너뛴 사유는 아래 console.warn 한 줄에만 남는다.
 */
function majorOf(text: string): number | null {
  const m = /(\d+)/.exec(text);
  return m === null ? null : Number(m[1]);
}

const PG_TOOLS: { ok: boolean; reason: string } = (() => {
  let client: number | null;
  try {
    client = majorOf(execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }));
  } catch {
    return { ok: false, reason: 'pg_dump 이 없다' };
  }
  let server: number | null;
  try {
    server = majorOf(
      execFileSync('psql', ['-tAc', 'SHOW server_version', databaseUrl()], { encoding: 'utf8' }),
    );
  } catch {
    return { ok: false, reason: 'psql 로 서버 버전을 읽지 못했다' };
  }
  if (client === null || server === null) return { ok: false, reason: '버전 문자열을 읽지 못했다' };
  if (client < server) {
    return { ok: false, reason: `pg_dump ${client} 는 서버 ${server} 를 덤프하지 못한다` };
  }
  return { ok: true, reason: '' };
})();

const HAS_PG_TOOLS = PG_TOOLS.ok;
if (!HAS_PG_TOOLS) {
  // 건너뛴 이유를 남기지 않으면 "통과" 로 읽힌다
  console.warn(`[restore-roundtrip] 건너뜀 — ${PG_TOOLS.reason}`);
}

let source: ScratchDb;
let restored: ScratchDb;
let backupDir: string;
let dumpPath: string;
let app: NestFastifyApplication | null = null;

beforeAll(async () => {
  if (!HAS_PG_TOOLS) return;
  source = await createScratchDb('nerv_bk_src');
  restored = await createScratchDb('nerv_bk_dst');
  await runMigrations(source.url);
  await runSeed(source.url);
  backupDir = mkdtempSync(join(tmpdir(), 'nerv-backup-'));
}, 120_000);

afterAll(async () => {
  if (!HAS_PG_TOOLS) return;
  if (app !== null) await app.close();
  await source.drop();
  await restored.drop();
});

describe.skipIf(!HAS_PG_TOOLS)('①~⑤ 절차', () => {
  it('① 백업 — 덤프가 만들어지고 읽힌다(목록 확인까지)', () => {
    // 이 왕복이 보는 것은 Postgres 다 — 첨부는 `mc` 가 있어야 하고 CI 러너에는 없다.
    // **명시적으로 건너뛴다**(REQ-CB-031): 우회가 있다는 사실 자체를 검사가 쓴다.
    const out = execFileSync('bash', [join(SCRIPTS, 'nerv-backup.sh')], {
      env: {
        ...process.env,
        DATABASE_URL: source.url,
        NERV_BACKUP_DIR: backupDir,
        NERV_BACKUP_SKIP_BLOBS: '1',
      },
      encoding: 'utf8',
    });
    expect(out).toContain('backup:');
    const dumps = readdirSync(backupDir).filter((f) => f.endsWith('.dump'));
    expect(dumps).toHaveLength(1);
    dumpPath = join(backupDir, dumps[0]!);
  });

  it('②·⑤ 복원 + 정합 검증 — 데이터 손실 0', () => {
    const out = execFileSync('bash', [join(SCRIPTS, 'nerv-restore.sh'), dumpPath, source.url], {
      env: { ...process.env, DATABASE_URL: restored.url },
      encoding: 'utf8',
    });
    expect(out).toContain('정합 검증 통과');
  });

  it('마이그레이션 재적용이 멱등이다 — 백업 이후 릴리스를 따라잡는 단계', async () => {
    const result = await runMigrations(restored.url);
    expect(result.applied).toBeGreaterThan(0);
  });

  it('④ 복원본이 동작하는 인스턴스다 — 스펙 조회·세션 보드가 실제로 돈다', async () => {
    process.env['DATABASE_URL'] = restored.url;
    process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const pool = new pg.Pool({ connectionString: restored.url });
    const { rows } = await pool.query<{ project_id: string; user_id: string; slug: string }>(
      `SELECT p.id AS project_id, u.id AS user_id, p.slug
         FROM project p JOIN membership m ON m.project_id = p.id JOIN "user" u ON u.id = m.user_id
        LIMIT 1`,
    );
    await pool.end();
    const seedRow = rows[0];
    expect(seedRow).toBeDefined();

    const { AuthService } = await import('../../src/modules/auth/auth.service.js');
    const { token } = await app.get(AuthService).issueToken({
      projectId: seedRow!.project_id,
      userId: seedRow!.user_id,
      name: 'restore-check',
      scopes: ['spec:read'],
    });

    const tree = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${seedRow!.slug}/specs/tree`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(tree.statusCode).toBe(200);
    expect((tree.json() as unknown[]).length).toBeGreaterThan(0);

    const sessions = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${seedRow!.slug}/sessions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(sessions.statusCode).toBe(200);
    expect(NERV_ERROR.PRECONDITION).toBeDefined();
    expect(newId()).toBeDefined();
  }, 60_000);

  it('임베딩 인덱스는 복원되지 않아도 무방하다 — 재임베딩으로 재생성한다 (4.3 §2.15)', async () => {
    const pool = new pg.Pool({ connectionString: restored.url });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spec_chunk_embedding`,
    );
    await pool.end();
    expect(rows[0]?.n).toBe(0);
  });
});
