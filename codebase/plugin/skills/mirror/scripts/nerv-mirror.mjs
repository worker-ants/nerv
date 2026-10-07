// nerv-mirror — 프로젝트의 스펙 문서와 첨부를 로컬 폴더에 미러한다 (plugin.md §2.7 · REQ-PLG-028)
//
// PATH에 들어가는 이름은 `bin/nerv-mirror`(sh)이고 이 파일이 본체다. 확장자가 `.mjs`인 이유: 설치본에는
// package.json이 없어서(`pack-plugin.mjs`가 뺀다) 확장자 없는 파일은 node 버전에 따라 CommonJS로 읽힌다.
//
// **목록과 다운로드는 이 스크립트가 한다.** 에이전트가 MCP로 문서마다 읽으면 본문이 전부 대화에 들어오고
// (문서 446편이면 호출 446번), 첨부는 받을 수조차 없다. 여기서는 서버의 내보내기(EP-MIR-03 `export.zip`)를
// 한 번 받아 디스크에 바로 쓰고, 에이전트에게는 요약 몇 줄만 돌려준다.
//
// 규칙 다섯:
//   ① **의존성이 없다.** 설치 단계가 없는 플러그인이 기댈 수 있는 것은 node 하나다(ko-style의 ko-lint.mjs와 같다).
//   ② **미러가 쓴 파일만 고치고 지운다.** 무엇을 썼는지는 `.nerv-mirror.json`에 남긴다. 상태 파일 없이 비어 있지
//      않은 폴더에는 쓰지 않는다 — 사람의 파일을 지우는 미러는 다시 쓰이지 않는다.
//   ③ **다 받고 다 검사한 뒤에 바꾼다.** zip을 메모리에서 풀고 CRC를 맞춰 본 뒤 임시 폴더에 쓰고, 그다음에 옮긴다.
//      상태 파일은 마지막이다. 도중에 멈추면 다음 실행이 디스크의 해시로 이어 받는다.
//   ④ **zip 안의 경로를 믿지 않는다.** 절대 경로 · `..` · 역슬래시가 든 항목은 거절한다(서버 `safe-path`와 같은 규칙).
//      상태 파일 · 임시 폴더 이름으로 시작하는 항목도 거절한다 — 미러의 장부를 zip이 덮으면 안 된다.
//   ⑤ **토큰은 헤더에만 쓴다.** 주소 · 출력 · 상태 파일에 남기지 않는다.
//
// 사용: nerv-mirror baselines | pull <경로> [--approved|--latest|--baseline <이름>] | status <경로>

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const STATE_FILE = '.nerv-mirror.json';
const STAGE_DIR = '.nerv-mirror.tmp';
const STATE_FORMAT = 1;
const RETRY_AFTER_CAP_S = 120;

const USAGE = `nerv-mirror — 스펙 문서와 첨부를 로컬 폴더에 미러한다

  nerv-mirror baselines                  고를 수 있는 기준선(이름 · 만든 날 · 문서 수)
  nerv-mirror pull <경로> [옵션]          받아서 그 폴더를 서버와 같게 만든다
  nerv-mirror status <경로>              그 폴더가 무엇을 담고 있나(네트워크 없이)

pull 옵션 — 고르지 않은 것은 이미 미러인 폴더면 지난번 값, 새 폴더면 기본값이다
  --approved            승인본(기본) — 문서마다 가장 최근에 승인된 버전
  --latest              최신 — 초안 · 검토 중을 포함한 가장 새 버전
  --baseline <이름>     기준선 — 그 세트의 문서만, 고정한 버전으로
  --layout tree|flat    폴더 모양(기본 tree — 가장 가까운 영역 폴더)
  --no-attachments      첨부를 받지 않는다
  --dry-run             무엇이 바뀔지만 보인다(쓰지 않는다)
  --force               미러가 아닌 폴더 · 사람이 둔 같은 이름의 파일을 덮는다
  --json                요약을 JSON 한 줄로

환경: NERV_SERVER · NERV_PROJECT · NERV_TOKEN(spec:read) — 없으면 .nerv/env를 읽는다(nerv-init이 쓴다)`;

/** 실패 — 종료 코드와 함께. 2는 서버 쪽, 3은 이 폴더가 받아들이지 않은 것, 1은 쓰는 법이다 */
class MirrorError extends Error {
  constructor(message, { exit = 2, hint = null, code = null } = {}) {
    super(message);
    this.exit = exit;
    this.hint = hint;
    this.code = code;
  }
}

// ── 환경 ──────────────────────────────────────────────────────────────────

/** `.nerv/env`의 `NERV_*`만, 비어 있는 칸만 채운다 — `nerv-env.sh`와 같은 규칙이다 */
function loadEnvFile(env) {
  const file = env.NERV_ENV_FILE || join('.nerv', 'env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    if (!key.startsWith('NERV_')) continue;
    const value = line.slice(eq + 1).replace(/^(["'])(.*)\1$/, '$2');
    if (!env[key]) env[key] = value;
  }
}

function config(env) {
  loadEnvFile(env);
  const server = (env.NERV_SERVER || '').replace(/\/+$/, '');
  const project = env.NERV_PROJECT || '';
  const token = env.NERV_TOKEN || '';
  const missing = [
    ...(server === '' ? ['NERV_SERVER'] : []),
    ...(project === '' ? ['NERV_PROJECT'] : []),
    ...(token === '' ? ['NERV_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    throw new MirrorError(`설정이 비어 있다: ${missing.join(' · ')}`, {
      exit: 1,
      code: 'not_configured',
      hint: 'nerv-init으로 이 저장소를 설정한다(서버 주소 · 프로젝트 · 토큰)',
    });
  }
  return { server, project, token };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

async function request(cfg, path, { accept = 'application/json' } = {}) {
  if (typeof fetch !== 'function') {
    throw new MirrorError('이 node에는 fetch가 없다', {
      exit: 1,
      code: 'node_too_old',
      hint: 'node 18 이상이 필요하다',
    });
  }
  const url = `${cfg.server}${path}`;
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${cfg.token}`, accept, 'user-agent': 'nerv-mirror' },
      });
    } catch (e) {
      throw new MirrorError(`서버에 연결하지 못했다 (${cfg.server})`, {
        code: 'unreachable',
        hint: `NERV_SERVER 가 맞는지 확인한다 — ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    // 한도에 걸리면 서버가 말한 만큼 한 번 기다린다 — 그 이상은 사람이 정한다
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, RETRY_AFTER_CAP_S);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw await failure(res);
    return res;
  }
}

/** 오류 봉투(`{code, message, details:{kind}}`)를 한 줄과 다음 걸음으로 바꾼다 */
async function failure(res) {
  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    // 봉투가 아닌 응답(프록시의 HTML 등) — 상태 코드로만 말한다
    body = null;
  }
  const code = typeof body?.code === 'string' ? body.code : null;
  const kind = typeof body?.details?.kind === 'string' ? body.details.kind : null;
  const field = typeof body?.details?.field === 'string' ? body.details.field : null;
  const message = typeof body?.message === 'string' ? body.message : res.statusText;
  const hint =
    res.status === 401
      ? '토큰이 없거나 만료됐다 — 웹의 설정 → 에이전트 토큰에서 새로 발급해 nerv-init으로 넣는다'
      : res.status === 403
        ? '이 토큰으로는 읽을 수 없다 — spec:read 권한과 토큰의 프로젝트(NERV_PROJECT)를 확인한다'
        : res.status === 413 || kind === 'too_large'
          ? '4GB를 넘는다 — --no-attachments로 첨부 없이 받는다'
          : field === 'baseline'
            ? '그런 기준선이 없다 — nerv-mirror baselines로 이름을 확인한다'
            : res.status === 404
              ? '프로젝트를 찾지 못했다 — NERV_PROJECT를 확인한다'
              : res.status === 429
                ? '요청 한도에 걸렸다 — 잠시 뒤 다시 실행한다'
                : null;
  return new MirrorError(
    `서버가 거절했다: ${res.status}${code === null ? '' : ` ${code}`}${kind === null ? '' : ` (${kind})`} — ${message}`,
    { code: kind ?? code ?? `http_${res.status}`, hint },
  );
}

// ── zip ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 안전한 상대 경로인가 — 절대 경로 · 드라이브 · `..` · `.` · 빈 마디 · 역슬래시 · NUL을 거절한다.
 * zip은 서버가 만들지만 받는 쪽은 그것을 믿지 않는다: 이 폴더 밖에 쓰는 항목은 하나도 없어야 한다.
 */
export function safeEntryPath(name) {
  if (name === '' || name.includes('\\') || name.includes('\0')) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  if (name.startsWith('.nerv-mirror')) return false;
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** zip을 메모리에서 푼다 — 중앙 디렉터리를 읽고, 항목마다 크기와 CRC를 맞춰 본다 */
export function unzip(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new MirrorError('받은 것이 zip이 아니다(끝 표지가 없다)', { code: 'bad_zip' });
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new MirrorError('zip의 목록이 깨졌다', { code: 'bad_zip' });
    }
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (!safeEntryPath(name)) {
      throw new MirrorError(`zip 에 이 폴더 밖을 가리키는 경로가 있다: ${JSON.stringify(name)}`, {
        code: 'unsafe_path',
      });
    }
    if (buf.readUInt32LE(local) !== 0x04034b50) {
      throw new MirrorError(`zip 항목의 머리가 깨졌다: ${name}`, { code: 'bad_zip' });
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data =
      method === 0
        ? Buffer.from(raw)
        : method === 8
          ? inflateRawSync(raw)
          : (() => {
              throw new MirrorError(`모르는 압축 방식(${method}): ${name}`, { code: 'bad_zip' });
            })();
    if (data.length !== size || crc32(data) !== crc) {
      throw new MirrorError(`zip 항목이 손상됐다(크기 · CRC): ${name}`, { code: 'bad_zip' });
    }
    entries.push({ path: name, data });
  }
  return entries;
}

// ── 폴더 ──────────────────────────────────────────────────────────────────

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function readState(out) {
  const file = join(out, STATE_FILE);
  if (!existsSync(file)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new MirrorError(`상태 파일을 읽지 못했다: ${STATE_FILE}`, {
      exit: 3,
      code: 'bad_state',
      hint: '그 파일을 고쳤다면 되돌리고, 아니면 새 경로로 받는다',
    });
  }
  if (state?.format !== STATE_FORMAT || typeof state.files !== 'object' || state.files === null) {
    throw new MirrorError(`상태 파일의 형식을 모른다: ${STATE_FILE}`, {
      exit: 3,
      code: 'bad_state',
    });
  }
  return state;
}

/** 폴더 안의 파일(상태 · 임시 폴더 제외) — 미러가 아닌 폴더인지 볼 때만 쓴다 */
function hasOtherFiles(out) {
  return readdirSync(out).some((name) => name !== STATE_FILE && name !== STAGE_DIR);
}

function fileHash(path) {
  try {
    return statSync(path).isFile() ? sha256(readFileSync(path)) : null;
  } catch {
    return null;
  }
}

/** 지운 파일 위로 비어 버린 폴더를 거둔다 — 이 폴더 안에서만 */
function pruneEmptyDirs(out, path) {
  let dir = dirname(path);
  while (dir !== out && dir.startsWith(out + sep)) {
    try {
      if (readdirSync(dir).length > 0) return;
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

/**
 * 받은 항목으로 폴더를 맞춘다. 반환은 무엇을 했는지(또는 `dryRun`이면 할 일)의 셈이다.
 *
 * - 상태에 없는데 디스크에 다른 내용으로 있는 파일은 **사람의 것**이다 — `force`가 아니면 멈춘다.
 *   같은 내용이면 지난 실행이 옮기다 멈춘 것이라 그대로 받아들인다.
 * - 지우는 것은 상태에 적힌 파일 중 이번에 없는 것뿐이다.
 */
export function applyMirror(out, entries, previous, { dryRun = false, force = false } = {}) {
  const prevFiles = previous?.files ?? {};
  const wanted = new Map(entries.map((e) => [e.path, { data: e.data, hash: sha256(e.data) }]));
  const plan = { added: [], changed: [], same: [], removed: [], restored: [] };
  const conflicts = [];
  for (const [path, { hash }] of wanted) {
    const onDisk = fileHash(join(out, path));
    if (onDisk === hash) {
      plan.same.push(path);
    } else if (onDisk === null) {
      plan.added.push(path);
    } else if (path in prevFiles) {
      // 미러가 쓴 파일이다 — 서버가 바꿨거나(상태의 해시와 다르다) 사람이 고쳤다(상태의 해시와 같다)
      (prevFiles[path] === hash ? plan.restored : plan.changed).push(path);
    } else {
      conflicts.push(path);
      plan.changed.push(path);
    }
  }
  for (const path of Object.keys(prevFiles)) {
    if (!wanted.has(path) && existsSync(join(out, path))) plan.removed.push(path);
  }
  if (conflicts.length > 0 && !force) {
    const shown = conflicts.slice(0, 5).join(', ');
    throw new MirrorError(
      `미러가 쓰지 않은 파일을 덮게 된다: ${shown}${conflicts.length > 5 ? ` 외 ${conflicts.length - 5}개` : ''}`,
      {
        exit: 3,
        code: 'conflict',
        hint: '그 파일을 옮기거나, 덮어도 되면 --force로 다시 실행한다',
      },
    );
  }
  if (dryRun) return plan;

  // ③ 임시 폴더에 다 쓰고 나서 옮긴다
  const stage = join(out, STAGE_DIR);
  rmSync(stage, { recursive: true, force: true });
  const toWrite = [...plan.added, ...plan.changed, ...plan.restored];
  for (const path of toWrite) {
    const target = join(stage, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, wanted.get(path).data);
  }
  for (const path of toWrite) {
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(join(stage, path), target);
  }
  rmSync(stage, { recursive: true, force: true });
  for (const path of plan.removed) {
    rmSync(join(out, path), { force: true });
    pruneEmptyDirs(out, join(out, path));
  }
  return plan;
}

// ── 출력 ──────────────────────────────────────────────────────────────────

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shownPath(path) {
  const rel = relative(process.cwd(), path);
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? path : `./${rel}`;
}

function basisLabel(state) {
  if (state.baseline) return `기준선 ${state.baseline}`;
  return state.basis === 'latest' ? '최신' : '승인본';
}

/** 문서(specs/)와 첨부(attachments/)로 나눠 센다 — 목록 파일 둘은 세지 않는다 */
function tally(plan, prefix) {
  const of = (list) => list.filter((p) => p.startsWith(prefix)).length;
  return {
    added: of(plan.added),
    changed: of(plan.changed),
    restored: of(plan.restored),
    same: of(plan.same),
    removed: of(plan.removed),
  };
}

function tallyLine(t) {
  const parts = [`새로 ${t.added}`, `바뀜 ${t.changed}`];
  if (t.restored > 0) parts.push(`되돌림 ${t.restored}`);
  parts.push(`그대로 ${t.same}`);
  if (t.removed > 0) parts.push(`지움 ${t.removed}`);
  return parts.join(' · ');
}

/** 저장소 안인데 git이 무시하지 않으면 한 줄 알린다 — 고치지는 않는다 */
function gitNote(out) {
  const res = spawnSync('git', ['check-ignore', '-q', out], { stdio: 'ignore' });
  return res.status === 1
    ? `git이 이 폴더를 무시하지 않는다 — 저장소에 올리지 않으려면 .gitignore에 더한다: ${shownPath(out)}`
    : null;
}

// ── 명령 ──────────────────────────────────────────────────────────────────

async function cmdBaselines(cfg, flags) {
  const res = await request(cfg, `/api/v1/projects/${encodeURIComponent(cfg.project)}/baselines`);
  const body = await res.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  if (flags.json) {
    const rows = items.map((b) => ({
      name: b.name,
      created_at: b.created_at,
      item_count: b.item_count,
      note: firstLine(b.note_md),
    }));
    return `${JSON.stringify({ project: cfg.project, baselines: rows })}`;
  }
  if (items.length === 0) {
    return `기준선이 없다(${cfg.project}) — 승인본(--approved)이나 최신(--latest)으로 받는다`;
  }
  const lines = [`기준선 ${items.length}개(${cfg.project}) — 최근 것부터`];
  for (const b of items) {
    const note = firstLine(b.note_md);
    lines.push(
      `${String(b.name)}  ${String(b.created_at ?? '').slice(0, 10)}  문서 ${Number(b.item_count ?? 0)}편${note === '' ? '' : `  ${note}`}`,
    );
  }
  lines.push('받기: nerv-mirror pull <경로> --baseline <이름>');
  return lines.join('\n');
}

function firstLine(text) {
  const line = String(text ?? '')
    .split('\n')[0]
    .trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

async function cmdPull(cfg, target, flags) {
  const out = resolve(target);
  if (existsSync(out) && !statSync(out).isDirectory()) {
    throw new MirrorError(`폴더가 아니다: ${shownPath(out)}`, { exit: 3, code: 'not_a_dir' });
  }
  const previous = existsSync(out) ? readState(out) : null;
  if (previous === null && existsSync(out) && hasOtherFiles(out) && !flags.force) {
    throw new MirrorError(
      `미러가 아닌 폴더에는 쓰지 않는다(비어 있지 않고 상태 파일 ${STATE_FILE}도 없다): ${shownPath(out)}`,
      {
        exit: 3,
        code: 'not_a_mirror',
        hint: '빈 폴더나 새 경로를 고른다 — 그 폴더에 받아도 되면 --force',
      },
    );
  }
  if (previous !== null && previous.project !== cfg.project && !flags.force) {
    throw new MirrorError(`다른 프로젝트의 미러다(${previous.project}): ${shownPath(out)}`, {
      exit: 3,
      code: 'other_project',
      hint: '다른 경로를 고른다',
    });
  }

  // **다시 받을 때는 지난번 기준을 쓴다** — 고르지 않은 것만. 에이전트가 기준을 기억하거나 다시 묻지 않는다
  if (previous !== null) inherit(flags, previous);

  const params = new URLSearchParams();
  if (flags.baseline !== null) params.set('baseline', flags.baseline);
  else params.set('basis', flags.basis);
  params.set('layout', flags.layout);
  if (flags.attachments) params.set('include', 'attachments');
  const started = Date.now();
  const res = await request(
    cfg,
    `/api/projects/${encodeURIComponent(cfg.project)}/export.zip?${params.toString()}`,
    { accept: 'application/zip' },
  );
  const zip = Buffer.from(await res.arrayBuffer());
  const seconds = (Date.now() - started) / 1000;
  const entries = unzip(zip);
  const manifestEntry = entries.find((e) => e.path === 'manifest.json');
  if (manifestEntry === undefined) {
    throw new MirrorError('zip에 manifest.json이 없다', { code: 'bad_zip' });
  }
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));

  if (!flags.dryRun) mkdirSync(out, { recursive: true });
  const plan = applyMirror(out, entries, previous, { dryRun: flags.dryRun, force: flags.force });
  const state = {
    format: STATE_FORMAT,
    server: cfg.server,
    project: cfg.project,
    basis: flags.baseline === null ? flags.basis : 'baseline',
    baseline: flags.baseline,
    layout: flags.layout,
    attachments: flags.attachments,
    synced_at: new Date().toISOString(),
    export: { bytes: zip.length, sha256: sha256(zip) },
    files: Object.fromEntries(entries.map((e) => [e.path, sha256(e.data)])),
  };
  if (!flags.dryRun) writeState(out, state);

  const docs = tally(plan, 'specs/');
  const files = tally(plan, 'attachments/');
  const docCount = Array.isArray(manifest.specs) ? manifest.specs.length : 0;
  const attachmentCount = Array.isArray(manifest.attachments) ? manifest.attachments.length : 0;
  const note = flags.dryRun ? null : gitNote(out);
  if (flags.json) {
    return JSON.stringify({
      ok: true,
      dry_run: flags.dryRun,
      project: cfg.project,
      basis: state.basis,
      baseline: state.baseline,
      layout: flags.layout,
      bytes: zip.length,
      seconds: Number(seconds.toFixed(1)),
      specs: { total: docCount, ...docs },
      attachments: { total: attachmentCount, ...files },
      path: out,
      note,
    });
  }
  const lines = [
    `nerv-mirror · ${cfg.project} · ${basisLabel(state)} · ${flags.layout}${flags.dryRun ? ' · 미리보기(쓰지 않았다)' : ''}`,
    `받음  export.zip ${size(zip.length)} · 요청 1번 · ${seconds.toFixed(1)}초`,
    `문서  ${docCount}편 — ${tallyLine(docs)}`,
  ];
  if (flags.attachments) lines.push(`첨부  ${attachmentCount}개 — ${tallyLine(files)}`);
  lines.push(`위치  ${shownPath(out)} (상태 ${shownPath(join(out, STATE_FILE))})`);
  if (note !== null) lines.push(`참고  ${note}`);
  return lines.join('\n');
}

function inherit(flags, previous) {
  if (!flags.given.basis) {
    if (previous.basis === 'baseline' && typeof previous.baseline === 'string') {
      flags.baseline = previous.baseline;
    } else if (previous.basis === 'latest' || previous.basis === 'approved') {
      flags.basis = previous.basis;
    }
  }
  if (!flags.given.layout && (previous.layout === 'tree' || previous.layout === 'flat')) {
    flags.layout = previous.layout;
  }
  if (!flags.given.attachments && typeof previous.attachments === 'boolean') {
    flags.attachments = previous.attachments;
  }
}

function writeState(out, state) {
  const file = join(out, STATE_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

function cmdStatus(target, flags) {
  const out = resolve(target);
  const state = existsSync(out) ? readState(out) : null;
  if (state === null) {
    throw new MirrorError(`미러가 아니다(상태 파일 ${STATE_FILE}이 없다): ${shownPath(out)}`, {
      exit: 3,
      code: 'not_a_mirror',
      hint: 'nerv-mirror pull <경로> 로 받는다',
    });
  }
  const paths = Object.keys(state.files);
  const missing = paths.filter((p) => !existsSync(join(out, p)));
  const edited = paths.filter(
    (p) => existsSync(join(out, p)) && fileHash(join(out, p)) !== state.files[p],
  );
  const docs = paths.filter((p) => p.startsWith('specs/')).length;
  const attachments = paths.filter((p) => p.startsWith('attachments/')).length;
  if (flags.json) {
    return JSON.stringify({
      project: state.project,
      basis: state.basis,
      baseline: state.baseline,
      layout: state.layout,
      synced_at: state.synced_at,
      specs: docs,
      attachments,
      missing: missing.length,
      edited: edited.length,
      path: out,
    });
  }
  const lines = [
    `nerv-mirror · ${state.project} · ${basisLabel(state)} · ${state.layout}`,
    `받은 때  ${state.synced_at}`,
    `담은 것  문서 ${docs}편 · 첨부 ${attachments}개`,
  ];
  if (missing.length + edited.length > 0) {
    lines.push(
      `달라짐  없어짐 ${missing.length} · 고침 ${edited.length} — 다음 pull이 서버 것으로 되돌린다`,
    );
  }
  return lines.join('\n');
}

// ── 진입점 ────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {
    basis: 'approved',
    baseline: null,
    layout: 'tree',
    attachments: true,
    dryRun: false,
    force: false,
    json: false,
    /** 사람이 고른 것 — 고르지 않은 것은 이미 미러인 폴더면 지난번 값을 쓴다 */
    given: { basis: false, layout: false, attachments: false },
  };
  const positional = [];
  const picked = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--approved') {
      flags.basis = 'approved';
      picked.push(arg);
    } else if (arg === '--latest') {
      flags.basis = 'latest';
      picked.push(arg);
    } else if (arg === '--baseline' || arg.startsWith('--baseline=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : rest[(i += 1)];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new MirrorError('--baseline에 이름이 없다', { exit: 1, code: 'usage' });
      }
      flags.baseline = value;
      picked.push('--baseline');
    } else if (arg === '--layout' || arg.startsWith('--layout=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : rest[(i += 1)];
      if (value !== 'tree' && value !== 'flat') {
        throw new MirrorError('--layout은 tree나 flat이다', { exit: 1, code: 'usage' });
      }
      flags.layout = value;
      flags.given.layout = true;
    } else if (arg === '--no-attachments') {
      flags.attachments = false;
      flags.given.attachments = true;
    } else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--json') flags.json = true;
    else if (arg.startsWith('--')) {
      throw new MirrorError(`모르는 옵션: ${arg}`, { exit: 1, code: 'usage' });
    } else positional.push(arg);
  }
  flags.given.basis = picked.length > 0;
  if (picked.length > 1) {
    throw new MirrorError(`기준은 하나만 고른다: ${picked.join(' · ')}`, {
      exit: 1,
      code: 'usage',
    });
  }
  return { command, positional, flags };
}

async function main(argv) {
  const { command, positional, flags } = parseArgs(argv);
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return USAGE;
  }
  if (command === 'status') {
    if (positional.length !== 1) throw new MirrorError('status <경로>', { exit: 1, code: 'usage' });
    return cmdStatus(positional[0], flags);
  }
  if (command === 'baselines') return cmdBaselines(config(process.env), flags);
  if (command === 'pull') {
    if (positional.length !== 1) {
      throw new MirrorError('받을 경로가 없다: nerv-mirror pull <경로>', {
        exit: 1,
        code: 'usage',
      });
    }
    return cmdPull(config(process.env), positional[0], flags);
  }
  throw new MirrorError(`모르는 명령: ${command}`, {
    exit: 1,
    code: 'usage',
    hint: 'nerv-mirror --help',
  });
}

/** 직접 실행했나 — 테스트가 import 할 때는 main을 돌리지 않는다 */
function invokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const invoked = invokedDirectly();
if (invoked) {
  const argv = process.argv.slice(2);
  main(argv).then(
    (text) => {
      process.stdout.write(`${text}\n`);
    },
    (e) => {
      const json = argv.includes('--json');
      if (e instanceof MirrorError) {
        if (json) {
          process.stdout.write(
            `${JSON.stringify({ ok: false, code: e.code, message: e.message, hint: e.hint })}\n`,
          );
        } else {
          process.stderr.write(`실패  ${e.message}\n${e.hint === null ? '' : `다음  ${e.hint}\n`}`);
        }
        process.exit(e.exit);
      }
      process.stderr.write(`실패  ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(2);
    },
  );
}
