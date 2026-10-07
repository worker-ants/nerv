// nerv-mirror — 미러 스크립트를 실제로 돌려 본다 (4.6 §2.7 · REQ-PLG-028)
//
// **스크립트는 가짜 서버를 상대로 실행한다.** 폴더를 맞추는 규칙(새로 · 바뀜 · 되돌림 · 지움)과 거절하는
// 자리(미러가 아닌 폴더 · 사람의 파일 · 폴더 밖 경로)는 실제 파일 시스템에서만 의미가 있다. zip 은 여기서
// 만든다 — 서버가 실제로 그 바이트를 내는지는 L2(`mirror-http.spec.ts`)가 본다.

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, safeEntryPath, unzip } from './skills/mirror/scripts/nerv-mirror.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, 'bin', 'nerv-mirror');
const TOKEN = 'nerv_pat_test_secret_value';

// ── zip 만들기 ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 항목마다 stored(짝수 번째) · deflate(홀수 번째)를 섞는다 — 푸는 쪽이 둘 다 읽어야 한다 */
function makeZip(files: Record<string, string | Buffer>, { badCrc = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content], i) => {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const method = i % 2 === 0 ? 0 : 8;
    const body = method === 0 ? data : deflateRawSync(data);
    const crc = badCrc ? (crc32(data) ^ 1) >>> 0 : crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** 서버의 export.zip 모양 — 목록 · 색인 · 문서 · 첨부 */
function exportZip(docs: Record<string, string>, attachments: Record<string, Buffer> = {}): Buffer {
  const manifest = {
    project: 'clemvion',
    basis: 'approved',
    baseline: null,
    layout: 'tree',
    include: ['attachments'],
    specs: Object.keys(docs).map((path) => ({
      key: path.split('/').pop()!.replace(/\.md$/, ''),
      path,
    })),
    attachments: Object.keys(attachments).map((path) => ({ id: path.split('/')[1], path })),
  };
  return makeZip({
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'llms.txt': '# clemvion\n',
    ...docs,
    ...attachments,
  });
}

// ── 가짜 서버 ───────────────────────────────────────────────────────────────

interface Route {
  status: number;
  body: Buffer | string;
  type?: string;
}

let server: Server;
let base = '';
const routes = new Map<string, Route>();
const seen: { url: string; authorization: string | undefined }[] = [];

function route(path: string, value: Route): void {
  routes.set(path, value);
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    seen.push({ url: `${url.pathname}${url.search}`, authorization: req.headers.authorization });
    const hit = routes.get(url.pathname);
    if (hit === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 'NERV_PRECONDITION',
          message: '없다',
          details: { kind: 'not_found' },
        }),
      );
      return;
    }
    res.writeHead(hit.status, { 'content-type': hit.type ?? 'application/zip' });
    res.end(hit.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  routes.clear();
  seen.length = 0;
});

/** 스크립트를 PATH 의 이름 그대로(sh 래퍼) 실행한다 — 서버가 같은 프로세스라 동기 실행은 못 쓴다 */
function run(
  args: string[],
  { cwd = tmpdir(), env = {} }: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', [BIN, ...args], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        NERV_SERVER: base,
        NERV_PROJECT: 'clemvion',
        NERV_TOKEN: TOKEN,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const EXPORT = '/api/projects/clemvion/export.zip';
const scratch = (): string => mkdtempSync(join(tmpdir(), 'nerv-mirror-'));
const read = (dir: string, path: string): string => readFileSync(join(dir, path), 'utf8');
const state = (dir: string): Record<string, unknown> =>
  JSON.parse(read(dir, '.nerv-mirror.json')) as Record<string, unknown>;

// ── 단위 ────────────────────────────────────────────────────────────────────

describe('REQ-PLG-028 — 인자와 경로 규칙', () => {
  it('기본은 승인본 · tree · 첨부 포함이고, 기준은 하나만 고른다', () => {
    expect(parseArgs(['pull', 'out']).flags).toMatchObject({
      basis: 'approved',
      baseline: null,
      layout: 'tree',
      attachments: true,
    });
    expect(parseArgs(['pull', 'out', '--baseline', 'R1']).flags.baseline).toBe('R1');
    expect(parseArgs(['pull', 'out', '--baseline=R 1']).flags.baseline).toBe('R 1');
    expect(() => parseArgs(['pull', 'out', '--latest', '--baseline', 'R1'])).toThrow(/하나만/);
    expect(() => parseArgs(['pull', 'out', '--baseline'])).toThrow(/이름이 없다/);
    expect(() => parseArgs(['pull', 'out', '--layout', 'deep'])).toThrow(/tree나 flat/);
    expect(() => parseArgs(['pull', 'out', '--bogus'])).toThrow(/모르는 옵션/);
  });

  it('zip 안의 경로는 이 폴더 안이어야 한다 — 절대 경로 · .. · 역슬래시 · 드라이브 · 장부 이름을 거절한다', () => {
    for (const ok of ['manifest.json', 'specs/AREA/SPC-1.md', 'attachments/01ab/그림.png']) {
      expect(safeEntryPath(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      '/etc/passwd',
      '../evil.md',
      'specs/../../evil.md',
      'specs/./a.md',
      'specs//a.md',
      'specs\\a.md',
      'C:/evil.md',
      'a\0b',
      '.nerv-mirror.json',
      '.nerv-mirror.tmp/x',
    ]) {
      expect(safeEntryPath(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('stored · deflate 를 모두 풀고, CRC 가 맞지 않으면 거절한다', () => {
    const files = { 'a.txt': 'hello', 'specs/b.md': '# 제목\n'.repeat(50) };
    expect(
      unzip(makeZip(files)).map((e: { path: string; data: Buffer }) => [
        e.path,
        e.data.toString('utf8'),
      ]),
    ).toEqual(Object.entries(files));
    expect(() => unzip(makeZip(files, { badCrc: true }))).toThrow(/손상/);
    expect(() => unzip(Buffer.from('not a zip at all, definitely not'))).toThrow(/zip이 아니다/);
  });
});

// ── 실행 ────────────────────────────────────────────────────────────────────

describe('REQ-PLG-028 — pull 이 폴더를 서버와 같게 만든다', () => {
  it('처음 받으면 전부 쓰고 상태 파일을 남긴다 — 토큰은 헤더에만 있다', async () => {
    const out = join(scratch(), 'mirror');
    route(EXPORT, {
      status: 200,
      body: exportZip(
        { 'specs/AREA/AREA.md': '# 영역\n', 'specs/AREA/SPC-1.md': '# 하나\n' },
        { 'attachments/01ab/그림.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
      ),
    });
    const res = await run(['pull', out]);
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('nerv-mirror · clemvion · 승인본 · tree');
    expect(res.stdout).toContain('요청 1번');
    expect(res.stdout).toContain('문서  2편 — 새로 2 · 바뀜 0 · 그대로 0');
    expect(res.stdout).toContain('첨부  1개 — 새로 1');
    expect(read(out, 'specs/AREA/SPC-1.md')).toBe('# 하나\n');
    expect(readFileSync(join(out, 'attachments/01ab/그림.png'))[0]).toBe(0x89);

    // 요청은 한 번이고, 기준 · 모양 · 첨부를 주소로 말한다
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${EXPORT}?basis=approved&layout=tree&include=attachments`);
    expect(seen[0]!.authorization).toBe(`Bearer ${TOKEN}`);

    const s = state(out);
    expect(s).toMatchObject({ format: 1, project: 'clemvion', basis: 'approved', baseline: null });
    expect(Object.keys(s['files'] as object).sort()).toEqual([
      'attachments/01ab/그림.png',
      'llms.txt',
      'manifest.json',
      'specs/AREA/AREA.md',
      'specs/AREA/SPC-1.md',
    ]);
    expect(read(out, '.nerv-mirror.json')).not.toContain(TOKEN);
    expect(res.stdout).not.toContain(TOKEN);
    expect(existsSync(join(out, '.nerv-mirror.tmp'))).toBe(false);
  });

  it('다시 받으면 바뀐 것만 쓰고, 서버에서 사라진 것은 미러가 쓴 파일만 지운다 — 사람이 고친 것은 되돌린다', async () => {
    const out = scratch();
    route(EXPORT, {
      status: 200,
      body: exportZip({
        'specs/A.md': 'A v1\n',
        'specs/B.md': 'B v1\n',
        'specs/OLD/C.md': 'C v1\n',
        'specs/D.md': 'D v1\n',
      }),
    });
    expect((await run(['pull', out])).code).toBe(0);
    // 사람이 미러 파일 하나를 고치고, 자기 메모를 하나 둔다
    writeFileSync(join(out, 'specs/D.md'), '내가 고침\n');
    writeFileSync(join(out, 'specs/내 메모.txt'), '지우면 안 된다\n');

    route(EXPORT, {
      status: 200,
      body: exportZip({ 'specs/A.md': 'A v1\n', 'specs/B.md': 'B v2\n', 'specs/D.md': 'D v1\n' }),
    });
    const res = await run(['pull', out]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('문서  3편 — 새로 0 · 바뀜 1 · 되돌림 1 · 그대로 1 · 지움 1');
    expect(read(out, 'specs/B.md')).toBe('B v2\n');
    expect(read(out, 'specs/D.md')).toBe('D v1\n');
    expect(existsSync(join(out, 'specs/OLD/C.md'))).toBe(false);
    // 비어 버린 폴더는 거두고, 사람의 파일은 그대로다
    expect(existsSync(join(out, 'specs/OLD'))).toBe(false);
    expect(read(out, 'specs/내 메모.txt')).toBe('지우면 안 된다\n');
  });

  it('--baseline 은 기준선 이름을 주소로 보내고 상태에 남긴다 · --dry-run 은 쓰지 않는다', async () => {
    const out = scratch();
    route(EXPORT, { status: 200, body: exportZip({ 'specs/A.md': 'A\n' }) });
    const dry = await run([
      'pull',
      out,
      '--baseline',
      'R 1',
      '--layout',
      'flat',
      '--no-attachments',
      '--dry-run',
    ]);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('기준선 R 1 · flat · 미리보기(쓰지 않았다)');
    expect(dry.stdout).not.toContain('첨부');
    expect(seen[0]!.url).toBe(`${EXPORT}?baseline=R+1&layout=flat`);
    expect(readdirSync(out)).toEqual([]);

    const res = await run(['pull', out, '--baseline', 'R 1', '--json']);
    expect(res.code).toBe(0);
    const summary = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({ ok: true, basis: 'baseline', baseline: 'R 1', dry_run: false });
    expect(summary['specs']).toMatchObject({ total: 1, added: 1 });
    expect(state(out)).toMatchObject({ basis: 'baseline', baseline: 'R 1' });

    // 다시 받을 때 고르지 않은 것은 지난번 값이다 — 기준선 · 첨부. 고른 것(flat)은 고른 대로다
    seen.length = 0;
    expect((await run(['pull', out, '--layout', 'flat'])).code).toBe(0);
    expect(seen[0]!.url).toBe(`${EXPORT}?baseline=R+1&layout=flat&include=attachments`);
    seen.length = 0;
    expect((await run(['pull', out, '--approved'])).code).toBe(0);
    expect(seen[0]!.url).toBe(`${EXPORT}?basis=approved&layout=flat&include=attachments`);
    expect((await run(['pull', out, '--baseline', 'R 1'])).code).toBe(0);

    const status = await run(['status', out]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('기준선 R 1');
    expect(status.stdout).toContain('문서 1편');
  });
});

describe('REQ-PLG-028 — 거절하는 자리', () => {
  it('상태 파일 없이 비어 있지 않은 폴더에는 쓰지 않는다 — 요청도 보내지 않는다', async () => {
    const out = scratch();
    writeFileSync(join(out, 'README.md'), '사람의 저장소\n');
    const res = await run(['pull', out]);
    expect(res.code).toBe(3);
    expect(res.stderr).toContain('미러가 아닌 폴더에는 쓰지 않는다');
    expect(seen).toHaveLength(0);
  });

  it('미러가 쓰지 않은 같은 이름의 파일을 덮지 않는다 — 아무것도 쓰지 않고 멈춘다', async () => {
    const out = scratch();
    route(EXPORT, { status: 200, body: exportZip({ 'specs/A.md': 'A\n' }) });
    expect((await run(['pull', out])).code).toBe(0);
    mkdirSync(join(out, 'specs/NEW'), { recursive: true });
    writeFileSync(join(out, 'specs/NEW/B.md'), '사람이 먼저 둔 파일\n');
    route(EXPORT, {
      status: 200,
      body: exportZip({ 'specs/A.md': 'A v2\n', 'specs/NEW/B.md': '서버의 B\n' }),
    });
    const res = await run(['pull', out, '--json']);
    expect(res.code).toBe(3);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, code: 'conflict' });
    expect(read(out, 'specs/NEW/B.md')).toBe('사람이 먼저 둔 파일\n');
    expect(read(out, 'specs/A.md')).toBe('A\n');

    expect((await run(['pull', out, '--force'])).code).toBe(0);
    expect(read(out, 'specs/NEW/B.md')).toBe('서버의 B\n');
  });

  it('폴더 밖을 가리키는 zip 항목이 있으면 아무것도 쓰지 않는다', async () => {
    const root = scratch();
    const out = join(root, 'mirror');
    route(EXPORT, {
      status: 200,
      body: makeZip({ 'manifest.json': '{}', 'specs/A.md': 'A\n', '../escaped.md': '밖\n' }),
    });
    const res = await run(['pull', out]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('이 폴더 밖을 가리키는 경로');
    expect(existsSync(join(root, 'escaped.md'))).toBe(false);
    expect(existsSync(join(out, 'specs/A.md'))).toBe(false);
  });

  it('서버의 거절을 한 줄과 다음 걸음으로 바꾼다 — 401 · 없는 기준선', async () => {
    const out = scratch();
    route(EXPORT, {
      status: 401,
      type: 'application/json',
      body: JSON.stringify({ code: 'NERV_UNAUTHENTICATED', message: '인증이 필요합니다' }),
    });
    const unauth = await run(['pull', out]);
    expect(unauth.code).toBe(2);
    expect(unauth.stderr).toContain('서버가 거절했다: 401 NERV_UNAUTHENTICATED');
    expect(unauth.stderr).toContain('다음  토큰이 없거나 만료됐다');
    expect(unauth.stderr).not.toContain(TOKEN);

    route(EXPORT, {
      status: 400,
      type: 'application/json',
      body: JSON.stringify({
        code: 'NERV_PRECONDITION',
        message: '기준선을 찾을 수 없습니다',
        details: { kind: 'invalid_input', field: 'baseline' },
      }),
    });
    const missing = await run(['pull', out, '--baseline', 'NOPE', '--json']);
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      ok: false,
      code: 'invalid_input',
      hint: expect.stringContaining('nerv-mirror baselines') as unknown,
    });
  });

  it('설정이 비어 있으면 요청 전에 nerv-init 을 알린다', async () => {
    const res = await run(['baselines'], {
      cwd: scratch(),
      env: { NERV_SERVER: '', NERV_TOKEN: '' },
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('설정이 비어 있다: NERV_SERVER · NERV_TOKEN');
    expect(res.stderr).toContain('nerv-init');
    expect(seen).toHaveLength(0);
  });

  it('.nerv/env 는 비어 있는 칸만 채운다 — 환경에 있는 값이 이긴다', async () => {
    const cwd = scratch();
    mkdirSync(join(cwd, '.nerv'));
    writeFileSync(
      join(cwd, '.nerv/env'),
      `NERV_SERVER=${base}\nNERV_TOKEN="${TOKEN}"\nNERV_PROJECT=other\nPATH=/nowhere\n`,
    );
    route('/api/v1/projects/clemvion/baselines', {
      status: 200,
      type: 'application/json',
      body: JSON.stringify({ items: [], total: 0 }),
    });
    const res = await run(['baselines'], { cwd, env: { NERV_SERVER: '', NERV_TOKEN: '' } });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('기준선이 없다(clemvion)');
    expect(seen[0]!.authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('REQ-PLG-028 — baselines', () => {
  it('이름 · 만든 날 · 문서 수를 한 줄씩, 메모는 첫 줄만 보인다', async () => {
    route('/api/v1/projects/clemvion/baselines', {
      status: 200,
      type: 'application/json',
      body: JSON.stringify({
        items: [
          {
            name: 'R2',
            created_at: '2026-10-01T09:00:00.000Z',
            item_count: 12,
            note_md: '두 번째 출시\n자세한 설명',
          },
          { name: 'R1', created_at: '2026-09-01T09:00:00.000Z', item_count: 10, note_md: null },
        ],
        total: 2,
      }),
    });
    const res = await run(['baselines']);
    expect(res.code).toBe(0);
    expect(res.stdout.split('\n').slice(0, 3)).toEqual([
      '기준선 2개(clemvion) — 최근 것부터',
      'R2  2026-10-01  문서 12편  두 번째 출시',
      'R1  2026-09-01  문서 10편',
    ]);
    const json = JSON.parse((await run(['baselines', '--json'])).stdout) as {
      baselines: unknown[];
    };
    expect(json.baselines).toEqual([
      { name: 'R2', created_at: '2026-10-01T09:00:00.000Z', item_count: 12, note: '두 번째 출시' },
      { name: 'R1', created_at: '2026-09-01T09:00:00.000Z', item_count: 10, note: '' },
    ]);
  });
});
