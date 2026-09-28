// E14-S02 — 백업·복구 왕복 (codebase.md §6.5 · REQ-CB-019 · 성공 기준 1-9)
//
// **복원이 끝난 것과 데이터가 온전한 것은 다르다.** 이 파일은 그 차이를 두 겹으로 확인한다:
//   ① 행 수 대조 — 통계 뷰가 아니라 실제 count(*) 다(복원 직후에는 통계가 비어 있어
//      "손실 0"과 "아직 세지 않았다"를 구분할 수 없다)
//   ② 기능 확인 — 복원본으로 스펙 조회·세션 보드가 실제로 돈다(REQ-CB-019 의 "동작하는 인스턴스")
//
// 스크립트(deploy/scripts/nerv-*.sh)와 같은 절차를 같은 순서로 태운다 — 문서의 절차가
// 진짜 도는지는 절차를 실행해봐야만 알 수 있다.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

/**
 * **면제를 말로만 두지 않는다.** 위 주석은 2026-09-02 부터 "CI 는 짝을 맞춘다" 고 적어 왔는데,
 * 실제로는 그날 이후 **한 번도 맞은 적이 없었다** — 러너에 `postgresql-client-17` 을 깔아도
 * PATH 의 `pg_dump` 는 선설치된 PG16 클러스터를 보는 래퍼(`pg_wrapper`)라 16 으로 남았다.
 * 그래서 이 스위트는 실패가 아니라 **조용한 skip** 이 됐고, 잡은 계속 초록이었다
 * (2026-09-10 실측 — main `feb94e1` 의 CI 로그에도 `pg_dump 16 는 서버 17 를…` 이 남아 있다).
 *
 * 초록인데 REQ-CB-019 를 아무도 검증하지 않는 상태가 **여드레** 갔다. 그 침묵을 없앤다:
 * `NERV_REQUIRE_PG_TOOLS=1` 인 환경(CI)에서는 건너뛰기가 곧 실패다. 로컬 장비는 그대로 건너뛴다.
 */
if (!HAS_PG_TOOLS && process.env['NERV_REQUIRE_PG_TOOLS'] === '1') {
  throw new Error(
    `[restore-roundtrip] ${PG_TOOLS.reason} — NERV_REQUIRE_PG_TOOLS=1 에서는 건너뛰지 않는다. ` +
      '서버와 짝이 맞는 클라이언트를 PATH 에 올린다(.github/workflows/ci.yml · REQ-CB-019).',
  );
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

// ── 첨부 왕복 (2026-09-28 · REQ-CB-031 · REQ-CB-059 · REQ-CB-060) ─────────────────────
//
// 위 왕복은 `NERV_BACKUP_SKIP_BLOBS=1` 로 첨부를 건너뛴다 — 러너에 S3 도 `mc` 도 없었다.
// 그래서 "첨부는 재생성되지 않는다"(§6.5)는 문장을 지키는 백업·복원이 **한 번도 실제로
// 돌지 않았다.** 여기서는 진짜 오브젝트 스토리지와 `mc` 로 돈다. CI 는 둘을 띄우고
// `NERV_REQUIRE_BLOB_TOOLS=1` 로 건너뛰기를 실패로 바꾼다 — 위의 pg 도구와 같은 규율이다.
//
// 스토리지 주소는 **시험 전용 이름**(`NERV_TEST_S3_*`)으로 받는다. `NERV_S3_*` 를 L2 전체에
// 걸면 스토리지가 없다고 전제한 다른 스위트까지 스토리지를 보게 된다.

const BLOB = {
  endpoint: (process.env['NERV_TEST_S3_ENDPOINT'] ?? '').trim(),
  accessKey: (process.env['NERV_TEST_S3_ACCESS_KEY'] ?? '').trim(),
  secretKey: (process.env['NERV_TEST_S3_SECRET_KEY'] ?? '').trim(),
};

const BLOB_TOOLS: { ok: boolean; reason: string } = (() => {
  if (!HAS_PG_TOOLS) return { ok: false, reason: PG_TOOLS.reason };
  if (BLOB.endpoint === '') return { ok: false, reason: 'NERV_TEST_S3_ENDPOINT 가 없다' };
  try {
    // 개발 장비의 `mc` 는 Midnight Commander 일 수도 있다 — 판 이름으로 가려낸다
    const version = execFileSync('mc', ['--version'], { encoding: 'utf8' });
    if (!/RELEASE\./.test(version))
      return { ok: false, reason: 'PATH 의 mc 가 MinIO 클라이언트가 아니다' };
  } catch {
    return { ok: false, reason: 'mc 가 없다' };
  }
  return { ok: true, reason: '' };
})();

if (!BLOB_TOOLS.ok) console.warn(`[restore-roundtrip] 첨부 왕복 건너뜀 — ${BLOB_TOOLS.reason}`);
if (!BLOB_TOOLS.ok && process.env['NERV_REQUIRE_BLOB_TOOLS'] === '1') {
  throw new Error(
    `[restore-roundtrip] 첨부 왕복 — ${BLOB_TOOLS.reason}. NERV_REQUIRE_BLOB_TOOLS=1 에서는 건너뛰지 않는다 ` +
      '(.github/workflows/ci.yml 이 스토리지와 mc 를 띄운다 · REQ-CB-060).',
  );
}

describe.skipIf(!BLOB_TOOLS.ok)('첨부 왕복 — 파일까지 돌아오는가 (REQ-CB-059 · REQ-CB-060)', () => {
  const suffix = randomUUID().slice(0, 8);
  const srcBucket = `nerv-bk-src-${suffix}`;
  const dstBucket = `nerv-bk-dst-${suffix}`;
  const s3 = new S3Client({
    endpoint: BLOB.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: BLOB.accessKey, secretAccessKey: BLOB.secretKey },
  });
  /** 확정된 첨부 둘의 실물 — 키는 서버와 같은 모양(`{project}/{spec}/{id}.{ext}`)이다 */
  const files = new Map<string, Buffer>();
  let src: ScratchDb;
  /** 복원할 때마다 새 DB 다 — §6.5 ① 은 새 Postgres 에 복원하고, 이미 복원한 DB 위의
   *  `--clean` 복원은 파티션 제약을 지우지 못해 실패한다(2026-09-28 실측) */
  const dsts: ScratchDb[] = [];
  let dir: string;
  let mcConfig: string;
  let dump: string;

  function envFor(databaseUrl: string, bucket: string, extra: Record<string, string> = {}) {
    return {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NERV_S3_ENDPOINT: BLOB.endpoint,
      NERV_S3_ACCESS_KEY: BLOB.accessKey,
      NERV_S3_SECRET_KEY: BLOB.secretKey,
      NERV_S3_BUCKET: bucket,
      MC_CONFIG_DIR: mcConfig,
      ...extra,
    };
  }

  /** 스크립트를 돌리고 종료 코드와 출력을 받는다 — 실패도 결과로 본다 */
  function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
    const r = spawnSync('bash', [join(SCRIPTS, script), ...args], { env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  async function put(bucket: string, key: string, body: Buffer): Promise<void> {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  }

  async function read(bucket: string, key: string): Promise<Buffer> {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  beforeAll(async () => {
    src = await createScratchDb('nerv_bkb_src');
    await runMigrations(src.url);
    dir = mkdtempSync(join(tmpdir(), 'nerv-backup-blobs-'));
    mcConfig = mkdtempSync(join(tmpdir(), 'nerv-mc-'));

    const pool = new pg.Pool({ connectionString: src.url });
    const [orgId, userId, projectId, specId] = [newId(), newId(), newId(), newId()];
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'o','O')`, [orgId]);
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'bk@b.c','백업','active')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'p','P','p')`,
      [projectId, orgId],
    );
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'design','SPC-BK','시안')`,
      [specId, projectId],
    );
    for (const [name, committed] of [
      ['시안-1.png', true],
      ['시안-2.png', true],
      ['올리다-만.png', false],
    ] as const) {
      const id = newId();
      const key = `${projectId}/${specId}/${id}.png`;
      await pool.query(
        `INSERT INTO attachment (id, project_id, spec_id, storage_key, filename, content_type, bytes,
                                 checksum, uploaded_by_user_id, committed_at)
         VALUES ($1,$2,$3,$4,$5,'image/png',4,'x',$6, ${committed ? 'now()' : 'NULL'})`,
        [id, projectId, specId, key, name, userId],
      );
      if (committed) files.set(key, Buffer.from(`PNG:${name}`));
    }
    await pool.end();

    await s3.send(new CreateBucketCommand({ Bucket: srcBucket }));
    await s3.send(new CreateBucketCommand({ Bucket: dstBucket }));
    for (const [key, body] of files) await put(srcBucket, key, body);
    // 버킷에는 첨부 말고도 리뷰 프롬프트 blob 이 산다 — 파일 수가 증거가 아닌 이유다
    await put(srcBucket, 'review-prompts/p-1.txt', Buffer.from('prompt'));
  }, 120_000);

  afterAll(async () => {
    for (const bucket of [srcBucket, dstBucket]) {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
      for (const o of listed.Contents ?? [])
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key! }));
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    await src.drop();
    for (const db of dsts) await db.drop();
  });

  async function freshDst(): Promise<string> {
    const db = await createScratchDb('nerv_bkb_dst');
    dsts.push(db);
    return db.url;
  }

  it('백업이 버킷을 미러하고, DB 가 가리키는 파일을 하나씩 확인한다', () => {
    const r = run('nerv-backup.sh', [], envFor(src.url, srcBucket, { NERV_BACKUP_DIR: dir }));
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('첨부 3개');
    for (const [key, body] of files) expect(readFileSync(join(dir, 'blobs', key))).toEqual(body);
    dump = join(
      dir,
      readdirSync(dir).find((f) => f.endsWith('.dump'))!,
    );
  });

  it('버킷의 수만 맞고 키가 없으면 복원 검증이 실패한다 — 개수는 증거가 아니다', async () => {
    // 예전 검증은 "오브젝트 수 ≥ 첨부 행 수" 였다 — 이 버킷은 그 검사를 통과한다
    for (const name of ['a', 'b', 'c'])
      await put(dstBucket, `review-prompts/${name}.txt`, Buffer.from(name));

    const r = run('nerv-restore.sh', [dump, src.url], envFor(await freshDst(), dstBucket));
    expect(r.code, r.err).toBe(1);
    expect(r.err).toContain('2건이 버킷');
    expect(r.err).toContain([...files.keys()][0]);
    expect(r.out).not.toContain('정합 검증 통과');
  });

  it('백업의 파일을 되돌리면 통과한다 — 바이트까지 같다 (§6.5 ③)', async () => {
    const r = run(
      'nerv-restore.sh',
      [dump, src.url],
      envFor(await freshDst(), dstBucket, { NERV_RESTORE_BLOBS_DIR: join(dir, 'blobs') }),
    );
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('되돌렸습니다');
    expect(r.out).toContain('DB 2건이 모두 버킷');
    expect(r.out).toContain('정합 검증 통과');
    for (const [key, body] of files) expect(await read(dstBucket, key)).toEqual(body);
  });

  it('확인할 수단이 없으면 손실 0 을 말하지 않는다 — 건너뛰기는 명시할 때만', async () => {
    const blind = run(
      'nerv-restore.sh',
      [dump, src.url],
      envFor(await freshDst(), dstBucket, { NERV_S3_ENDPOINT: '' }),
    );
    expect(blind.code, blind.err).toBe(2);
    expect(blind.err).toContain('확인할 수단이 없습니다');
    expect(blind.out).not.toContain('정합 검증 통과');

    const skipped = run(
      'nerv-restore.sh',
      [dump, src.url],
      envFor(await freshDst(), dstBucket, { NERV_S3_ENDPOINT: '', NERV_RESTORE_SKIP_BLOBS: '1' }),
    );
    expect(skipped.code).toBe(0);
    expect(skipped.err).toContain('확인하지 않았습니다');
  });

  it('버킷에서 이미 잃은 첨부는 백업이 종료 코드로 알린다 — 덤프는 남긴다', async () => {
    const [lost] = [...files.keys()];
    await s3.send(new DeleteObjectCommand({ Bucket: srcBucket, Key: lost! }));
    const before = readdirSync(dir).filter((f) => f.endsWith('.dump')).length;

    const r = run('nerv-backup.sh', [], envFor(src.url, srcBucket, { NERV_BACKUP_DIR: dir }));
    expect(r.code).toBe(3);
    expect(r.err).toContain('1건의 파일이 버킷에 없습니다');
    expect(r.err).toContain(lost);
    expect(readdirSync(dir).filter((f) => f.endsWith('.dump')).length).toBeGreaterThanOrEqual(
      before,
    );
  });
});
