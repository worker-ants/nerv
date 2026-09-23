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
// 세는 것은 열둘이다.
//   ① 코드가 읽는 변수가 전표(또는 걷힌 이름 표)에 있는가 — 없으면 운영자가 존재를 알 길이 없다
//   ② `.env.example` 의 키가 전표에 있는가
//   ③ 한 변수가 전표에 두 번 나오지 않는가 — 두 행이 다른 말을 하면 어느 쪽이 계약인가
//   ④ 전표가 소비자를 `api`·`worker`·`web` 이라 적은 변수를 그 코드가 실제로 읽는가
//   ⑤ **걷힌 이름을 코드가 실제로 읽는가** — 읽지 않으면 그 거부는 유령이다(2026-09-13 신설)
//   ⑥ 걷힌 이름이 `.env.example` 에 없는가 — 있으면 운영자에게 기동 거부를 배포하는 셈이다
//   ⑦ **리터럴이 손잡이를 무력화하지 않는가** — 배포 산출물이 포트를 박아 두면 전표의
//     그 행은 있는데 듣지 않는 손잡이다(2026-09-14 신설 · REQ-CB-038)
//   ⑧ `.env.example` 의 공개 오리진 포트가 앞문 포트와 맞는가 — 앞문을 옮기고 주소를
//     안 옮긴 배치는 틀린 주소로 서명된 쿠키를 받는다
//   ⑨ k8s 의 ConfigMap 포트와 매니페스트의 `containerPort` 가 같은가 — 정적 필드라
//     설정에서 받을 수 없고, 갈리면 전 트래픽이 죽는데 롤아웃은 성공으로 보인다
//   ⑩ 그 포트들의 기본값이 이미지 `ENV` 와 전표에서 같은가
//   ⑪ **걷힌 이름이 compose 의 api·worker 에 전달되는가** — compose 는 env 를 키 목록으로
//     넘기므로, 넘기지 않으면 옛 이름을 둔 배치가 조용히 기본값으로 뜬다(2026-09-14 신설)
//   ⑫ **전표가 api·worker 소비자라 적은 키를 k8s 가 주는가** — compose 에 배선하고 k8s 를
//     두고 가는 결함이 세 번 되풀이됐다(웹훅 키·미러 경로·메일 다섯). `envFrom` 이라
//     파드는 정상으로 뜨고 그 기능만 꺼진다(2026-09-22 신설 · REQ-CB-049)
//
// **값을 대조하는 범위는 포트와 오리진뿐이다.** 이 스크립트는 오래 "값이나 기본값은
// 대조하지 않는다 — 그것은 렌더러를 다시 만드는 일이고 실제로 어긋난 것은 언제나 있고
// 없음이었다" 고 적어 두었고, 그 말은 여전히 맞다. 예외를 좁게 두는 이유는 2026-09-14 에
// **있고 없음이 아닌 어긋남**을 실제로 만났기 때문이다: `NERV_API_PORT` 는 전표에 있고 코드가
// 읽는데 compose 가 `"8080"` 을 박아 두어 **아무 배치에서도 듣지 않았다.** 층을 정하는 값은
// 여러 자리가 같은 숫자를 따로 적어야 하므로, 그 일치만 센다. 범위를 넓히면 렌더러가 된다.
//
// ## 걷힌 이름이 왜 따로 있는가 (2026-09-13)
//
// `NERV_PUBLIC_URL` 은 화면 주소와 API 주소를 겸하다가 둘로 갈렸다(REQ-CB-036). 전표는
// **운영자가 설정할 수 있는 손잡이**의 목록이라 걷힌 이름은 그 표의 것이 아니다 — 그런데
// 서버는 그 이름을 여전히 읽는다: **기동을 거부하기 위해서**다(REQ-CB-037). ① 을 그대로
// 두면 그 읽기가 "전표에 없는 변수를 읽는다" 로 잡히고, 이름을 전표에 남기면 아직 쓸 수
// 있는 손잡이로 읽힌다. 둘 다 거짓이므로 표를 하나 더 둔다.
//
// 사용: node scripts/check-env-table.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const CODEBASE = resolve(import.meta.dirname, '..');
const REPO = resolve(CODEBASE, '..');
const DOC = resolve(REPO, 'docs/04-mvp/codebase.md');
const ENV_EXAMPLE = resolve(CODEBASE, '.env.example');
const fail = [];

/** 전표가 다루는 이름 공간 — 그 밖의 환경변수(CI·`NODE_ENV` 등)는 이 표의 것이 아니다 */
const OWNED = /^(?:(?:NERV|POSTGRES|VALKEY|MINIO)_[A-Z0-9_]+|DATABASE_URL)$/;

// -- 전표 --------------------------------------------------------------------
const doc = readFileSync(DOC, 'utf8');
const whole = doc.slice(doc.indexOf('### 5.2 `.env` 변수 전표'), doc.indexOf('### 5.2a'));
// 걷힌 이름 표는 같은 절 안에 있지만 **다른 표**다 — 경계에서 자른다.
const RETIRED_HEAD = '#### 걷힌 이름';
const cut = whole.indexOf(RETIRED_HEAD);
const section = cut === -1 ? whole : whole.slice(0, cut);
const retiredSection = cut === -1 ? '' : whole.slice(cut);
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

// -- 걷힌 이름 --------------------------------------------------------------
const retired = new Set();
for (const row of retiredSection.split('\n').filter((line) => line.startsWith('|'))) {
  const firstCell = row.slice(1).split('|')[0] ?? '';
  for (const m of firstCell.matchAll(/`([A-Z][A-Z0-9_]*)`/g)) {
    if (declared.has(m[1])) {
      fail.push(
        `\`${m[1]}\` 이 §5.2 전표와 걷힌 이름 표에 **둘 다** 있다 — 쓸 수 있는 손잡이인가 아닌가`,
      );
    }
    retired.add(m[1]);
  }
}

// -- .env.example ------------------------------------------------------------
for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
  const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
  if (m === null) continue;
  const name = m[1];
  if (!OWNED.test(name)) continue;
  // ⑥ 걷힌 이름을 실물 전표에 남기면, 그대로 복사한 운영자는 **기동 거부**를 받는다.
  if (retired.has(name)) {
    fail.push(`.env.example 에 걷힌 이름 \`${name}\` 이 남았다 — 그대로 쓰면 서버가 뜨지 않는다`);
  } else if (!declared.has(name)) {
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
  if (!declared.has(name) && !retired.has(name)) {
    fail.push(
      `코드가 \`${name}\` 을 읽는데 §5.2 전표에 없다 (${where}) — 운영자는 그 존재를 모른다`,
    );
  }
}

// -- ⑤ 걷힌 이름의 거부가 실재하는가 -----------------------------------------
//
// **약속한 거부가 없으면 그것은 유령이다.** 표가 "설정돼 있으면 기동을 거부한다" 고 적는데
// 읽는 코드가 없으면, 옛 이름을 그대로 둔 배치가 조용히 기본값으로 떠서 운영자는 자기
// 설정이 무시된다는 사실을 틀린 주소로 서명된 쿠키를 받고서야 안다(REQ-CB-037 의 전제).
for (const name of retired) {
  if (readBy.has(name)) continue;
  fail.push(
    `걷힌 이름 \`${name}\` 을 읽는 코드가 없다 — 표는 기동 거부를 약속하는데 ` +
      `그 거부가 어디에도 없다(옛 이름을 둔 배치가 조용히 기본값으로 뜬다)`,
  );
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

// -- ⑦⑧⑨⑩ 층을 정하는 손잡이가 실제로 듣는가 (REQ-CB-038) -------------------
//
// **전표의 모든 변수에 걸면 소음이 된다.** compose 가 내부 주소를 일부러 박는 자리가 있다
// (`NERV_S3_ENDPOINT: http://minio:9000` — 컨테이너 안에서만 쓰는 이름이라 손잡이가 아니다).
// 그래서 **층을 정하는 것들만** 본다: 리슨 포트 둘과 공개 오리진 둘.
const LAYER_PORTS = ['NERV_API_PORT', 'NERV_WEB_PORT'];

// 앞문이 api 를 찾아가는 주소. **전표의 손잡이가 아니다** — 이미지 내부 배선이고 값은
// `NERV_API_PORT` 에서 조립된다. 이름을 상수로 두는 이유는 위 READS 정규식이 이 파일에서
// `env['...']` 꼴을 보면 "코드가 읽는 변수" 로 세고, 그러면 ① 이 자기 자신을 잡기 때문이다.
const UPSTREAM = 'NERV_API_UPSTREAM';

/** 파일이 없으면 판정하지 않는다 — 모르는 것을 실패로 만들면 소음이 된다. */
function yamlOrNull(rel) {
  const full = resolve(REPO, rel);
  try {
    return parseYaml(readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

/** 문자열 안에 `${NAME` 이 있는가 — compose 치환이 걸렸다는 뜻이다. */
const substitutes = (value, name) => String(value).includes(`\${${name}`);

// ⑦ compose 가 포트를 박아 두지 않았는가
let composeSeen = 0;
for (const rel of ['deploy/compose/docker-compose.yml', 'deploy/compose/docker-compose.e2e.yml']) {
  const doc = yamlOrNull(rel);
  if (doc === null || typeof doc.services !== 'object') continue;
  for (const [service, spec] of Object.entries(doc.services ?? {})) {
    const env = spec?.environment ?? {};
    if (typeof env !== 'object' || Array.isArray(env)) continue;
    for (const name of LAYER_PORTS) {
      if (!(name in env)) continue;
      composeSeen += 1;
      if (!substitutes(env[name], name)) {
        fail.push(
          `${rel} 의 \`${service}.environment.${name}\` 이 리터럴 \`${env[name]}\` 이다 — ` +
            `전표는 손잡이라고 적는데 .env 값이 여기 닿지 않는다(${name} 를 치환으로 쓴다)`,
        );
      }
    }
    // 업스트림·헬스체크·publish 는 같은 포트를 **따로** 적는 자리다 — 한 곳만 고치면 깨진다.
    if (typeof env[UPSTREAM] === 'string' && !substitutes(env[UPSTREAM], 'NERV_API_PORT')) {
      fail.push(
        `${rel} 의 \`${service}.environment.${UPSTREAM}\` 이 api 포트를 따로 적는다 ` +
          `(\`${env[UPSTREAM]}\`) — NERV_API_PORT 에서 조립한다`,
      );
    }
    for (const part of spec?.healthcheck?.test ?? []) {
      if (typeof part !== 'string' || !part.includes('127.0.0.1:')) continue;
      if (!substitutes(part, 'NERV_API_PORT')) {
        fail.push(
          `${rel} 의 \`${service}.healthcheck\` 가 api 포트를 따로 적는다 — NERV_API_PORT 에서 조립한다`,
        );
      }
    }
    // 앞문(NERV_WEB_PORT 를 받는 서비스)의 publish 는 컨테이너 쪽을 그 변수로 적어야 한다.
    if ('NERV_WEB_PORT' in env) {
      for (const mapping of spec?.ports ?? []) {
        if (typeof mapping === 'string' && !substitutes(mapping, 'NERV_WEB_PORT')) {
          fail.push(
            `${rel} 의 \`${service}.ports\` 가 앞문 포트를 따로 적는다(\`${mapping}\`) — ` +
              `컨테이너 쪽을 NERV_WEB_PORT 로 적는다`,
          );
        }
      }
    }
  }
}
if (composeSeen === 0) {
  fail.push(
    'compose 에서 포트 손잡이를 한 자리도 읽지 못했다 — 검사가 비었다(파일 모양이 바뀌었나)',
  );
}

// ⑧ `.env.example` 의 공개 오리진 포트가 앞문 포트와 맞는가
const example = new Map();
for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
  const m = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (m !== null) example.set(m[1], m[2].trim());
}
/** 오리진의 포트 — 없으면 스킴 기본값. 파싱 불가면 null. */
function portOf(origin) {
  try {
    const url = new URL(origin);
    return url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
  } catch {
    return null;
  }
}
const frontDoor = example.get('NERV_WEB_PORT');
for (const name of ['NERV_WEB_URL', 'NERV_API_URL']) {
  const value = example.get(name);
  if (value === undefined || frontDoor === undefined) continue;
  const port = portOf(value);
  if (port !== null && port !== frontDoor) {
    fail.push(
      `.env.example 의 \`${name}\`(${value}) 포트가 NERV_WEB_PORT(${frontDoor})와 다르다 — ` +
        `공개 주소 둘은 앞문을 가리킨다(앞문을 옮기면 두 주소도 함께 옮긴다)`,
    );
  }
}
// 같은 값을 코드도 들고 있다 — 포트를 옮기고 이것을 두면 틀린 주소로 서명된 쿠키가 나간다.
const originsSrc = readFileSync(resolve(CODEBASE, 'apps/api/src/common/origins.ts'), 'utf8');
const defaultOrigin = /DEFAULT_ORIGIN = '([^']+)'/.exec(originsSrc)?.[1];
if (defaultOrigin !== undefined && frontDoor !== undefined) {
  const port = portOf(defaultOrigin);
  if (port !== null && port !== frontDoor) {
    fail.push(
      `common/origins.ts 의 DEFAULT_ORIGIN(${defaultOrigin}) 포트가 ` +
        `NERV_WEB_PORT(${frontDoor})와 다르다 — 공개 주소 기본값이 앞문을 가리키지 않는다`,
    );
  }
}

// ⑨ k8s — ConfigMap 의 포트와 매니페스트의 containerPort 가 같은가
//
// **여기가 유일한 방어선이다.** `containerPort` 는 정적 필드라 ConfigMap 값을 참조할 수 없고,
// 둘이 갈리면 전 트래픽이 죽는데 롤아웃은 성공으로 보인다. Service 의 `port` 는 서비스 자신의
// 포트(외부에서 부르는 번호)라 대조 대상이 아니다 — `targetPort` 가 이름으로 따라간다.
const configMap = yamlOrNull('deploy/k8s/base/configmap.yaml')?.data ?? null;
if (configMap !== null) {
  for (const [name, rel] of [
    ['NERV_API_PORT', 'deploy/k8s/base/api/deployment.yaml'],
    ['NERV_WEB_PORT', 'deploy/k8s/base/web/deployment.yaml'],
  ]) {
    const declared = configMap[name];
    const doc = yamlOrNull(rel);
    const ports = doc?.spec?.template?.spec?.containers?.[0]?.ports ?? [];
    const container = ports[0]?.containerPort;
    if (declared === undefined || container === undefined) continue;
    if (String(declared) !== String(container)) {
      fail.push(
        `k8s 의 ${name}(${declared} · base/configmap.yaml)과 ${rel} 의 ` +
          `containerPort(${container})가 다르다 — 정적 필드라 설정에서 받을 수 없고, ` +
          `갈리면 전 트래픽이 죽는데 롤아웃은 성공으로 보인다`,
      );
    }
  }
}

// ⑩ 이미지 ENV 의 기본값이 전표(=.env.example)와 같은가
const dockerfileWeb = readFileSync(resolve(REPO, 'deploy/docker/Dockerfile.web'), 'utf8');
const imageWebPort = /ENV NERV_WEB_PORT=(\d+)/.exec(dockerfileWeb)?.[1];
const declaredWebPort = example.get('NERV_WEB_PORT');
if (
  imageWebPort !== undefined &&
  declaredWebPort !== undefined &&
  imageWebPort !== declaredWebPort
) {
  fail.push(
    `Dockerfile.web 의 ENV NERV_WEB_PORT(${imageWebPort})가 .env.example(${declaredWebPort})과 ` +
      `다르다 — 이 기본값이 \`listen ;\` 을 막는 방어선이라 전표와 같아야 한다`,
  );
}

// -- ⑪ 걷힌 이름이 compose 의 api·worker 에 전달되는가 ------------------------
//
// **⑤ 가 "읽는 코드가 있는가" 를 세는 것으로는 부족했다.** 코드가 읽어도 그 이름이 컨테이너
// env 에 들어가지 않으면 거부는 발화하지 않는다 — compose 는 env 를 **키 목록**으로 넘기므로
// 적지 않은 이름은 `.env` 에 있어도 전달되지 않는다(k8s 는 `envFrom` 이 ConfigMap 전체를
// 넘기므로 이 문제가 없다). 2026-09-14 실측에서 `NERV_PUBLIC_URL` 은 어느 서비스에도 없어
// **거부가 한 번도 발화할 수 없었고**, `NERV_HTTP_PORT` 는 api 에만 있었다.
const composeMain = yamlOrNull('deploy/compose/docker-compose.yml');
for (const svc of ['api', 'worker']) {
  const env = composeMain?.services?.[svc]?.environment;
  if (env === undefined || typeof env !== 'object' || Array.isArray(env)) continue;
  for (const name of retired) {
    if (name in env) continue;
    fail.push(
      `deploy/compose/docker-compose.yml 의 \`${svc}\` 가 걷힌 이름 \`${name}\` 을 받지 않는다 — ` +
        `전표는 api·worker 의 기동 거부를 약속하는데 그 이름이 컨테이너에 들어가지 않으면 ` +
        `거부는 발화하지 않는다(\`${name}: \${${name}:-}\` 로 넘긴다)`,
    );
  }
}

// -- ⑫ 전표의 api·worker 손잡이가 k8s 에 실재하는가 (2026-09-22 신설 · REQ-CB-049) -----
//
// **compose 에 배선하고 k8s 를 두고 가는 것이 이 저장소의 되풀이되는 결함이다.**
// 2026-09-13 `NERV_GITHUB_WEBHOOK_SECRET` 이 k8s 어디에도 없었고(비면 EP-WHK-01 이 모든
// 배송을 401 로 거절한다), 2026-09-14 `NERV_EXPORT_DIR` 이 어느 배치에도 없어 md 미러는
// 명세에 있으면서 **어떤 배포에서도 산출되지 않았다.** 2026-09-22 메일 다섯도 같은
// 자리였다 — compose 는 완비, k8s 는 전무였다.
//
// **`envFrom` 이라 조용하다.** 키가 없어도 파드는 정상으로 뜨고 꺼지는 것은 기능뿐이다:
// 초대 메일이 나가지 않고 아웃박스에 쌓이지도 않으며, SMTP 에서 유도되는 가입 이메일
// 인증 강제가 함께 내려앉는다. ⑨⑩ 은 포트를, check-k8s-render 는 주소를 세는데
// **키의 실재를 세는 자리가 없었다** — 그래서 세 번 같은 모양으로 새어 나갔다.
//
// 소비자가 api·worker 인 전표 키는 셋 중 하나가 준다:
//   base/configmap.yaml · overlays/<env>/secret.example.yaml · 이미지의 `ENV`
// 셋째가 있는 이유는 `NERV_PLUGIN_DIST` 다 — 전표 행 자신이 "이미지가 ENV 로 준다" 고
// 적고 `Dockerfile.server` 가 실제로 준다. 환경마다 바꿀 손잡이가 아니라 ConfigMap 의
// 것이 아니다. **예외 목록을 박는 대신 주는 자리를 세면** 그 구분이 저절로 선다.
const givenByK8s = new Set(Object.keys(configMap ?? {}));
for (const overlay of ['dev', 'prod']) {
  const doc = yamlOrNull(`deploy/k8s/overlays/${overlay}/secret.example.yaml`);
  for (const key of Object.keys(doc?.stringData ?? {})) givenByK8s.add(key);
}
for (const rel of ['deploy/docker/Dockerfile.server', 'deploy/docker/Dockerfile.web']) {
  const text = readFileSync(resolve(REPO, rel), 'utf8');
  for (const m of text.matchAll(/^ENV\s+([A-Z][A-Z0-9_]*)=/gm)) givenByK8s.add(m[1]);
}
if (givenByK8s.size === 0) {
  fail.push('k8s 에서 설정 키를 한 자리도 읽지 못했다 — 검사가 비었다(파일 모양이 바뀌었나)');
}
let k8sChecked = 0;
for (const [name, consumer] of consumers) {
  // ④ 와 같은 제외다 — `compose`·`E2E`·`drizzle-kit`·`이미지` 만 적힌 행은 k8s 의 것이 아니다.
  if (/compose|E2E|drizzle-kit|이미지/.test(consumer)) continue;
  if (!/\b(?:api|worker)\b/.test(consumer)) continue;
  k8sChecked += 1;
  if (givenByK8s.has(name)) continue;
  fail.push(
    `§5.2 가 \`${name}\` 의 소비자를 "${consumer.trim()}" 이라 적는데 k8s 어디에도 없다 — ` +
      `base/configmap.yaml 도 overlays/*/secret.example.yaml 도 이미지 ENV 도 주지 않는다. ` +
      `\`envFrom\` 이라 파드는 정상으로 뜨고 그 기능만 조용히 꺼진다`,
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

console.log(
  `.env 전표 정합 — 전표 ${declared.size}행 · 걷힌 이름 ${retired.size}개 · ` +
    `코드가 읽는 변수 ${readBy.size}개 · compose 포트 손잡이 ${composeSeen}자리 · ` +
    `k8s 가 줘야 하는 키 ${k8sChecked}개`,
);
