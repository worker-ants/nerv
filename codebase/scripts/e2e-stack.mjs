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

/**
 * **실행 전에 스택을 기동 직후 상태로 되돌린다.**
 *
 * compose 파일이 약속한 것은 "매 실행이 같은 한 벌에서 출발한다" 인데, tmpfs 가 지키는
 * 것은 **매 기동**까지였다 — 컨테이너가 살아 있는 동안은 행도 쌓이고 쿼터도 남는다.
 * 그 둘이 다르다는 것을 실측이 말한다(2026-09-10, 같은 스택에 연속 실행):
 *
 * ① **Valkey 의 요청 쿼터**(`nerv:rl:*` · api.md §1.8 — 웹 세션은 사용자당 600/분).
 *    웹 L3 한 번이 시드 사용자 **한 명**으로 435~465 요청을 쓴다. 한 번은 600 밑이지만
 *    두 번이 같은 고정 창에 떨어지면 넘고, 넘는 순간부터 창이 끝날 때까지 **모든** 요청이
 *    429 다.
 * ② **api 프로세스 메모리의 인증 쿼터**(better-auth · IP당 `/sign-in/email` 10/분).
 *    웹 L3 한 번이 로그인 5회(준비 1 + 실패 1 + 가입 뒤 1 + 실시간 1 + 로그아웃 1)를 쓴다.
 *    그래서 **세 번째 연속 실행은 `global-setup` 로그인에서 죽는다**. 저장소가 프로세스
 *    메모리라 지우는 방법은 api 를 다시 띄우는 것뿐이다.
 * ③ **DB 의 가입 계정**(`shell.spec.ts` 가 실행마다 새 주소로 하나씩 남긴다 — 6 → 7 → 8).
 *    판정을 바꾸지는 않지만 "같은 한 벌" 은 아니다.
 *
 * 쿼터가 바닥나면 빨강은 **그때 마침 돌던 테스트**에 앉는다. 그래서 재실행마다 다른
 * 테스트가 깨졌다(실측: `global-setup` 로그인 · `review-scroll` 발견 카드 · `shell`
 * 로그아웃) — 자기 변경과 아무 상관 없는 자리에 앉는 빨강이 가장 나쁜 신호다. CI 는 늘
 * 새 스택 위에서 한 번만 돌아 이것을 보지 못한다. 되돌리는 쪽이 로컬과 CI 를 같은 것으로
 * 만든다. 판정은 하나도 건드리지 않는다 — 지우는 것은 잔량뿐이다.
 *
 * **`up --wait api` 가 migrate·seed 를 다시 돌린다**(한 번짜리 의존이다). 그것이 ③ 을
 * 지우는 자리이고 의도한 것이다 — 대신 **이 스택의 DB 는 매 실행 초기화된다**. 손으로
 * 넣어 둔 행은 다음 `pnpm test:e2e` 가 가져간다(이 스택은 원래 매 실행 폐기 대상이다).
 *
 * Valkey 는 쿼터 키만 지운다 — `FLUSHALL` 은 나중에 누가 다른 것을 두면 그것까지 조용히
 * 가져간다. 실패는 삼킨다: 스택이 안 떠 있는 경우가 대부분이고, 그 사정은 러너 자신이 더
 * 정확하게 말한다(웹·API 양쪽에 안내가 있다).
 */
function resetToBootState(state) {
  const clearQuotaKeys =
    "local n=0 for _,k in ipairs(redis.call('keys','nerv:rl:*')) do redis.call('del',k) n=n+1 end return n";
  try {
    compose(state, ['exec', '-T', 'valkey', 'valkey-cli', 'EVAL', clearQuotaKeys, '0'], {
      stdio: 'ignore',
    });
    compose(state, ['restart', '-t', '3', 'api'], { stdio: 'ignore' });
    // 시드 재적재 + 건강해질 때까지 대기. `restart` 는 기다려 주지 않아서, 안 기다리면
    // 첫 로그인이 아직 안 뜬 서버를 두드리고 그 실패가 이번엔 `global-setup` 에 앉는다.
    compose(state, ['up', '-d', '--wait', 'api'], { stdio: 'ignore' });
  } catch {
    process.stderr.write(
      'E2E 스택을 기동 직후 상태로 되돌리지 못했습니다 — 떠 있지 않거나 응답하지 않습니다.\n' +
        '  연속 실행이라면 앞 실행이 쓴 분당 쿼터가 남아 429 로 깨질 수 있습니다(pnpm e2e:up).\n',
    );
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
    resetToBootState(state);
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
