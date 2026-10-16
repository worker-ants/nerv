// git 커밋 미러 — 승인본 미러를 git 저장소에 커밋하고 원격이 있으면 push 한다 (2026-10-16 · Phase 2 E21-S02)
//
// codebase.md REQ-CB-062 · 063. 원격은 일회용 bare 저장소다. 미러 쪽 편집(원격에 NERV 가 만들지 않은 커밋)은 덮어쓰지 않고
// push 를 멈춘 채 `mirror.diverged` 로 경고한다 — roadmap §7.4 규칙 1 의 실물이다.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { BaselineService } from '../../src/modules/spec/baseline.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ExportJob } from '../../src/worker/jobs/export.job.js';
import { MirrorGitConfigError } from '../../src/worker/mirror-git.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let baselines: BaselineService;
let exporter: ExportJob;
let orgId: string;
let projectId: string;
let otherProjectId: string;
let adminId: string;

/** 이 스위트가 만지는 env — 끝나면 지운다 */
const ENV_KEYS = [
  'NERV_EXPORT_DIR',
  'NERV_MIRROR_GIT_REMOTE',
  'NERV_MIRROR_GIT_BRANCH',
  'NERV_MIRROR_GIT_AUTHOR',
];

beforeAll(async () => {
  db = await createScratchDb('nerv_mirror_git');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const drizzleDb = drizzle(pool);
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const events = new EventService(drizzleDb, silent);
  specs = new SpecService(
    events,
    new SpecCheckService(drizzleDb),
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    new AttachmentService(null as never, drizzleDb),
    drizzleDb,
  );
  baselines = new BaselineService(events, drizzleDb);
  exporter = new ExportJob(specs, baselines, events, drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

let root: string;
let remote: string;

beforeEach(async () => {
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  for (const key of ENV_KEYS) delete process.env[key];
  root = mkdtempSync(join(tmpdir(), 'nerv-mirror-'));
  remote = mkdtempSync(join(tmpdir(), 'nerv-mirror-remote-'));
  git(null, ['init', '--quiet', '--bare', remote]);
  process.env['NERV_EXPORT_DIR'] = root;
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  otherProjectId = newId();
  adminId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
    [adminId],
  );
  for (const [id, slug, key] of [
    [projectId, 'clemvion', 'CLV'],
    [otherProjectId, 'other', 'OTH'],
  ] as const) {
    await pool.query(`INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,$3)`, [
      id,
      orgId,
      slug,
      key,
    ]);
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
      [newId(), orgId, id, adminId],
    );
  }
}

/** 사람의 git — 작성자를 사람으로 둔다(미러 쪽 편집을 흉내 낸다) */
function git(cwd: string | null, args: string[]): string {
  const r = spawnSync('git', args, {
    cwd: cwd ?? undefined,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'human',
      GIT_AUTHOR_EMAIL: 'human@example.com',
      GIT_COMMITTER_NAME: 'human',
      GIT_COMMITTER_EMAIL: 'human@example.com',
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} — ${r.stderr}`);
  return r.stdout.trim();
}

const remoteHead = (): string => git(null, ['--git-dir', remote, 'rev-parse', 'refs/heads/main']);
const remoteSubjects = (): string[] =>
  git(null, ['--git-dir', remote, 'log', '--format=%s', 'refs/heads/main']).split('\n');
const localHead = (dir = root): string => git(dir, ['rev-parse', 'HEAD']);
const localSubjects = (dir = root): string[] => git(dir, ['log', '--format=%s']).split('\n');

/** 승인된 버전 하나 — 승인자는 admin(이름 「관리자」) */
async function approvedSpec(key: string, body: string): Promise<string> {
  const result = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId: adminId,
  });
  await pool.query(
    `UPDATE spec_version SET status='approved', approved_at=now(), approved_by_user_id=$2,
            edit_lease_user_id=NULL, edit_lease_session_id=NULL, edit_lease_expires_at=NULL
      WHERE id = $1`,
    [result['spec_version_id'], adminId],
  );
  await pool.query(`UPDATE spec SET current_version_id=$1 WHERE id=$2`, [
    result['spec_version_id'],
    result['spec_id'],
  ]);
  return String(result['spec_id']);
}

async function divergedEvents(project: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM event WHERE project_id = $1 AND type = $2 ORDER BY occurred_at`,
    [project, NERV_EVENT_PHASE2.MIRROR_DIVERGED],
  );
  return rows.map((r) => r.payload);
}

describe('미러 폴더는 git 저장소다 (REQ-CB-062)', () => {
  it('원격이 없으면 로컬 커밋까지만 한다 — 승인하면 커밋하고, 바뀐 것이 없으면 커밋하지 않는다', async () => {
    await approvedSpec('SPC-A', '# 문서 A\n\nREQ-AAA-001 WHEN 열면 THE SYSTEM SHALL 보인다');

    const first = await exporter.run();
    expect(first).toMatchObject({ committed: true, pushed: false, diverged: false });
    expect(localSubjects()).toEqual(['export(spec): SPC-A@v1 approved by 관리자']);
    // 작성자는 사람이 아니라 NERV 다(기본값 상수)
    expect(git(root, ['log', '-1', '--format=%an <%ae>'])).toBe('NERV <nerv@localhost>');
    expect(git(root, ['ls-files']).split('\n')).toEqual(
      expect.arrayContaining([
        'clemvion/llms.txt',
        'clemvion/manifest.json',
        'clemvion/requirements.tsv',
        'clemvion/specs/SPC-A.md',
        'other/llms.txt',
        'other/manifest.json',
        'other/requirements.tsv',
      ]),
    );

    // manifest.json 은 EP-SPEC-14 와 같은 함수 · 같은 내용이다
    const manifest = JSON.parse(readFileSync(join(root, 'clemvion/manifest.json'), 'utf8')) as {
      specs: Record<string, { version_no: number }>;
    };
    const api = await baselines.manifest({ projectId });
    expect(Object.keys(manifest.specs)).toEqual(Object.keys(api['specs'] as object));
    expect(manifest.specs['SPC-A']?.version_no).toBe(1);
    // requirements.tsv — 고정 ID · 스펙 · 구현 상태 · 증적 수
    const tsv = readFileSync(join(root, 'clemvion/requirements.tsv'), 'utf8').split('\n');
    expect(tsv[0]).toBe('ref\tspec\timpl_status\tevidence_count');

    const again = await exporter.run();
    expect(again).toMatchObject({ committed: false, pushed: false });
    expect(localSubjects()).toHaveLength(1);
  });

  it('보관한 문서의 파일은 미러에서 지운다 — 추적하지 않는 남의 파일은 건드리지 않는다', async () => {
    const specId = await approvedSpec('SPC-A', '# 문서 A');
    await exporter.run();
    writeFileSync(join(root, 'NOTES.txt'), '운영자가 둔 메모');

    await pool.query(`UPDATE spec SET archived_at = now() WHERE id = $1`, [specId]);
    const report = await exporter.run();

    expect(report.committed).toBe(true);
    expect(localSubjects()[0]).toBe('export(spec): refresh');
    expect(existsSync(join(root, 'clemvion/specs/SPC-A.md'))).toBe(false);
    expect(git(root, ['ls-files'])).not.toContain('clemvion/specs/SPC-A.md');
    expect(existsSync(join(root, 'NOTES.txt'))).toBe(true);
    expect(git(root, ['ls-files'])).not.toContain('NOTES.txt');
  });

  it('미러 폴더가 다른 저장소 안에 있어도 그 저장소에 커밋하지 않는다', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'nerv-mirror-parent-'));
    git(parent, ['init', '--quiet']);
    const nested = join(parent, 'mirror');
    process.env['NERV_EXPORT_DIR'] = nested;
    await approvedSpec('SPC-A', '# 문서 A');

    await exporter.run();

    expect(existsSync(join(nested, '.git'))).toBe(true);
    expect(localSubjects(nested)).toHaveLength(1);
    // 바깥 저장소에는 커밋이 없다
    const outer = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: parent });
    expect(outer.status).not.toBe(0);
  });

  it('설정이 틀리면 아무것도 쓰기 전에 실패한다 — 옵션으로 읽히는 원격 · 브랜치를 받지 않는다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = '--upload-pack=touch /tmp/nerv-pwn';
    await expect(exporter.run()).rejects.toBeInstanceOf(MirrorGitConfigError);
    delete process.env['NERV_MIRROR_GIT_REMOTE'];

    process.env['NERV_MIRROR_GIT_BRANCH'] = '-x';
    await expect(exporter.run()).rejects.toBeInstanceOf(MirrorGitConfigError);
    process.env['NERV_MIRROR_GIT_BRANCH'] = 'a..b';
    await expect(exporter.run()).rejects.toBeInstanceOf(MirrorGitConfigError);
    delete process.env['NERV_MIRROR_GIT_BRANCH'];

    process.env['NERV_MIRROR_GIT_AUTHOR'] = 'NERV';
    await expect(exporter.run()).rejects.toBeInstanceOf(MirrorGitConfigError);
    expect(existsSync(join(root, '.git'))).toBe(false);
  });
});

describe('원격이 있으면 push 한다 · 미러 쪽 편집은 받아들이지 않고 경고한다 (REQ-CB-063)', () => {
  it('승인하면 커밋하고 push 한다 — 바뀐 것이 없으면 push 도 없다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = remote;
    await approvedSpec('SPC-A', '# 문서 A');

    expect(await exporter.run()).toMatchObject({ committed: true, pushed: true });
    expect(remoteHead()).toBe(localHead());
    expect(remoteSubjects()).toEqual(['export(spec): SPC-A@v1 approved by 관리자']);

    await approvedSpec('SPC-B', '# 문서 B');
    expect(await exporter.run()).toMatchObject({ committed: true, pushed: true });
    expect(remoteSubjects()).toEqual([
      'export(spec): SPC-B@v1 approved by 관리자',
      'export(spec): SPC-A@v1 approved by 관리자',
    ]);

    expect(await exporter.run()).toMatchObject({ committed: false, pushed: false });
    expect(remoteHead()).toBe(localHead());
  });

  it('원격에 NERV 가 만들지 않은 커밋이 있으면 push 하지 않고 그 폴더의 프로젝트 admin 에게 한 번 경고한다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = remote;
    await approvedSpec('SPC-A', '# 문서 A');
    await exporter.run();
    const pushed = remoteHead();

    // 누군가 미러를 직접 고쳐 push 했다
    const human = mkdtempSync(join(tmpdir(), 'nerv-mirror-human-'));
    git(null, ['clone', '--quiet', '--branch', 'main', remote, human]);
    appendFileSync(join(human, 'clemvion/specs/SPC-A.md'), '\n미러에서 직접 고친 줄\n');
    git(human, ['commit', '--quiet', '-am', 'edit mirror by hand']);
    git(human, ['push', '--quiet', 'origin', 'HEAD:main']);
    const foreign = remoteHead();

    await approvedSpec('SPC-B', '# 문서 B');
    const report = await exporter.run();

    expect(report).toMatchObject({
      committed: true,
      pushed: false,
      diverged: true,
      divergence_warnings: 1,
    });
    // 덮어쓰지 않았다 — 원격은 사람의 커밋 그대로다
    expect(remoteHead()).toBe(foreign);
    // 받아들이지도 않았다 — 미러의 파일은 NERV 의 승인본이다
    expect(readFileSync(join(root, 'clemvion/specs/SPC-A.md'), 'utf8')).not.toContain(
      '미러에서 직접 고친 줄',
    );

    const [event] = await divergedEvents(projectId);
    expect(event).toMatchObject({
      branch: 'main',
      remote_head: foreign,
      local_head: localHead(),
      last_pushed: pushed,
      foreign_commits: 1,
      changed_files: 1,
    });
    // 원격 주소는 넣지 않는다(자격증명이 들어 있을 수 있다)
    expect(JSON.stringify(event)).not.toContain(remote);
    // 고친 폴더가 아닌 프로젝트에는 경고하지 않는다
    expect(await divergedEvents(otherProjectId)).toEqual([]);

    // admin 에게 중요 알림이 간다
    const notifications = new NotificationService(drizzle(pool));
    await notifications.route({ since: new Date(Date.now() - 3_600_000) });
    const { rows } = await pool.query<{ importance: string }>(
      `SELECT n.importance::text AS importance FROM notification n JOIN event e ON e.id = n.event_id
        WHERE n.user_id = $1 AND e.type = $2`,
      [adminId, NERV_EVENT_PHASE2.MIRROR_DIVERGED],
    );
    expect(rows).toEqual([{ importance: 'immediate' }]);

    // 같은 갈라짐은 다시 알리지 않는다 — 잡은 1시간마다 돈다
    expect(await exporter.run()).toMatchObject({ diverged: true, divergence_warnings: 0 });
    expect(await divergedEvents(projectId)).toHaveLength(1);

    // 원격을 NERV 가 마지막으로 push 한 커밋으로 되돌리면 다음 판에 이어서 push 한다
    git(null, ['--git-dir', remote, 'update-ref', 'refs/heads/main', pushed]);
    expect(await exporter.run()).toMatchObject({ pushed: true, diverged: false });
    expect(remoteHead()).toBe(localHead());
  });

  it('어느 프로젝트의 폴더도 아닌 편집이면 내보낸 프로젝트 전부에 경고한다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = remote;
    await exporter.run();

    const human = mkdtempSync(join(tmpdir(), 'nerv-mirror-human-'));
    git(null, ['clone', '--quiet', '--branch', 'main', remote, human]);
    writeFileSync(join(human, 'README.md'), '# 미러\n');
    git(human, ['add', 'README.md']);
    git(human, ['commit', '--quiet', '-m', 'add readme']);
    git(human, ['push', '--quiet', 'origin', 'HEAD:main']);

    await approvedSpec('SPC-A', '# 문서 A');
    const report = await exporter.run();

    expect(report).toMatchObject({ diverged: true, divergence_warnings: 2 });
    expect(await divergedEvents(projectId)).toHaveLength(1);
    expect(await divergedEvents(otherProjectId)).toHaveLength(1);
  });

  it('새 볼륨은 원격의 이력을 이어받는다 — 갈라지지 않고 이어서 push 한다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = remote;
    await approvedSpec('SPC-A', '# 문서 A');
    await exporter.run();
    const first = remoteHead();

    // 볼륨을 잃은 워커 — 빈 폴더에서 다시 시작한다
    const fresh = mkdtempSync(join(tmpdir(), 'nerv-mirror-fresh-'));
    process.env['NERV_EXPORT_DIR'] = fresh;
    await approvedSpec('SPC-B', '# 문서 B');
    const report = await exporter.run();

    expect(report).toMatchObject({ committed: true, pushed: true, diverged: false });
    expect(git(fresh, ['rev-parse', 'HEAD~1'])).toBe(first);
    expect(remoteHead()).toBe(localHead(fresh));
    expect(remoteSubjects()[0]).toBe('export(spec): SPC-B@v1 approved by 관리자');
  });
});
