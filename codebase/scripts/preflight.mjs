#!/usr/bin/env node
// push 전 로컬 검사 — CI 의 `check` 잡을 **그대로** 비춘다 (.github/workflows/ci.yml)
//
// 규약 7 은 네 명령을 적는다(`typecheck · lint · format:check · test`). 그런데 CI 는 **열하나**를
// 돌린다 — 플러그인 버전 게이트 · 배포 산출물 정합 · 백로그 현황 정합 · md ↔ html 정합 ·
// .env 전표 정합 · 문서 간 참조 · schema drift 가 더 있다. 로컬에서 넷만 돌리고 초록을 본 사람은 나머지
// 여섯을 **한 번도 돌리지 않은 채** push 하게 된다.
//
// 이 파일이 하는 일은 그 차이를 없애는 것이다. **순서도 CI 와 같다** — CI 가 게이트를 테스트
// 앞에 둔 이유가 있고(테스트가 깨져도 드리프트는 잡힌다) 여기서 순서를 바꾸면 그 이유가 죽는다.
//
// ## 이것이 잡지 못하는 것
//
// **느린 기계에서만 터지는 실패는 못 잡는다.** 2026-09-05~06 에 CI 가 다섯 번 빨갰는데
// 그 커밋들은 로컬에서 네 검사를 전부 통과했다 — md 왕복 검사가 로컬 10.7초였고 CI 는 같은
// 스위트를 3.9배로 돌아 30초 상한을 넘겼다. preflight 를 돌렸어도 초록이었을 것이다.
// 그 부류는 검사 자체를 고쳐야 하고(레인 분리 · 비례 상한), 실제로 그렇게 고쳤다.
//
// 그래서 이 파일은 **"CI 가 볼 것을 미리 본다"** 는 약속이지 **"CI 가 초록이다"** 는 약속이
// 아니다. 그 둘을 섞으면 다음 사람이 빨간 CI 를 보고 preflight 를 믿지 않게 된다.
//
// ## 쓰는 법
//
//   pnpm preflight          — CI 의 check 잡 (기본)
//   pnpm preflight --l2     — L2 까지 (실제 Postgres · .env 필요)
//   pnpm preflight --fast   — 게이트를 전부 건너뛴다(빠른 반복용 — push 전에는 쓰지 않는다)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');

const args = new Set(process.argv.slice(2));
const withL2 = args.has('--l2');
const fast = args.has('--fast');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

/** CI 의 한 단계. `cwd` 는 기본이 `codebase/` 다 — 배포 정합만 저장소 루트다. */
const steps = [
  { name: 'lint', cmd: 'pnpm', argv: ['lint'] },
  { name: 'typecheck', cmd: 'pnpm', argv: ['exec', 'tsc', '-b'] },
  { name: 'format:check', cmd: 'pnpm', argv: ['format:check'] },
  {
    name: '플러그인 버전 게이트',
    gate: true,
    cmd: 'node',
    // CI 는 PR 의 base 와 견준다. 로컬에는 그 base 가 없으므로 **origin/main** 과 견준다 —
    // 없으면 스크립트가 스스로 통과한다(비교 대상이 없으면 판정도 없다).
    argv: ['scripts/check-plugin-version.mjs', baseRef()],
  },
  {
    name: '배포 산출물 정합',
    gate: true,
    cwd: REPO,
    cmd: 'sh',
    argv: [
      '-c',
      [
        'diff deploy/scripts/nerv-backup.sh deploy/k8s/base/backup/nerv-backup.sh',
        'kubectl kustomize deploy/k8s/overlays/dev > /dev/null',
        'kubectl kustomize deploy/k8s/overlays/prod > /dev/null',
      ].join(' && '),
    ],
  },
  {
    name: '백로그 현황 정합',
    gate: true,
    cmd: 'node',
    argv: ['scripts/check-backlog-status.mjs'],
  },
  {
    name: 'md ↔ html 정합',
    gate: true,
    cmd: 'node',
    argv: ['scripts/check-md-html.mjs'],
  },
  {
    name: '.env 전표 정합',
    gate: true,
    cmd: 'node',
    argv: ['scripts/check-env-table.mjs'],
  },
  {
    name: '문서 간 참조',
    gate: true,
    cmd: 'node',
    argv: ['scripts/check-doc-links.mjs'],
  },
  {
    name: 'schema drift',
    gate: true,
    cmd: 'sh',
    argv: ['-c', 'pnpm db:generate && git diff --exit-code -- packages/schema/drizzle'],
  },
  // CI 의 머지 전 레인과 같은 값으로 돌린다 — 전수 왕복까지 본다.
  { name: 'L1', cmd: 'pnpm', argv: ['test'], env: { NERV_ROUNDTRIP_FULL: '1' } },
];

if (withL2) {
  steps.push({
    name: 'L2 (실제 Postgres)',
    cmd: 'pnpm',
    argv: ['test:integration'],
    needsEnv: true,
  });
}

function baseRef() {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** `.env` 를 읽어 환경에 얹는다 — L2 는 그것 없이 돌지 않는다(규약 7). */
function loadEnvFile() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return null;
  const out = {};
  for (const line of readFileLines(file)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function readFileLines(file) {
  return spawnSync('cat', [file], { encoding: 'utf8' }).stdout.split('\n');
}

const envFile = loadEnvFile();
const results = [];
let failed = null;

for (const step of steps) {
  if (fast && step.gate) {
    results.push({ name: step.name, skipped: true });
    continue;
  }
  if (step.needsEnv && envFile === null) {
    console.error(`${RED}✗${OFF} ${step.name} — codebase/.env 가 없다. L2 는 돌 수 없다.`);
    failed = step.name;
    break;
  }
  process.stdout.write(`${DIM}▸ ${step.name}${OFF}\n`);
  const began = Date.now();
  const r = spawnSync(step.cmd, step.argv, {
    cwd: step.cwd ?? ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(step.needsEnv ? envFile : {}), ...(step.env ?? {}) },
  });
  const took = ((Date.now() - began) / 1000).toFixed(1);
  results.push({ name: step.name, ok: r.status === 0, took });
  if (r.status !== 0) {
    failed = step.name;
    break;
  }
}

console.log('');
for (const r of results) {
  if (r.skipped) {
    console.log(`  ${DIM}– ${r.name} (--fast 로 건너뜀)${OFF}`);
    continue;
  }
  const mark = r.ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
  console.log(`  ${mark} ${r.name} ${DIM}${r.took}s${OFF}`);
}

if (failed !== null) {
  console.error(`\n${RED}preflight 실패 — ${failed}${OFF}`);
  console.error('고치고 다시 돌린다. 남은 단계는 실행되지 않았다.');
  process.exit(1);
}

if (fast) {
  const gates = steps.filter((s) => s.gate === true).length;
  console.log(
    `\n${DIM}--fast 였다 — 게이트 ${gates}개는 돌지 않았다. push 전에는 그냥 돌린다.${OFF}`,
  );
} else if (!withL2) {
  console.log(`\n${DIM}CI 의 check 잡과 같은 범위다. L2 까지 보려면 --l2.${OFF}`);
}
console.log(`${GREEN}preflight 통과${OFF}`);
