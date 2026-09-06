// `.env` 전표가 실물과 맞는가 (4.2 codebase.md §5.2)
//
// **전표가 소비자를 적으면 그것이 계약이다.** §5.2 는 스스로 "`.env.example` 이 이 표의
// 실물이다" 라고 선언하는데, 2026-09-06 실측에서 그 선언이 세 방향으로 거짓이었다.
//   - 전표에만 있고 `.env.example` 에 없는 변수 둘
//   - 양쪽 어디에도 없는데 **코드가 실제로 읽는** 변수 셋
//   - `NERV_LOG_LEVEL` — 전표가 소비자를 "api · worker" 라 적는데 읽는 코드가 **0건**
//     (운영자가 로그 레벨을 바꿔도 아무 일이 일어나지 않았다. 유령 설정이다)
//   - `NERV_S3_ENDPOINT` 행이 **두 번** 있고 "필수" 열이 서로 달랐다
//
// 세는 것은 넷이다.
//   ① 코드가 읽는 변수가 전표에 있는가 — 없으면 운영자가 존재를 알 길이 없다
//   ② `.env.example` 의 키가 전표에 있는가
//   ③ 한 변수가 전표에 두 번 나오지 않는가 — 두 행이 다른 말을 하면 어느 쪽이 계약인가
//   ④ 전표가 소비자를 `api`·`worker`·`web` 이라 적은 변수를 그 코드가 실제로 읽는가
//
// 값이나 기본값은 대조하지 않는다. 그것은 렌더러를 다시 만드는 일이고, 실제로 어긋난
// 것은 언제나 **있고 없음**이었다.
//
// 사용: node scripts/check-env-table.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const CODEBASE = resolve(import.meta.dirname, '..');
const REPO = resolve(CODEBASE, '..');
const DOC = resolve(REPO, 'docs/04-mvp/codebase.md');
const ENV_EXAMPLE = resolve(CODEBASE, '.env.example');
const fail = [];

/** 전표가 다루는 이름 공간 — 그 밖의 환경변수(CI·`NODE_ENV` 등)는 이 표의 것이 아니다 */
const OWNED = /^(?:(?:NERV|POSTGRES|VALKEY|MINIO)_[A-Z0-9_]+|DATABASE_URL)$/;

// -- 전표 --------------------------------------------------------------------
const doc = readFileSync(DOC, 'utf8');
const section = doc.slice(doc.indexOf('### 5.2 `.env` 변수 전표'), doc.indexOf('### 5.2a'));
const declared = new Map();
const consumers = new Map();
// 한 행이 변수 둘을 함께 적는 자리가 있다(`NERV_S3_ACCESS_KEY` · `NERV_S3_SECRET_KEY`) —
// 성질이 같아 설명이 하나인 쌍이다. 첫 칸의 백틱 이름을 **전부** 센다.
for (const row of section.split('\n').filter((line) => line.startsWith('|'))) {
  const firstCell = row.slice(1).split('|')[0] ?? '';
  for (const m of firstCell.matchAll(/`([A-Z][A-Z0-9_]*)`/g)) {
    const name = m[1];
    if (declared.has(name)) {
      fail.push(`§5.2 전표에 \`${name}\` 행이 둘이다 — 두 행이 다른 말을 하면 어느 쪽이 계약인가`);
    }
    declared.set(name, true);
    // 소비자 열(4번째 칸) — ④ 가 이것을 실물과 견준다
    consumers.set(name, row.slice(1).split('|')[3] ?? '');
  }
}
if (declared.size === 0) fail.push('§5.2 전표를 찾지 못했다 — 절이 사라졌거나 표 모양이 바뀌었다');

// -- .env.example ------------------------------------------------------------
for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
  const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
  if (m === null) continue;
  const name = m[1];
  if (OWNED.test(name) && !declared.has(name)) {
    fail.push(`.env.example 의 \`${name}\` 이 §5.2 전표에 없다`);
  }
}

// -- 코드가 읽는 것 ----------------------------------------------------------
//
// `process.env['X']` · `process.env.X` · `env['X']` 셋을 본다.
//
// **보는 범위는 서버다.** §5.2 는 `.env.example` 의 전표이고 그 파일은 서버·워커·compose
// 가 읽는다. `apps/cli` 는 **설치되는 클라이언트**라 환경 계약이 따로 있고(`NERV_SERVER`·
// `NERV_TOKEN` — 4.7 §3.1 과 제품 매뉴얼의 설치 장), 테스트 하네스가 세우는 변수는
// 운영자에게 주는 손잡이가 아니다. 둘을 여기 섞으면 전표가 자기 것이 아닌 것을 떠안는다.
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.tsbuild', 'coverage', 'test', 'e2e'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.spec\.|\.test\.|playwright|e2e/.test(entry))
      out.push(full);
  }
  return out;
}

const READS = /(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;
const readBy = new Map();
const SERVER_ROOTS = ['apps/api/src', 'apps/web/src', 'packages/schema/src', 'scripts'];
for (const root of SERVER_ROOTS.map((d) => join(CODEBASE, d))) {
  for (const file of sources(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(READS)) {
      const name = m[1] ?? m[2];
      if (name === undefined || !OWNED.test(name)) continue;
      if (!readBy.has(name)) readBy.set(name, relative(REPO, file));
    }
  }
}

for (const [name, where] of [...readBy].sort()) {
  if (!declared.has(name)) {
    fail.push(
      `코드가 \`${name}\` 을 읽는데 §5.2 전표에 없다 (${where}) — 운영자는 그 존재를 모른다`,
    );
  }
}

// -- ④ 반대 방향 — 전표가 적은 소비자가 실재하는가 ---------------------------
//
// **이것이 `NERV_LOG_LEVEL` 을 잡는 검사다.** 전표는 소비자를 "api · worker" 라 적었고
// 읽는 코드는 0건이었다 — 운영자가 값을 바꿔도 아무 일이 없는 **유령 설정**이다. 없는
// 손잡이를 있다고 적는 것은 있는 손잡이를 안 적는 것보다 나쁘다: 앞의 것은 사람이
// 시도했다가 실패하고, 뒤의 것은 애초에 시도하지 않는다.
//
// `compose`·`drizzle-kit`·`이미지` 만 적힌 행은 우리 소스가 읽지 않는 것이 정상이다.
for (const [name, consumer] of consumers) {
  // `compose`(컨테이너가 읽는다) · `E2E`(하네스가 읽는다) · `drizzle-kit`(도구가 읽는다)
  // 만 적힌 행은 우리 소스가 읽지 않는 것이 정상이다. 그 낱말이 있으면 판정하지 않는다 —
  // **모르는 것을 실패로 만들면 검사가 아니라 소음이 된다.**
  if (/compose|E2E|drizzle-kit|이미지/.test(consumer)) continue;
  if (!/\b(?:api|worker|web)\b/.test(consumer)) continue;
  if (readBy.has(name)) continue;
  fail.push(
    `§5.2 가 \`${name}\` 의 소비자를 "${consumer.trim()}" 이라 적는데 ` +
      `읽는 코드가 없다 — 운영자가 값을 바꿔도 아무 일이 일어나지 않는다`,
  );
}

if (fail.length > 0) {
  console.error(
    [
      '`.env` 전표(4.2 §5.2)가 실물과 어긋났다.',
      '',
      ...fail.map((f) => `  ${f}`),
      '',
      '전표가 소비자를 적으면 그것이 계약이다 — 없는 손잡이를 있다고 적거나,',
      '있는 손잡이를 적지 않으면 운영자는 둘 다 알 길이 없다.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`.env 전표 정합 — 전표 ${declared.size}행 · 코드가 읽는 변수 ${readBy.size}개`);
