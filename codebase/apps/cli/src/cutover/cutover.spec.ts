// `nerv cutover report` — 2주 보고(importer.md §3.7 · 2026-10-16 · 사람 결정 D6 · REQ-IMP-035)
//
// 서버 지표(EP-REV-10)와 체크아웃의 `git log` 를 한 번에 낸다. 가짜 서버(로컬 http)와 일회용 git 저장소로 본다 — 무엇을 세는지(창 안 ·
// 대상 경로 · 모든 브랜치 · 지운 파일 제외), 종료 코드(0 안정 · 1 확인할 것 · 2 중단), 2-5 를 재지 않는다는 줄.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NERV_ERROR } from '@nerv/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLocaleForTesting } from '../i18n.js';
import { main } from '../index.js';
import { countPathCommits, cutoverOutcome, parseCutoverArgs, runCutover } from './index.js';
import type { ServerCutover } from './index.js';

let repo: string;
let server: Server;
let base: string;
let reply: { status: number; body: unknown };
let seen: IncomingMessage[] = [];

/** 커밋 시각을 고정한 커밋 — 창의 경계를 시각으로 본다 */
function commit(file: string, body: string, at: string, branch = 'main'): void {
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: at,
        GIT_COMMITTER_DATE: at,
        GIT_AUTHOR_NAME: 'nerv',
        GIT_AUTHOR_EMAIL: 'nerv@example.com',
        GIT_COMMITTER_NAME: 'nerv',
        GIT_COMMITTER_EMAIL: 'nerv@example.com',
      },
    });
  // 빈 저장소에서는 아직 브랜치가 없다 — 다른 브랜치일 때만 옮긴다
  if (git('symbolic-ref', '--short', 'HEAD').trim() !== branch) git('checkout', '-q', branch);
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), body);
  git('add', '-A');
  git('commit', '-q', '-m', `add ${file}`);
}

const report = (over: Partial<ServerCutover> = {}): ServerCutover => ({
  review_sot: 'dual',
  review_sot_since: '2026-10-01T00:00:00.000Z',
  window: {
    since: '2026-10-01T00:00:00.000Z',
    until: '2026-10-15T00:00:00.000Z',
    days: 14,
    observation_days: 14,
    complete: true,
  },
  comparisons: { total: 200, mismatches: 1, rate: 0.005 },
  submissions: { accepted: 100, failed: 0, total: 100, rate: 0 },
  status: 'stable',
  reasons: [],
  thresholds: { stable_below_pct: 1, rollback_mismatch_pct: 5, rollback_submit_failure_pct: 2 },
  recent_mismatches: [
    {
      branch: 'feat/a',
      head_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      local: 'pass',
      server: 'block',
      hook: 'pre-push',
      created_at: '2026-10-03T10:00:00.000Z',
    },
  ],
  ...over,
});

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'nerv-cutover-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  // 창 앞의 커밋 — 세지 않는다
  commit('review/code/2026/09/30/a/SUMMARY.md', '# 옛 리뷰\n', '2026-09-30T12:00:00Z');
  // 창 안 · 대상 경로 — 센다(두 파일 · 한 커밋)
  commit('review/code/2026/10/02/b/SUMMARY.md', '12345', '2026-10-02T12:00:00Z');
  // 창 안 · 대상 밖 — 세지 않는다
  commit('src/app.ts', 'export {};\n', '2026-10-03T12:00:00Z');
  // 다른 브랜치의 창 안 커밋 — 리뷰는 작업 브랜치에 커밋되던 것이라 센다
  execFileSync('git', ['branch', 'feat/x'], { cwd: repo });
  commit('review/consistency/c/SUMMARY.md', 'abc', '2026-10-04T12:00:00Z', 'feat/x');
  // 창 뒤 — 세지 않는다
  commit('review/code/late/SUMMARY.md', 'late', '2026-10-20T12:00:00Z');

  server = createServer((req, res) => {
    seen.push(req);
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server === undefined ? resolve() : server.close(() => resolve()),
  );
  setLocaleForTesting(null);
});

beforeEach(() => {
  seen = [];
  reply = { status: 200, body: report() };
  setLocaleForTesting('ko');
});

const args = (...extra: string[]): string[] => [
  'report',
  '--project',
  'clemvion',
  '--server',
  base,
  '--token',
  'nerv_x',
  '--root',
  repo,
  ...extra,
];

describe('countPathCommits — 창 안 · 대상 경로 · 모든 브랜치 (성공 기준 2-1)', () => {
  it('창 안에서 `review/` 를 건드린 커밋 · 파일 · 바이트만 센다', () => {
    const counted = countPathCommits(
      repo,
      'review/',
      '2026-10-01T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
    );
    // main 의 10-02 커밋 하나 + feat/x 의 10-04 커밋 하나 — 10-03 은 대상 밖, 09-30 · 10-20 은 창 밖이다
    expect(counted).toEqual({ commits: 2, files: 2, bytes: 5 + 3 });
  });

  it('git 저장소가 아니면 던진다 — 부른 쪽이 「세지 못했다」로 적는다', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nerv-not-git-'));
    expect(() =>
      countPathCommits(empty, 'review/', '2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'),
    ).toThrow();
  });
});

describe('nerv cutover report — 보고와 종료 코드', () => {
  it('서버 지표와 신규 커밋을 함께 적고, 신규 커밋이 있으면 안정이 아니다(1)', async () => {
    let out = '';
    const code = await runCutover(args(), (text) => (out += text));
    expect(code).toBe(1);
    expect(out).toContain('SoT 컷오버 M1 보고 (clemvion)');
    expect(out).toContain('판정 불일치: 1 / 200 (0.50%)');
    expect(out).toContain('리뷰 제출 실패: 0 / 100 (0.00%)');
    expect(out).toContain('`review/` 신규 커밋: 2개 · 파일 2개 · 8바이트');
    // 2-5 는 재지 않는다고 적는다
    expect(out).toContain('(2-5): 재지 않는다');
    expect(out).toContain('feat/a · a1b2c3d · 로컬 통과 (pre-push) · 서버 막음');
    expect(out).toContain('결론: 아직 안정 조건이 아니다');
    // 창은 서버가 정한 것을 그대로 묻는다 — 질의 인자 없이 부르면 서버 기본(전환 시각 ~ 지금)
    expect(seen[0]?.url).toBe('/api/v1/projects/clemvion/gates/reviews/cutover');
    expect(seen[0]?.headers['authorization']).toBe('Bearer nerv_x');
  });

  it('신규 커밋 0 · 서버 안정 · 2주 관측이면 0 이다', async () => {
    let out = '';
    const code = await runCutover(args('--path', 'docs/'), (text) => (out += text));
    expect(code).toBe(0);
    expect(out).toContain('`docs/` 신규 커밋: 0개');
    expect(out).toContain('결론: 2주 관측의');
  });

  it('롤백 기준이면 1 이고 결론이 롤백이다', async () => {
    reply = {
      status: 200,
      body: report({
        status: 'rollback',
        reasons: ['mismatch_rate'],
        comparisons: { total: 100, mismatches: 5, rate: 0.05 },
      }),
    };
    let out = '';
    const code = await runCutover(args('--path', 'docs/'), (text) => (out += text));
    expect(code).toBe(1);
    expect(out).toContain('롤백 기준 도달');
    expect(out).toContain('결론: 롤백 기준에 이르렀다');
  });

  it('--since · --until 은 ISO 로 다시 적어 서버에 넘긴다', async () => {
    await runCutover(
      args('--since', '2026-10-01', '--until', '2026-10-15T00:00:00+09:00', '--json'),
      () => {},
    );
    const url = new URL(`${base}${seen[0]?.url ?? ''}`);
    expect(url.searchParams.get('since')).toBe('2026-10-01T00:00:00.000Z');
    expect(url.searchParams.get('until')).toBe('2026-10-14T15:00:00.000Z');
  });

  it('--json 은 서버 지표 · git 수 · 결론을 그대로 낸다', async () => {
    let out = '';
    await runCutover(args('--json'), (text) => (out += text));
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['git']).toEqual({ commits: 2, files: 2, bytes: 8 });
    expect(parsed['outcome']).toBe('check');
    expect(parsed['input_ratio']).toBeNull();
  });

  it('서버를 읽지 못하면 중단(2)이다 — 권한 없음도 다시 부르지 않는다', async () => {
    reply = {
      status: 403,
      body: { ok: false, code: NERV_ERROR.FORBIDDEN, message: 'admin · planner 만' },
    };
    let out = '';
    expect(await runCutover(args(), (text) => (out += text))).toBe(2);
    expect(out).toContain('서버 지표를 읽지 못했다: HTTP 403 NERV_FORBIDDEN');
    expect(seen).toHaveLength(1);
  });

  it('git 저장소가 아니면 커밋 줄이 「세지 못했다」이고 1 이다 — 서버 지표는 그대로 쓴다', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'nerv-not-git-'));
    let out = '';
    const code = await runCutover(
      ['report', '--project', 'clemvion', '--server', base, '--token', 'x', '--root', empty],
      (text) => (out += text),
    );
    expect(code).toBe(1);
    expect(out).toContain('`review/` 신규 커밋: 세지 못했다');
    expect(out).toContain('판정 불일치: 1 / 200');
  });

  it('서버 · 토큰이 없거나 시각이 틀리면 중단(2)이다', async () => {
    const saved = { server: process.env['NERV_SERVER'], token: process.env['NERV_TOKEN'] };
    delete process.env['NERV_SERVER'];
    delete process.env['NERV_TOKEN'];
    try {
      expect(() => parseCutoverArgs(['report', '--project', 'p'])).toThrow(/--server/);
      expect(await runCutover(['report', '--project', 'p'], () => {})).toBe(2);
      expect(await runCutover(args('--since', 'yesterday'), () => {})).toBe(2);
      expect(await runCutover(['status'], () => {})).toBe(2);
    } finally {
      if (saved.server !== undefined) process.env['NERV_SERVER'] = saved.server;
      if (saved.token !== undefined) process.env['NERV_TOKEN'] = saved.token;
    }
  });

  it('`nerv cutover …` 는 main 에서도 같은 명령이다(임포터 인자 파서를 타지 않는다)', async () => {
    reply = { status: 403, body: {} };
    expect(await main(['cutover', ...args()])).toBe(2);
  });
});

describe('cutoverOutcome — 결론', () => {
  it('관측이 2주를 채우지 않았으면 안정이어도 확인할 것이다', () => {
    const short = report({
      window: { ...report().window, days: 6.5, complete: false },
    });
    expect(cutoverOutcome(short, { commits: 0, files: 0, bytes: 0 })).toBe('check');
    expect(cutoverOutcome(report(), { commits: 0, files: 0, bytes: 0 })).toBe('ok');
    // 커밋을 세지 못했으면 안정이라 하지 않는다
    expect(cutoverOutcome(report(), null)).toBe('check');
    expect(cutoverOutcome(report({ status: 'no_data' }), { commits: 0, files: 0, bytes: 0 })).toBe(
      'check',
    );
  });
});
