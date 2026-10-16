// nerv-outbox · nerv-hook-forward — 복구 뒤 자동 동기화를 실제로 돌려 본다 (4.6 §3.4 · REQ-PLG-032 · 033 · E21-S01)
//
// **스크립트는 가짜 서버를 상대로 실행한다.** 백그라운드로 띄운 flush 가 정말 훅보다 오래 사는지, 잠금이 정말 둘을
// 막는지, 거절된 항목이 정말 `failed/` 로 가는지는 프로세스와 파일 시스템에서만 드러난다. 서버가 같은 멱등 키로
// 레코드를 하나만 만드는지와 보고가 알림이 되는지는 L2(`apps/api/test/integration/outbox-sync.spec.ts`)가 본다.

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// 플러그인 폴더는 배달되는 파일만 둔다 — 테스트는 옆 폴더에서 그 스크립트를 실행한다(REQ-PLG-037)
const here = join(dirname(fileURLToPath(import.meta.url)), '../plugin');
const OUTBOX = join(here, 'bin', 'nerv-outbox');
const FORWARD = join(here, 'bin', 'nerv-hook-forward');

// ── 가짜 서버 ────────────────────────────────────────────────────────────────

interface Call {
  path: string;
  body: Record<string, unknown>;
}

interface Reply {
  status: number;
  /** 문자열이면 그대로 보낸다(프록시의 HTML 페이지 흉내) */
  body: unknown;
}

const ok = (): Reply => ({
  status: 200,
  body: { jsonrpc: '2.0', id: 1, result: { content: [], structuredContent: { ok: true } } },
});

const toolError = (code: string, kind: string, status = 200): Reply => ({
  status,
  body: {
    jsonrpc: '2.0',
    id: 1,
    result: {
      isError: true,
      content: [{ type: 'text', text: '{}' }],
      structuredContent: { ok: false, code, message: `원문 메시지 ${kind}`, details: { kind } },
    },
  },
});

let server: Server;
let url = '';
let calls: Call[] = [];
let hookStatus = 202;
let reportStatus = 202;
let mcpDelayMs = 0;
/** 도구 이름으로 답을 고른다 — 없으면 성공 */
let replies: Record<string, Reply> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d: Buffer) => (raw += d.toString('utf8')));
    req.on('end', () => {
      const body = (raw === '' ? {} : JSON.parse(raw)) as Record<string, unknown>;
      calls.push({ path: req.url ?? '', body });
      const send = (reply: Reply): void => {
        const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        res.writeHead(reply.status, {
          'content-type': typeof reply.body === 'string' ? 'text/html' : 'application/json',
        });
        res.end(text);
      };
      if (req.url === '/ingest/hooks/outbox-failed') {
        send({ status: reportStatus, body: { ok: true } });
      } else if ((req.url ?? '').startsWith('/ingest/hooks/')) {
        send({ status: hookStatus, body: { ok: true } });
      } else if (req.url === '/mcp') {
        const name = String((body['params'] as Record<string, unknown>)['name']);
        setTimeout(() => send(replies[name] ?? ok()), mcpDelayMs);
      } else {
        send({ status: 404, body: { ok: false } });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls = [];
  hookStatus = 202;
  reportStatus = 202;
  mcpDelayMs = 0;
  replies = {};
});

// ── 도우미 ──────────────────────────────────────────────────────────────────

/**
 * 작업 저장소 하나 — NERV 를 설정한 저장소(`.mcp.json` 의 `nerv`)이고 큐 폴더가 있다. 설정이 없는 저장소에서는 큐를 만들지도
 * 보내지도 않는다(REQ-PLG-041) — 그 경우는 `configured: false` 로 만든다. 설정을 `.nerv/env` 로 두지 않는 이유: 큐를 쓴 적이
 * 없는 저장소에 `.nerv/` 가 생기지 않는가를 보는 시험이 있다.
 */
function repo({ outbox = true, configured = true } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-outbox-'));
  if (configured) writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"nerv":{}}}\n');
  if (outbox) mkdirSync(join(dir, '.nerv', 'outbox'), { recursive: true });
  return dir;
}

const outboxOf = (dir: string): string => join(dir, '.nerv', 'outbox');

/** 큐 항목을 직접 적는다 — 시간순을 시험하려면 `queued_at` 을 정해야 한다(enqueue 는 초 단위다) */
function item(
  dir: string,
  key: string,
  { tool = 'nerv_task_update', at = '2026-10-16T05:00:00Z', session = 'S-1' } = {},
): void {
  writeFileSync(
    join(outboxOf(dir), `${at.replace(/:/g, '-')}-${key}.json`),
    JSON.stringify({
      tool,
      input: { task_id: 'CLV-T-AAAAAA', status: 'in_progress' },
      idempotency_key: key,
      session_id: session,
      queued_at: at,
      attempts: 1,
    }),
  );
}

const pending = (dir: string): string[] =>
  readdirSync(outboxOf(dir)).filter((name) => name.endsWith('.json'));

function failed(dir: string): Record<string, unknown>[] {
  const path = join(outboxOf(dir), 'failed');
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(path, name), 'utf8')) as Record<string, unknown>);
}

const sentKeys = (): string[] =>
  calls
    .filter((c) => c.path === '/mcp')
    .map((c) =>
      String(
        ((c.body['params'] as Record<string, unknown>)['arguments'] as Record<string, unknown>)[
          'idempotency_key'
        ],
      ),
    );

const reports = (): Record<string, unknown>[][] =>
  calls
    .filter((c) => c.path === '/ingest/hooks/outbox-failed')
    .map((c) => c.body['items'] as Record<string, unknown>[]);

/** 서버가 같은 프로세스라 동기 실행은 쓰지 못한다 */
function run(
  bin: string,
  args: string[],
  { cwd, input = '', env = {} }: { cwd: string; input?: string; env?: Record<string, string> },
): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('bash', [bin, ...args], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: cwd,
        NERV_SERVER: url,
        NERV_TOKEN: 'nerv_pat_test',
        NERV_PROJECT: 'clemvion',
        NERV_HOSTNAME: 'mac-07',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started }),
    );
    child.stdin.end(input);
  });
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('기다린 일이 일어나지 않았다');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const HOOK = '{"session_id":"claude-1","tool_name":"Bash"}';

// ── REQ-PLG-032 ─────────────────────────────────────────────────────────────

describe('REQ-PLG-032 — 서버가 돌아오면 포워더가 큐를 백그라운드로 비운다', () => {
  it('2xx 를 받은 포워더는 flush 를 띄우고 기다리지 않는다 — 원래 멱등 키로 queued_at 순서대로 보낸다', async () => {
    const dir = repo();
    // 이름 순서와 시간 순서를 일부러 엇갈리게 둔다 — 키가 아니라 시각으로 줄 선다
    item(dir, 'b-older', { at: '2026-10-16T05:00:00Z' });
    item(dir, 'a-newer', { at: '2026-10-16T05:01:00Z' });
    mcpDelayMs = 1500;

    const hook = await run(FORWARD, ['tool'], { cwd: dir, input: HOOK });
    expect(hook.code).toBe(0);
    // 항목 하나를 보내는 데만 1.5초다 — 포워더가 그보다 먼저 끝났으면 기다리지 않은 것이다
    expect(hook.ms).toBeLessThan(1200);
    expect(hook.stdout).toBe('{"ok":true}');

    await until(() => pending(dir).length === 0);
    expect(sentKeys()).toEqual(['b-older', 'a-newer']);
    const args = (calls.find((c) => c.path === '/mcp')?.body['params'] as Record<string, unknown>)[
      'arguments'
    ] as Record<string, unknown>;
    expect(args).toMatchObject({ task_id: 'CLV-T-AAAAAA', session_id: 'S-1' });
    expect(failed(dir)).toEqual([]);
  });

  it('세션을 만드는 훅 · 2xx 가 아닌 답 · 빈 큐에서는 띄우지 않는다', async () => {
    const dir = repo();
    item(dir, 'k1');

    // SessionStart 는 따로 flush 훅이 돈다 — 둘이 겹치지 않게 포워더는 띄우지 않는다
    await run(FORWARD, ['session'], { cwd: dir, input: HOOK });
    hookStatus = 503;
    await run(FORWARD, ['tool'], { cwd: dir, input: HOOK });
    await sleep(800);
    expect(sentKeys()).toEqual([]);
    expect(pending(dir)).toHaveLength(1);

    // 큐를 쓴 적이 없는 저장소에는 아무것도 만들지 않는다
    hookStatus = 202;
    const empty = repo({ outbox: false });
    await run(FORWARD, ['stop'], { cwd: empty, input: HOOK });
    await run(OUTBOX, ['flush'], { cwd: empty });
    expect(existsSync(join(empty, '.nerv'))).toBe(false);
  });

  it('잠금 — flush 둘이 겹쳐도 항목마다 한 번만 보낸다', async () => {
    const dir = repo();
    item(dir, 'k1', { at: '2026-10-16T05:00:00Z' });
    item(dir, 'k2', { at: '2026-10-16T05:00:01Z' });
    item(dir, 'k3', { at: '2026-10-16T05:00:02Z' });
    mcpDelayMs = 300;

    const [one, two] = await Promise.all([
      run(OUTBOX, ['flush'], { cwd: dir }),
      run(OUTBOX, ['flush'], { cwd: dir }),
    ]);
    expect(sentKeys()).toEqual(['k1', 'k2', 'k3']);
    expect(`${one.stdout}${two.stdout}`).toContain('다른 flush 가 돌고 있다');
    expect(pending(dir)).toEqual([]);
    // 끝나면 잠금을 푼다
    expect(existsSync(join(outboxOf(dir), '.flush.lock'))).toBe(false);
  });

  it('주인이 살아 있는 잠금이면 kick 은 띄우지 않고, 주인이 없는 잠금은 지우고 돈다', async () => {
    const dir = repo();
    item(dir, 'k1');
    const lock = join(outboxOf(dir), '.flush.lock');

    // 살아 있는 주인 — 이 테스트 프로세스다
    symlinkSync(String(process.pid), lock);
    await run(OUTBOX, ['kick'], { cwd: dir });
    await sleep(800);
    expect(sentKeys()).toEqual([]);
    expect((await run(OUTBOX, ['status'], { cwd: dir })).stdout).toContain('flush 가 돌고 있다');

    // 끝난 프로세스의 pid — 주인이 없다
    const dead = await new Promise<number>((resolve) => {
      const child = spawn('true');
      child.on('close', () => resolve(child.pid ?? 0));
    });
    rmSync(lock);
    symlinkSync(String(dead), lock);
    const flushed = await run(OUTBOX, ['flush'], { cwd: dir });
    expect(flushed.stdout).toContain('성공 1');
    expect(sentKeys()).toEqual(['k1']);
    expect(existsSync(lock)).toBe(false);
  });
});

// ── REQ-PLG-033 ─────────────────────────────────────────────────────────────

describe('REQ-PLG-033 — 서버가 거절한 쓰기는 failed/ 로 가고 사람에게 알린다', () => {
  it('거절된 항목만 옮기고 계속한다 — 사유를 남기고 서버에 알린다(메시지 원문 없이)', async () => {
    const dir = repo();
    item(dir, 'k1', { at: '2026-10-16T05:00:00Z' });
    item(dir, 'k2', { at: '2026-10-16T05:00:01Z', tool: 'nerv_question_create' });
    item(dir, 'k3', { at: '2026-10-16T05:00:02Z' });
    replies['nerv_question_create'] = toolError('NERV_PRECONDITION', 'invalid_transition');

    const out = await run(OUTBOX, ['flush'], { cwd: dir });
    expect(out.stdout).toContain('성공 2 · 실패 1');
    expect(out.stdout).toContain('서버에 알렸다');
    expect(sentKeys()).toEqual(['k1', 'k2', 'k3']);
    expect(pending(dir)).toEqual([]);

    const [record] = failed(dir);
    expect(record).toMatchObject({
      idempotency_key: 'k2',
      failure: { status: 200, code: 'NERV_PRECONDITION', kind: 'invalid_transition' },
    });
    expect(typeof record?.['reported_at']).toBe('string');

    expect(reports()).toHaveLength(1);
    const [sent] = reports()[0] ?? [];
    expect(sent).toEqual({
      tool: 'nerv_question_create',
      idempotency_key: 'k2',
      session_id: 'S-1',
      queued_at: '2026-10-16T05:00:01Z',
      failed_at: record?.['failed_at'],
      status: 200,
      code: 'NERV_PRECONDITION',
      kind: 'invalid_transition',
    });
    // 이미 알린 실패는 다시 알리지 않는다
    await run(OUTBOX, ['flush'], { cwd: dir });
    expect(reports()).toHaveLength(1);
  });

  it('보고가 닿지 않으면 세션 시작 안내와 status 에 남고, 다음 flush 가 다시 알린다', async () => {
    const dir = repo();
    item(dir, 'k1', { tool: 'nerv_review_submit' });
    replies['nerv_review_submit'] = toolError('NERV_FORBIDDEN', 'missing_scope');
    reportStatus = 503;

    const out = await run(OUTBOX, ['flush'], { cwd: dir });
    expect(out.stdout).toContain('서버에 알리지 못한 실패 1건');
    expect(out.stdout).toContain('nerv_review_submit');
    expect(out.stdout).toContain('NERV_FORBIDDEN (missing_scope)');
    expect((await run(OUTBOX, ['status'], { cwd: dir })).stdout).toContain(
      '실패 1건(outbox/failed/) · 서버에 알리지 못한 것 1건',
    );

    // 보낼 것은 없지만 알릴 것이 있다 — 다음 2xx 가 다시 알린다
    reportStatus = 202;
    await run(FORWARD, ['stop'], { cwd: dir, input: HOOK });
    await until(() => typeof failed(dir)[0]?.['reported_at'] === 'string');
    expect(reports()).toHaveLength(2);
    expect((await run(OUTBOX, ['status'], { cwd: dir })).stdout).toContain(
      '서버에 알리지 못한 것 0건',
    );
  });

  it.each([
    ['401', { status: 401, body: { ok: false, code: 'NERV_UNAUTHENTICATED' } }, 'unauthenticated'],
    ['429', { status: 429, body: { ok: false, code: 'NERV_RATE_LIMIT' } }, 'rate_limited'],
    ['503', { status: 503, body: { ok: false, code: 'NERV_UNAVAILABLE' } }, 'unavailable'],
    ['NERV_UNAVAILABLE 구조화 에러', toolError('NERV_UNAVAILABLE', 'internal'), 'unavailable'],
    [
      '같은 키가 아직 도는 중',
      toolError('NERV_PRECONDITION', 'idempotency_in_flight'),
      'in_flight',
    ],
    ['JSON-RPC 가 아닌 2xx', { status: 200, body: '<html>proxy</html>' }, 'not_json-rpc'],
  ] satisfies [string, Reply, string][])(
    '그 쓰기에 대한 판정이 아닌 답(%s)은 남기고 멈춘다 — 뒤의 항목이 앞지르지 않는다',
    async (_label, reply, reason) => {
      const dir = repo();
      item(dir, 'k1', { at: '2026-10-16T05:00:00Z', tool: 'nerv_spec_draft_upsert' });
      item(dir, 'k2', { at: '2026-10-16T05:00:01Z' });
      replies['nerv_spec_draft_upsert'] = reply;

      const out = await run(OUTBOX, ['flush'], { cwd: dir });
      expect(out.stdout).toContain(`멈춤(${reason})`);
      expect(sentKeys()).toEqual(['k1']);
      expect(pending(dir)).toHaveLength(2);
      expect(failed(dir)).toEqual([]);
    },
  );

  it('서버에 스토리지가 없다는 NERV_UNAVAILABLE 은 기다려도 풀리지 않는다 — 실패로 옮긴다', async () => {
    const dir = repo();
    item(dir, 'k1', { tool: 'nerv_spec_attach' });
    replies['nerv_spec_attach'] = toolError('NERV_UNAVAILABLE', 'storage_unconfigured');
    await run(OUTBOX, ['flush'], { cwd: dir });
    expect(failed(dir)[0]).toMatchObject({ failure: { kind: 'storage_unconfigured' } });
  });

  it('읽을 수 없는 큐 파일은 실패로 옮긴다 — 머리에 남아 뒤를 막지 않는다', async () => {
    const dir = repo();
    writeFileSync(join(outboxOf(dir), '2026-10-16T04-00-00Z-broken.json'), 'not json');
    item(dir, 'k1', { at: '2026-10-16T05:00:00Z' });

    await run(OUTBOX, ['flush'], { cwd: dir });
    expect(sentKeys()).toEqual(['k1']);
    expect(failed(dir)[0]).toMatchObject({
      tool: null,
      idempotency_key: 'broken',
      queued_at: '2026-10-16T04:00:00Z',
      failure: { kind: 'unreadable' },
    });
    expect(reports()[0]?.[0]).toMatchObject({ idempotency_key: 'broken', kind: 'unreadable' });
  });

  it('enqueue 는 JSON 객체가 아닌 입력을 받지 않는다 — 부른 쪽이 그 자리에서 안다', async () => {
    const dir = repo();
    const bad = await run(OUTBOX, ['enqueue', 'nerv_task_update', 'k1', 'S-1'], {
      cwd: dir,
      input: 'status=done',
    });
    expect(bad.code).toBe(65);
    expect(pending(dir)).toEqual([]);

    const good = await run(OUTBOX, ['enqueue', 'nerv_task_update', 'k"2', 'S-1'], {
      cwd: dir,
      input: '{"task_id":"CLV-T-AAAAAA"}',
    });
    expect(good.code).toBe(0);
    const [name] = pending(dir);
    // 키에 따옴표가 있어도 올바른 JSON 이다 — 예전에는 printf 로 이어 붙였다
    expect(JSON.parse(readFileSync(join(outboxOf(dir), name ?? ''), 'utf8'))).toMatchObject({
      tool: 'nerv_task_update',
      input: { task_id: 'CLV-T-AAAAAA' },
      idempotency_key: 'k"2',
      session_id: 'S-1',
    });
  });
});

// ── REQ-PLG-041 ─────────────────────────────────────────────────────────────

describe('REQ-PLG-041 — 설정이 없는 저장소에서는 큐를 만들지도 보내지도 않는다', () => {
  it('enqueue 는 큐에 넣지 않고 실패한다 — 부른 쪽이 그 자리에서 알고 사람에게 보고한다', async () => {
    const dir = repo({ outbox: false, configured: false });
    const res = await run(OUTBOX, ['enqueue', 'nerv_task_update', 'k1', 'S-1'], {
      cwd: dir,
      input: '{"task_id":"CLV-T-AAAAAA"}',
    });
    expect(res.code).toBe(78);
    expect(res.stderr).toContain('NERV 설정이 없다');
    expect(existsSync(join(dir, '.nerv'))).toBe(false);
  });

  it('예전에 쌓인 큐는 보내지 않고 남은 건수만 말한다 — 지우지도 않는다', async () => {
    const dir = repo({ configured: false });
    item(dir, 'k1');
    const res = await run(OUTBOX, ['flush'], { cwd: dir });
    expect(sentKeys()).toEqual([]);
    expect(res.stdout).toContain('보내지 않았다');
    expect(res.stdout).toContain('1건');
    expect(pending(dir)).toHaveLength(1);

    // 포워더도 보내지 않으므로 kick 할 일이 없고, kick 을 직접 불러도 띄우지 않는다
    await run(FORWARD, ['tool'], { cwd: dir, input: HOOK });
    await run(OUTBOX, ['kick'], { cwd: dir });
    await sleep(800);
    expect(calls).toEqual([]);
    expect(pending(dir)).toHaveLength(1);
  });

  it('관리형 표시(NERV_MANAGED=1)가 있으면 설정 파일이 없어도 큐에 넣고 보낸다', async () => {
    const dir = repo({ outbox: false, configured: false });
    const env = { NERV_MANAGED: '1' };
    const queued = await run(OUTBOX, ['enqueue', 'nerv_task_update', 'k1', 'S-1'], {
      cwd: dir,
      input: '{"task_id":"CLV-T-AAAAAA"}',
      env,
    });
    expect(queued.code).toBe(0);
    const hook = await run(FORWARD, ['tool'], { cwd: dir, input: HOOK, env });
    expect(hook.stdout).toBe('{"ok":true}');
    await until(() => pending(dir).length === 0);
    expect(sentKeys()).toEqual(['k1']);
  });
});
