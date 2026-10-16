// git 커밋 미러 — 승인본 미러를 git 저장소에 커밋하고 원격이 있으면 push 한다 (2026-10-16 · Phase 2 E21-S02)
//
// codebase.md REQ-CB-062 · 063. 원격은 일회용 bare 저장소다. 미러 쪽 편집(원격에 NERV 가 만들지 않은 커밋)은 덮어쓰지 않고
// push 를 멈춘 채 `mirror.diverged` 로 경고한다 — roadmap §7.4 규칙 1 의 실물이다.
//
// 프로젝트 폴더는 `<조직>/<프로젝트>` 다(2026-10-16). 시드에 **조직이 다른 같은 slug**(`nerv/clemvion` · `acme/clemvion`)를
// 늘 둔다 — 프로젝트 slug 는 조직 안에서만 유일해서, slug 만 폴더로 쓰면 둘이 한 폴더에 써서 서로 덮었다.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
/** 다른 조직(`acme`)의 같은 slug(`clemvion`) 프로젝트 */
let twinProjectId: string;
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
  const twinOrgId = newId();
  projectId = newId();
  otherProjectId = newId();
  twinProjectId = newId();
  adminId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','ACME')`, [
    twinOrgId,
  ]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
    [adminId],
  );
  for (const [id, org, slug, key, name] of [
    [projectId, orgId, 'clemvion', 'CLV', 'clemvion'],
    [otherProjectId, orgId, 'other', 'OTH', 'other'],
    [twinProjectId, twinOrgId, 'clemvion', 'CLV', 'ACME clemvion'],
  ] as const) {
    await pool.query(`INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,$5)`, [
      id,
      org,
      slug,
      key,
      name,
    ]);
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
      [newId(), org, id, adminId],
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
async function approvedSpec(key: string, body: string, project = projectId): Promise<string> {
  const result = await specs.draftUpsert({
    roles: ['planner'],
    projectId: project,
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
        'nerv/clemvion/llms.txt',
        'nerv/clemvion/manifest.json',
        'nerv/clemvion/requirements.tsv',
        'nerv/clemvion/specs/SPC-A.md',
        'nerv/other/llms.txt',
        'nerv/other/manifest.json',
        'nerv/other/requirements.tsv',
        'acme/clemvion/llms.txt',
        'acme/clemvion/manifest.json',
        'acme/clemvion/requirements.tsv',
      ]),
    );

    // manifest.json 은 EP-SPEC-14 와 같은 함수 · 같은 내용이다
    const manifest = JSON.parse(
      readFileSync(join(root, 'nerv/clemvion/manifest.json'), 'utf8'),
    ) as {
      specs: Record<string, { version_no: number }>;
    };
    const api = await baselines.manifest({ projectId });
    expect(Object.keys(manifest.specs)).toEqual(Object.keys(api['specs'] as object));
    expect(manifest.specs['SPC-A']?.version_no).toBe(1);
    // requirements.tsv — 고정 ID · 스펙 · 구현 상태 · 증적 수
    const tsv = readFileSync(join(root, 'nerv/clemvion/requirements.tsv'), 'utf8').split('\n');
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
    expect(existsSync(join(root, 'nerv/clemvion/specs/SPC-A.md'))).toBe(false);
    expect(git(root, ['ls-files'])).not.toContain('nerv/clemvion/specs/SPC-A.md');
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

describe('프로젝트 폴더는 <조직>/<프로젝트> 다 — 조직이 다른 같은 slug 가 겹치지 않는다 (REQ-CB-062)', () => {
  it('두 조직의 같은 slug 프로젝트는 서로 다른 폴더에 쓰고 서로 덮지 않는다', async () => {
    await approvedSpec('SPC-A', '# NERV 의 문서 A');
    await approvedSpec('SPC-A', '# ACME 의 문서 A', twinProjectId);

    expect(await exporter.run()).toMatchObject({ projects: 3, committed: true });

    const ours = readFileSync(join(root, 'nerv/clemvion/specs/SPC-A.md'), 'utf8');
    const theirs = readFileSync(join(root, 'acme/clemvion/specs/SPC-A.md'), 'utf8');
    expect(ours).toContain('NERV 의 문서 A');
    expect(ours).not.toContain('ACME');
    expect(theirs).toContain('ACME 의 문서 A');
    // 색인도 각자의 것이다
    expect(readFileSync(join(root, 'nerv/clemvion/llms.txt'), 'utf8')).toMatch(/^# clemvion\n/);
    expect(readFileSync(join(root, 'acme/clemvion/llms.txt'), 'utf8')).toMatch(
      /^# ACME clemvion\n/,
    );
    // 맨 위에는 조직 폴더만 생긴다 — 프로젝트 slug 만의 폴더는 없다
    expect(existsSync(join(root, 'clemvion'))).toBe(false);
    // 한 커밋에 두 승인이 모두 남는다
    expect(localSubjects()).toEqual(['export(spec): SPC-A@v1 approved by 관리자 (+1)']);

    // 한쪽 문서를 보관해도 다른 조직의 같은 경로는 그대로다
    await pool.query(`UPDATE spec SET archived_at = now() WHERE project_id = $1`, [twinProjectId]);
    expect(await exporter.run()).toMatchObject({ committed: true });
    expect(existsSync(join(root, 'acme/clemvion/specs/SPC-A.md'))).toBe(false);
    expect(readFileSync(join(root, 'nerv/clemvion/specs/SPC-A.md'), 'utf8')).toBe(ours);
    const tracked = git(root, ['ls-files']).split('\n');
    expect(tracked).toContain('nerv/clemvion/specs/SPC-A.md');
    expect(tracked).not.toContain('acme/clemvion/specs/SPC-A.md');
  });

  it('예전 경로(프로젝트 slug 만의 폴더)에 커밋된 파일은 다음 판이 지운다 — 추적하지 않는 파일은 남긴다', async () => {
    await approvedSpec('SPC-A', '# 문서 A');
    await exporter.run();
    // 조직 칸이 없던 판의 커밋을 흉내 낸다
    mkdirSync(join(root, 'clemvion/specs'), { recursive: true });
    writeFileSync(join(root, 'clemvion/llms.txt'), '# clemvion\n');
    writeFileSync(join(root, 'clemvion/specs/SPC-A.md'), '# 문서 A\n');
    git(root, ['add', 'clemvion']);
    git(root, ['commit', '--quiet', '-m', 'old layout']);
    writeFileSync(join(root, 'clemvion/NOTES.txt'), '운영자가 둔 메모');

    const report = await exporter.run();

    expect(report.committed).toBe(true);
    expect(localSubjects()[0]).toBe('export(spec): refresh');
    const tracked = git(root, ['ls-files']).split('\n');
    expect(tracked.filter((path) => path.startsWith('clemvion/'))).toEqual([]);
    expect(tracked).toContain('nerv/clemvion/specs/SPC-A.md');
    expect(existsSync(join(root, 'clemvion/specs/SPC-A.md'))).toBe(false);
    expect(existsSync(join(root, 'clemvion/NOTES.txt'))).toBe(true);
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
    appendFileSync(join(human, 'nerv/clemvion/specs/SPC-A.md'), '\n미러에서 직접 고친 줄\n');
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
    expect(readFileSync(join(root, 'nerv/clemvion/specs/SPC-A.md'), 'utf8')).not.toContain(
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
    // 고친 폴더가 아닌 프로젝트에는 경고하지 않는다 — 다른 조직의 같은 slug 프로젝트에도
    expect(await divergedEvents(otherProjectId)).toEqual([]);
    expect(await divergedEvents(twinProjectId)).toEqual([]);

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

  it('조직이 다른 같은 slug 의 폴더를 고치면 그 조직의 프로젝트에만 경고한다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = remote;
    await approvedSpec('SPC-A', '# NERV 문서 A');
    await approvedSpec('SPC-A', '# ACME 문서 A', twinProjectId);
    await exporter.run();

    const human = mkdtempSync(join(tmpdir(), 'nerv-mirror-human-'));
    git(null, ['clone', '--quiet', '--branch', 'main', remote, human]);
    appendFileSync(join(human, 'acme/clemvion/specs/SPC-A.md'), '\nACME 미러에서 고친 줄\n');
    git(human, ['commit', '--quiet', '-am', 'edit acme mirror by hand']);
    git(human, ['push', '--quiet', 'origin', 'HEAD:main']);

    await approvedSpec('SPC-B', '# 문서 B');
    expect(await exporter.run()).toMatchObject({ diverged: true, divergence_warnings: 1 });

    const [event] = await divergedEvents(twinProjectId);
    expect(event).toMatchObject({ foreign_commits: 1, changed_files: 1 });
    // 폴더의 둘째 칸(slug)만 같은 프로젝트는 대상이 아니다
    expect(await divergedEvents(projectId)).toEqual([]);
    expect(await divergedEvents(otherProjectId)).toEqual([]);
  });

  it('어느 프로젝트의 폴더도 아닌 편집이면 내보낸 프로젝트 전부에 경고한다', async () => {
    process.env['NERV_MIRROR_GIT_REMOTE'] = remote;
    await exporter.run();

    const human = mkdtempSync(join(tmpdir(), 'nerv-mirror-human-'));
    git(null, ['clone', '--quiet', '--branch', 'main', remote, human]);
    writeFileSync(join(human, 'README.md'), '# 미러\n');
    // 조직 폴더 바로 아래의 파일도 어느 프로젝트의 것도 아니다
    writeFileSync(join(human, 'nerv/NOTES.md'), '# 메모\n');
    git(human, ['add', 'README.md', 'nerv/NOTES.md']);
    git(human, ['commit', '--quiet', '-m', 'add readme']);
    git(human, ['push', '--quiet', 'origin', 'HEAD:main']);

    await approvedSpec('SPC-A', '# 문서 A');
    const report = await exporter.run();

    expect(report).toMatchObject({ diverged: true, divergence_warnings: 3 });
    expect(await divergedEvents(projectId)).toHaveLength(1);
    expect(await divergedEvents(otherProjectId)).toHaveLength(1);
    expect(await divergedEvents(twinProjectId)).toHaveLength(1);
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
