// L1 — `nerv replay`(2026-10-17 · 사람 결정 D5 · importer.md §3.8 · REQ-IMP-036 ~ 038)
//
// 픽스처 코퍼스(세션 넷)를 임시 디렉터리에 만들고, 게이트 판정을 흉내 내는 가짜 서버에 돌린다. 가짜 서버는 받은 제출에서 「보고한
// 역할」과 「열린 critical」만 기억해 EP-REV-08 의 모양으로 돌려준다 — 실제 판정 규칙은 L2 가 본다(review-gate). 이 시험이 지키는
// 것은 읽기(역할 md · `agents_forced` · `BLOCK: YES`) · 제출의 모양 · 라벨 대조다.
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  compare,
  judgeSession,
  parseRoleReport,
  readSession,
  replayShas,
  runReplay,
  scanSessions,
} from './index.js';
import type { ReplaySession } from './index.js';
import { setLocaleForTesting } from '../i18n.js';

let root: string;
let server: Server;
let url: string;
const submitted: Array<{ branch: string; head_sha: string; role: string; findings: unknown[] }> =
  [];

/** 세션 하나 — 역할 md 들 · meta.json · SUMMARY.md */
function session(path: string, files: Record<string, string>): void {
  const dir = join(root, path);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

const ROLE_OK = '# 보안 리뷰\n\n발견 없음.\n\n### 위험도\nLOW\n';
const ROLE_CRITICAL =
  '# 테스트 리뷰\n\n- [CRITICAL] 결제 경로에 시험이 없다 `pay.ts:10`\n\n### 위험도\nCRITICAL\n';

beforeAll(async () => {
  setLocaleForTesting('ko');
  root = mkdtempSync(join(tmpdir(), 'nerv-replay-'));
  // ① forced 둘 다 보고 — 정상
  session('review/code/2026/07/01/10_00_00', {
    'meta.json': JSON.stringify({ agents_forced: ['security', 'testing'] }),
    'security.md': ROLE_OK,
    'testing.md': ROLE_OK,
    'SUMMARY.md': '## 전체 위험도\n**LOW** — 문제 없음\n',
  });
  // ② forced 중 testing 이 보고하지 않았다 — 미충족
  session('review/code/2026/07/02/10_00_00', {
    'meta.json': JSON.stringify({ agents_forced: ['security', 'testing'] }),
    'security.md': ROLE_OK,
    'SUMMARY.md': '## 전체 위험도\n**LOW** — 문제 없음\n',
  });
  // ③ 체커가 CRITICAL 인데 SUMMARY 는 막지 않았다 — 하향
  session('review/consistency/2026/07/03/10_00_00', {
    'meta.json': JSON.stringify({ agents_forced: ['testing'] }),
    'testing.md': ROLE_CRITICAL,
    'SUMMARY.md': '**BLOCK: NO**\n',
  });
  // ④ CRITICAL 이고 SUMMARY 도 막았다 — 하향이 아니다
  session('review/consistency/2026/07/04/10_00_00', {
    'meta.json': JSON.stringify({ agents_forced: ['testing'] }),
    'testing.md': ROLE_CRITICAL,
    'SUMMARY.md': '**BLOCK: YES**\n',
  });
  // 세션이 아닌 것 — `_prompts/` 아래와 깊이가 다른 폴더
  mkdirSync(join(root, 'review/code/2026/07/01/10_00_00/_prompts'), { recursive: true });
  writeFileSync(join(root, 'review/code/2026/07/01/10_00_00/_prompts/security.md'), ROLE_CRITICAL);
  mkdirSync(join(root, 'review/code/notes'), { recursive: true });

  const rounds = new Map<string, { roles: Set<string>; critical: number }>();
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const u = new URL(req.url ?? '', 'http://x');
      if (req.method === 'POST' && u.pathname.endsWith('/reviews')) {
        const body = JSON.parse(raw) as {
          branch: string;
          head_sha: string;
          reviewer: { role: string };
          findings: unknown[];
        };
        submitted.push({
          branch: body.branch,
          head_sha: body.head_sha,
          role: body.reviewer.role,
          findings: body.findings,
        });
        const key = `${body.branch}@${body.head_sha}`;
        const round = rounds.get(key) ?? { roles: new Set<string>(), critical: 0 };
        round.roles.add(body.reviewer.role);
        round.critical += body.findings.length;
        rounds.set(key, round);
        res.writeHead(201, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      if (req.method === 'GET' && u.pathname.endsWith('/gates/reviews/check')) {
        const round = rounds.get(
          `${u.searchParams.get('branch')}@${u.searchParams.get('head_sha')}`,
        );
        const kind = u.searchParams.get('kind') ?? 'code';
        const reasons = round !== undefined && round.critical > 0 ? ['open_critical'] : [];
        const items =
          round === undefined
            ? [
                {
                  kind,
                  state: 'uncovered',
                  reasons: [],
                  roles: { required: [], reported: [], missing: [] },
                },
              ]
            : [
                {
                  kind,
                  state: reasons.length > 0 ? 'pending' : 'passed',
                  reasons,
                  roles: { required: [], reported: [...round.roles], missing: [] },
                },
              ];
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items }));
        return;
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  setLocaleForTesting(null);
  await new Promise((done) => server.close(done));
  rmSync(root, { recursive: true, force: true });
});

describe('읽기 — 역할 md · agents_forced · BLOCK', () => {
  it('역할 리포트의 위험도와 CRITICAL 줄', () => {
    expect(parseRoleReport('testing', ROLE_CRITICAL)).toEqual({
      role: 'testing',
      risk: 'critical',
      criticals: ['[CRITICAL] 결제 경로에 시험이 없다 `pay.ts:10`'],
    });
    expect(parseRoleReport('security', ROLE_OK)).toMatchObject({ risk: 'low', criticals: [] });
  });

  it('세션 디렉터리만 찾는다 — `_prompts/` 와 깊이가 다른 폴더는 아니다', () => {
    expect(scanSessions(root)).toEqual([
      'review/code/2026/07/01/10_00_00',
      'review/code/2026/07/02/10_00_00',
      'review/consistency/2026/07/03/10_00_00',
      'review/consistency/2026/07/04/10_00_00',
    ]);
  });

  it('세션 하나 — 필수 역할은 그 세션의 agents_forced 다', () => {
    const read = readSession(root, 'review/code/2026/07/02/10_00_00');
    expect(read).toMatchObject({
      kind: 'code',
      forced: ['security', 'testing'],
      summaryBlocks: false,
    });
    expect(read?.roles.map((r) => r.role)).toEqual(['security']);
    expect(readSession(root, 'review/consistency/2026/07/04/10_00_00')?.summaryBlocks).toBe(true);
  });
});

describe('판정 · 대조', () => {
  const base: ReplaySession = {
    path: 'p',
    kind: 'code',
    forced: ['a', 'b'],
    roles: [],
    summaryBlocks: false,
  };

  it('서버가 기록한 보고 역할로 미충족을 본다', () => {
    const item = {
      kind: 'code',
      state: 'passed',
      reasons: [],
      roles: { required: [], reported: ['a'], missing: [] },
    };
    expect(judgeSession(base, item)).toMatchObject({
      forcedUnmet: true,
      downgrade: false,
      serverDisagrees: false,
    });
  });

  it('정책이 그 세션의 forced 와 같으면 서버의 missing_roles 와 견준다', () => {
    const item = {
      kind: 'code',
      state: 'passed',
      reasons: [],
      roles: { required: ['b', 'a'], reported: ['a'], missing: ['b'] },
    };
    expect(judgeSession(base, item).serverDisagrees).toBe(true);
    const agrees = { ...item, reasons: ['missing_roles'] };
    expect(judgeSession(base, agrees).serverDisagrees).toBe(false);
  });

  it('놓친 것과 오탐을 나눠 센다 — 모집단 밖은 세지 않는다', () => {
    const r = compare(['x', 'y', 'z'], ['x', 'y', 'outside'], new Set(['y', 'z', 'outside']));
    expect(r).toMatchObject({
      population: 3,
      labeled: 2,
      detected: 2,
      missed: ['x'],
      falsePositives: ['z'],
      pass: false,
    });
  });

  it('세션마다 겹치지 않는 40자 커밋', () => {
    const a = replayShas('review/code/a');
    expect(a.head).toMatch(/^[0-9a-f]{40}$/);
    expect(a.head).not.toBe(replayShas('review/code/b').head);
    expect(a.head).not.toBe(a.base);
  });
});

describe('nerv replay — 가짜 서버에 돌려 라벨과 견준다', () => {
  const run = async (labels: object): Promise<{ code: number; out: string }> => {
    const file = join(root, `labels-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(labels));
    let out = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await runReplay([
        '--root',
        root,
        '--labels',
        file,
        '--project',
        'replay',
        '--server',
        url,
        '--token',
        't',
      ]);
      return { code, out };
    } finally {
      write.mockRestore();
      err.mockRestore();
    }
  };

  it('라벨과 같으면 0 — 역할마다 제출하고 CRITICAL 줄을 발견으로 보낸다', async () => {
    const { code, out } = await run({
      forced_unmet: ['review/code/2026/07/02/10_00_00'],
      verdict_downgrade: ['review/consistency/2026/07/03/10_00_00'],
    });
    expect(out).toContain('2-2');
    expect(code).toBe(0);
    const critical = submitted.find(
      (s) => s.branch === 'replay/review/consistency/2026/07/03/10_00_00',
    );
    expect(critical?.findings).toEqual([
      { severity: 'critical', title: '[CRITICAL] 결제 경로에 시험이 없다 `pay.ts:10`' },
    ]);
    // `_prompts/` 의 md 는 역할이 아니다
    expect(
      submitted
        .filter((s) => s.branch === 'replay/review/code/2026/07/01/10_00_00')
        .map((s) => s.role),
    ).toEqual(['security', 'testing']);
  });

  it('놓치거나 오탐이 있으면 1 — 무엇인지 적는다', async () => {
    const { code, out } = await run({
      forced_unmet: [],
      verdict_downgrade: ['review/consistency/2026/07/04/10_00_00'],
    });
    expect(code).toBe(1);
    expect(out).toContain('오탐: review/code/2026/07/02/10_00_00');
    expect(out).toContain('놓침: review/consistency/2026/07/04/10_00_00');
  });
});
