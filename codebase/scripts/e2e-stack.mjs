#!/usr/bin/env node
// L3 E2E 스택의 포트·프로젝트 이름 할당기 — 정본: docs/04-mvp/codebase.md §4.3
//
// **한 기계에서 여러 세션이 동시에 E2E 를 돌린다**는 것이 이 파일이 있는 이유다.
// compose 프로젝트 이름과 공개 포트가 고정이면 두 번째 세션이 첫 번째의 컨테이너를
// 재사용하거나(같은 이름) 기동에 실패한다(같은 포트) — 둘 다 조용히 남의 테스트를 깨뜨린다.
//
// 그래서 세션마다 ① 고유한 프로젝트 이름 ② 겹치지 않는 포트 3개를 잡고, 그 값을
// `.e2e/<id>.json` 에 남긴다. up · test · logs · down 이 같은 파일을 읽으므로 명령이
// 나뉘어도 같은 스택을 가리킨다.
//
// 개발 스택의 포트는 건드리지 않는다(.env 전표가 정본) — E2E 는 자기 대역에서만 논다.

import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.e2e');
const COMPOSE_FILE = resolve(ROOT, '../deploy/compose/docker-compose.e2e.yml');

/**
 * E2E 전용 포트 대역. 개발 스택(5432·6379·8080·8090·9000·9001)과 겹치지 않고,
 * 리눅스 기본 ephemeral 대역(32768~)보다 아래라 OS 가 임의로 가져가지 않는다.
 * 한 세션이 연속 3개를 쓰고 10 씩 건너뛴다 — 100 세션까지 자리가 있다.
 */
const BAND_START = 19_000;
const BAND_SLOTS = 100;
const SLOT_STRIDE = 10;

/** 세션 식별자 — 명시값이 없으면 작업 트리 경로에서 만든다(같은 트리 = 같은 스택) */
function sessionId() {
  const explicit = process.env['NERV_E2E_ID'];
  if (explicit !== undefined && explicit !== '')
    return explicit.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  return createHash('sha256').update(ROOT).digest('hex').slice(0, 8);
}

/** 포트가 **지금** 비어 있나. 127.0.0.1 만 본다 — compose 도 거기에만 연다 */
function isFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.once('listening', () => server.close(() => done(true)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * 슬롯 하나(연속 3포트)를 잡는다. 해시로 고른 자리에서 시작해 비어 있는 슬롯까지 훑는다 —
 * 해시로 시작하는 이유는 **같은 트리가 늘 같은 포트를 얻게** 하기 위해서다(로그·북마크가 안 흔들린다).
 */
async function allocateSlot(id) {
  const start =
    Number.parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) % BAND_SLOTS;
  for (let i = 0; i < BAND_SLOTS; i += 1) {
    const base = BAND_START + ((start + i) % BAND_SLOTS) * SLOT_STRIDE;
    const ports = { http: base, pg: base + 1, valkey: base + 2 };
    const free = await Promise.all(Object.values(ports).map(isFree));
    if (free.every(Boolean)) return ports;
  }
  throw new Error(
    `E2E 포트 대역(${BAND_START}~${BAND_START + BAND_SLOTS * SLOT_STRIDE})에 빈 슬롯이 없습니다.`,
  );
}

function statePath(id) {
  return join(STATE_DIR, `${id}.json`);
}

function readState(id) {
  try {
    return JSON.parse(readFileSync(statePath(id), 'utf8'));
  } catch {
    return null;
  }
}

/** compose·테스트가 함께 보는 환경 — 한 곳에서 만든다 */
function envFor(state) {
  return {
    COMPOSE_PROJECT_NAME: state.project,
    NERV_E2E_HTTP_PORT: String(state.ports.http),
    NERV_E2E_PG_PORT: String(state.ports.pg),
    NERV_E2E_VALKEY_PORT: String(state.ports.valkey),
    NERV_E2E_BASE_URL: `http://localhost:${state.ports.http}`,
    NERV_E2E_DATABASE_URL: `postgres://nerv:e2e@localhost:${state.ports.pg}/nerv`,
    // 하네스가 스크래치 DB 를 만들 때 쓰는 것과 같은 값 — 두 곳에 적지 않는다
    DATABASE_URL: `postgres://nerv:e2e@localhost:${state.ports.pg}/nerv`,
  };
}

function compose(state, args, opts = {}) {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...envFor(state) },
    ...opts,
  });
}

async function up(id) {
  // 이미 떠 있으면 그 포트를 그대로 쓴다 — 재기동마다 주소가 바뀌면 브라우저 탭이 낡는다
  const existing = readState(id);
  const ports =
    existing !== null && (await slotStillOurs(existing)) ? existing.ports : await allocateSlot(id);
  const state = { id, project: `nerv-e2e-${id}`, ports };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(id), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  compose(state, ['up', '-d', '--build', '--wait']);
  process.stdout.write(
    `E2E 스택 준비됨 — ${state.project}\n` +
      `  웹      ${envFor(state).NERV_E2E_BASE_URL}\n` +
      `  DB      localhost:${ports.pg}\n` +
      `  valkey  localhost:${ports.valkey}\n`,
  );
}

/** 우리가 이미 그 포트를 물고 있으면 free 하지 않다 — 남이 가져간 것과 구분한다 */
async function slotStillOurs(state) {
  try {
    const out = execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'ps', '-q'], {
      env: { ...process.env, ...envFor(state) },
      encoding: 'utf8',
    });
    return out.trim() !== '';
  } catch {
    return false;
  }
}

function requireState(id) {
  const state = readState(id);
  if (state === null) {
    throw new Error(`E2E 스택이 기동된 적이 없습니다(${id}). 먼저:  pnpm e2e:up`);
  }
  return state;
}

const id = sessionId();
const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'up':
    await up(id);
    break;
  case 'down': {
    const state = readState(id);
    if (state !== null) {
      compose(state, ['down', '-v', '--remove-orphans']);
      rmSync(statePath(id), { force: true });
    }
    break;
  }
  case 'logs':
    compose(requireState(id), ['logs', '--tail', '200', ...rest]);
    break;
  case 'env': {
    // eval $(pnpm -s e2e:env) 로 셸에 실어 쓴다 — 사람이 직접 curl 할 때
    const env = envFor(requireState(id));
    for (const [key, value] of Object.entries(env))
      process.stdout.write(`export ${key}=${value}\n`);
    break;
  }
  case 'run': {
    // 테스트를 **할당된 환경 안에서** 돌린다 — 포트를 사람이 옮겨 적지 않는다
    const state = requireState(id);
    execFileSync(rest[0], rest.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, ...envFor(state) },
    });
    break;
  }
  default:
    process.stderr.write('사용법: e2e-stack.mjs <up|down|logs|env|run …>\n');
    process.exit(2);
}
