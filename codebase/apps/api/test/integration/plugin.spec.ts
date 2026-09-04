// E06 — 플러그인 배포 표면 (api.md §2.11 EP-PLG-01·02 · REQ-API-086)
//
// 이 스위트가 지키는 것은 **갱신 신호**다. Claude Code 는 카탈로그의 `version` 문자열이
// 바뀔 때만 새 아카이브를 받는다 — zip 을 바꾸고 버전을 그대로 두면 이미 설치한 사람은
// 캐시된 사본을 계속 쓴다. 오류도 경고도 없이. 산문으로 적어 두면 다음 릴리스에 잊는다.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PUBLIC_URL = 'https://nerv.test.example.com';

let db: ScratchDb;
let app: NestFastifyApplication;

beforeAll(async () => {
  // 아카이브는 빌드 산출물이다 — 테스트가 만들어 두고 시작한다(CI 에 zip 이 없어도 돈다).
  execFileSync('node', [join(WORKSPACE, 'scripts', 'pack-plugin.mjs')], { cwd: WORKSPACE });

  db = await createScratchDb('nerv_plugin');
  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  process.env['NERV_PUBLIC_URL'] = PUBLIC_URL;
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await db.drop();
  delete process.env['NERV_PUBLIC_URL'];
});

function manifest(): { name: string; version: string } {
  return JSON.parse(
    readFileSync(join(WORKSPACE, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
  ) as { name: string; version: string };
}

interface Catalog {
  name: string;
  owner: { name: string; url: string };
  plugins: {
    name: string;
    version: string;
    source: { source: string; url: string; sha256: string };
  }[];
}

async function catalog(): Promise<Catalog> {
  const res = await app.inject({ method: 'GET', url: '/plugin/marketplace.json' });
  expect(res.statusCode).toBe(200);
  return res.json() as Catalog;
}

describe('EP-PLG-01 — 마켓플레이스 카탈로그', () => {
  it('무인증으로 200 이다 — 마켓플레이스 추가는 인증 이전의 일이다', async () => {
    const res = await app.inject({ method: 'GET', url: '/plugin/marketplace.json' });
    expect(res.statusCode).toBe(200);
  });

  /**
   * URL 로 받은 카탈로그는 **그 파일 하나만** 내려받는다 — 상대경로는 가리킬 대상이 없다.
   * git 경로용 카탈로그(`.claude-plugin/marketplace.json`)와 갈라지는 유일한 지점이고,
   * 여기서 `./` 가 새어 나오면 URL 설치가 통째로 실패한다.
   */
  it('플러그인 소스가 절대 URL 이다 — 상대경로는 URL 배포에서 해소되지 않는다', async () => {
    const body = await catalog();
    const source = body.plugins[0]?.source;
    expect(source?.source).toBe('archive');
    expect(source?.url.startsWith(`${PUBLIC_URL}/plugin/`)).toBe(true);
    expect(source?.url).not.toContain('./');
  });

  it('주소는 NERV_PUBLIC_URL 에서만 온다 — 요청의 Host 를 읽지 않는다', async () => {
    // 서버는 Host 를 검증하지 않는다(실측). 그것을 카탈로그에 실으면 이 응답이
    // "이 서버가 내어준, 남의 zip 을 가리키는 카탈로그" 가 된다.
    const res = await app.inject({
      method: 'GET',
      url: '/plugin/marketplace.json',
      headers: { host: 'evil.example.com' },
    });
    const body = res.json() as Catalog;
    expect(body.plugins[0]?.source.url.startsWith(PUBLIC_URL)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('evil.example.com');
  });

  it('버전은 plugin.json 이 정본이다 — 카탈로그가 두 번째 원본이 되지 않는다', async () => {
    const body = await catalog();
    expect(body.plugins[0]?.version).toBe(manifest().version);
    expect(body.plugins[0]?.name).toBe(manifest().name);
  });

  /**
   * **카탈로그는 자기 안에서 모순되지 않는다**(실측 2026-09-04).
   *
   * 아카이브만 캐시하고 매니페스트는 매번 읽던 동안, 버전이 오르면 카탈로그가 새 버전을
   * 말하면서 **옛 파일을 가리켰다** — 그 주소로 설치하러 가면 없는 파일이다. 이미지 안에서는
   * 둘 다 바뀌지 않아 드러나지 않지만, 개발 트리와 재빌드 사이에서 갈라진다.
   */
  it('버전과 아카이브 이름이 같은 것을 말한다 — 캐시가 둘을 갈라 놓지 않는다', async () => {
    const body = await catalog();
    const plugin = body.plugins[0];
    expect(plugin?.source.url.endsWith(`${plugin.name}-${plugin.version}.zip`)).toBe(true);
    expect(plugin?.version).toBe(manifest().version);
  });

  it('sha256 이 실제로 서빙되는 바이트의 해시다', async () => {
    const body = await catalog();
    const url = new URL(body.plugins[0]?.source.url ?? '');
    const zip = await app.inject({ method: 'GET', url: url.pathname });
    expect(zip.statusCode).toBe(200);
    expect(createHash('sha256').update(zip.rawPayload).digest('hex')).toBe(
      body.plugins[0]?.source.sha256,
    );
  });
});

describe('EP-PLG-02 — 아카이브', () => {
  it('다른 이름을 요구하면 404 다 — 없는 버전에 옛 파일을 주지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/plugin/nerv-9.9.9.zip' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    // 라우트에 고정 content-type 이 걸려 있어도 **에러 봉투는 봉투여야 한다**(§1.4)
    expect(res.headers['content-type']).toContain('application/json');
    expect((res.json() as Record<string, unknown>)['details']).toMatchObject({
      kind: 'not_found',
    });
  });

  /**
   * **훅은 이 파일을 실행한다.** zip 이 모드를 잃으면 설치는 성공하고 훅만 조용히 죽는다 —
   * `SessionStart` 주입도 `Stop` 게이트도 사라지는데 아무도 오류를 보지 못한다.
   */
  it('bin/ 의 실행 비트가 아카이브를 건너서도 남는다', async () => {
    const body = await catalog();
    const zip = await app.inject({
      method: 'GET',
      url: new URL(body.plugins[0]?.source.url ?? '').pathname,
    });
    const buf = Buffer.from(zip.rawPayload);

    // 중앙 디렉터리를 읽어 external attributes 상위 16비트(유닉스 모드)를 본다
    const modes = new Map<string, number>();
    let i = buf.indexOf(Buffer.from('PK\x01\x02', 'binary'));
    while (i >= 0) {
      const nameLen = buf.readUInt16LE(i + 28);
      const name = buf.subarray(i + 46, i + 46 + nameLen).toString('utf8');
      modes.set(name, buf.readUInt32LE(i + 38) >>> 16);
      i = buf.indexOf(Buffer.from('PK\x01\x02', 'binary'), i + 4);
    }

    for (const exec of ['bin/nerv-hook-forward', 'bin/nerv-outbox', 'bin/nerv-env.sh']) {
      expect(modes.has(exec)).toBe(true);
      expect((modes.get(exec) ?? 0) & 0o111).not.toBe(0);
    }
  });

  it('플러그인 루트가 아카이브 루트다 — .claude-plugin/plugin.json 이 최상위에 있다', async () => {
    const body = await catalog();
    const zip = await app.inject({
      method: 'GET',
      url: new URL(body.plugins[0]?.source.url ?? '').pathname,
    });
    const buf = Buffer.from(zip.rawPayload);

    const names: string[] = [];
    let i = buf.indexOf(Buffer.from('PK\x01\x02', 'binary'));
    while (i >= 0) {
      const nameLen = buf.readUInt16LE(i + 28);
      names.push(buf.subarray(i + 46, i + 46 + nameLen).toString('utf8'));
      i = buf.indexOf(Buffer.from('PK\x01\x02', 'binary'), i + 4);
    }
    expect(names).toContain('.claude-plugin/plugin.json');
    expect(names).toContain('hooks/hooks.json');
    // 저장소 전용 파일은 패키지에 들어가지 않는다
    expect(names).not.toContain('plugin-package.spec.ts');
  });

  it('본문이 실제로 풀리는 zip 이다 — 첫 항목을 해제해 본다', async () => {
    const body = await catalog();
    const zip = await app.inject({
      method: 'GET',
      url: new URL(body.plugins[0]?.source.url ?? '').pathname,
    });
    const buf = Buffer.from(zip.rawPayload);

    // 첫 로컬 헤더에서 이름·압축 크기를 읽어 그 바이트만 풀어 본다
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const method = buf.readUInt16LE(8);
    const compressed = buf.readUInt32LE(18);
    const start = 30 + nameLen + extraLen;
    const payload = buf.subarray(start, start + compressed);
    const plain = method === 0 ? payload : inflateRawSync(payload);
    expect(plain.length).toBeGreaterThan(0);
  });
});
