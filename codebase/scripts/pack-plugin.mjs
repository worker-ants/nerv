#!/usr/bin/env node
// 플러그인 아카이브를 만든다 — `plugin/` → `plugin-dist/nerv-<version>.zip` (4.6 §3.5)
//
// 서버가 이 파일을 `/plugin/<이름>-<버전>.zip` 으로 서빙하고 기동 시 sha256 을 계산한다
// (`modules/plugin/plugin.service.ts`). 여기서 지켜야 할 것이 셋이다.
//
//   ① **실행 비트.** `bin/nerv-hook-forward` 와 `bin/nerv-outbox` 는 훅이 직접 실행한다.
//      zip 이 모드를 잃으면 설치는 성공하고 훅만 조용히 죽는다 — 가장 나쁜 실패 모양이다.
//      그래서 external attributes 상위 16비트에 유닉스 모드를 싣는다.
//   ② **결정성.** 타임스탬프를 고정해 같은 소스가 같은 바이트를 낸다. 정확성에 필요하진
//      않지만("갱신 신호는 version 이지 해시가 아니다") "패키지가 실제로 바뀌었나"에
//      답할 수 있게 된다.
//   ③ **의존성 없음.** node:zlib 만 쓴다. 빌드 이미지에 `zip` 이 있는지에 걸지 않는다.
//
// 사용: node scripts/pack-plugin.mjs [출력 디렉터리]

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'plugin');
const OUT_DIR = resolve(process.argv[2] ?? join(ROOT, 'plugin-dist'));

/** 패키지에 들어가지 않는 것 — 개발 부산물과 저장소 전용 파일이다. */
const EXCLUDE = new Set(['node_modules', 'plugin-package.spec.ts', 'package.json', '.DS_Store']);

// ── zip 원시 구조 ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 1980-01-01 00:00 — zip 이 표현할 수 있는 가장 이른 시각. 고정해서 결정성을 얻는다. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function collect(dir, base = SOURCE) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (EXCLUDE.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collect(full, base));
    else if (st.isFile()) out.push({ path: relative(base, full), mode: st.mode & 0o7777 });
  }
  return out;
}

function build(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.split('\\').join('/'), 'utf8');
    const raw = readFileSync(join(SOURCE, entry.path));
    const deflated = deflateRawSync(raw, { level: 9 });
    // 압축이 원본보다 크면 그대로 담는다(method 0) — 작은 파일에서 실제로 일어난다.
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(stored ? 0 : 8, 8); // method
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // version made by — 유닉스(3) · zip 3.0
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    // ① 실행 비트가 사는 자리 — 상위 16비트가 유닉스 모드다.
    dir.writeUInt32LE((entry.mode << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(join(SOURCE, '.claude-plugin', 'plugin.json'), 'utf8'));
const entries = collect(SOURCE);
if (entries.length === 0) {
  console.error('plugin/ 이 비어 있습니다.');
  process.exit(1);
}

const zip = build(entries);
mkdirSync(OUT_DIR, { recursive: true });
// 버전이 오르면 옛 zip 이 옆에 남는다 — 어느 것이 현재인지 말해 주는 것이 없으면
// 사람도 스크립트도 잘못된 파일을 집는다. 이 디렉터리는 **지금 것 하나**만 갖는다.
for (const stale of readdirSync(OUT_DIR)) {
  if (/^.+-\d+\.\d+\.\d+\.zip$/.test(stale)) rmSync(join(OUT_DIR, stale));
}
const target = join(OUT_DIR, `${manifest.name}-${manifest.version}.zip`);
writeFileSync(target, zip);
// 서버가 이름을 짓지 않아도 되게 매니페스트도 옆에 둔다 — 이미지에 plugin/ 전체는 없다.
writeFileSync(join(OUT_DIR, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`${relative(ROOT, target)} · 파일 ${entries.length}개 · ${zip.length}바이트`);
