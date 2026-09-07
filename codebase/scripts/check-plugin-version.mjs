// 플러그인 내용이 바뀌었으면 버전도 올랐는가 (REQ-PLG-017 · 4.6 §3.6)
//
// **버전이 곧 배달이다.** 설치된 플러그인은 `plugin.json` 의 `version` 이 오를 때만
// 새 사본을 받는다 — 같은 버전이면 스킬을 고쳐도 이미 설치한 사람은 옛 판을 계속
// 읽는다. 오류도 경고도 없이, 자기가 낡았다는 것을 알 방법도 없이.
//
// 실제로 그렇게 됐다(2026-09-04 · 실사용 보고): 되읽기 절을 스킬에 넣었는데 버전을
// 그대로 두어, 설치본에는 `attachment_read` 가 **한 번도 나오지 않았다.** 되읽는 길을
// 알리려던 수정이 정작 세션에는 닿지 않은 것이다.
//
// 사용: node scripts/check-plugin-version.mjs <base-ref>
//   base-ref 가 없으면(로컬 등) 아무것도 하지 않고 통과한다 — 비교 대상이 없으면
//   판정도 없다. CI 는 항상 준다.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..'); // 저장소 루트
const PLUGIN_DIR = 'codebase/plugin';
const MANIFEST = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;

/** 배달되지 않는 것들 — 테스트·문서는 패키지에 들어가지 않으므로 버전을 요구하지 않는다 */
const NOT_SHIPPED = [/\.spec\.ts$/, /^codebase\/plugin\/package\.json$/];

const base = process.argv[2];
if (base === undefined || base === '') {
  console.log('base-ref 가 없다 — 비교하지 않는다');
  process.exit(0);
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// **커밋한 것과 아직 커밋하지 않은 것을 함께 본다**(2026-09-07 정정).
//
// 예전에는 `base...HEAD` 만 봤다 — 커밋 범위라 **작업 트리의 변경이 보이지 않는다.**
// `preflight` 는 보통 커밋 **전에** 돌므로, 로컬에서는 초록이고 CI 에서만 빨간 자리가
// 생겼다(실측 2026-09-07: `plugin/README.md` 를 고치고 버전을 안 올린 채 초록을 봤다).
// 규약 7 이 "로컬 초록이 CI 초록을 뜻하지 않는다" 고 적은 그 부류이고, 여기서는 그 차이를
// 없앨 수 있다: CI 에는 커밋되지 않은 변경이 없으므로 합집합은 CI 에서 같은 답을 준다.
const changed = [
  ...git('diff', '--name-only', `${base}...HEAD`, '--', PLUGIN_DIR).split('\n'),
  ...git('diff', '--name-only', base, '--', PLUGIN_DIR).split('\n'),
].filter(
  (f, at, all) => f !== '' && all.indexOf(f) === at && !NOT_SHIPPED.some((re) => re.test(f)),
);

if (changed.length === 0) {
  console.log('플러그인 패키지 변경 없음');
  process.exit(0);
}

const versionAt = (ref) => {
  try {
    return JSON.parse(git('show', `${ref}:${MANIFEST}`)).version;
  } catch {
    return null; // 그 시점에 파일이 없었다 = 신설. 아래에서 통과한다.
  }
};

const before = versionAt(base);
// **지금 파일의 버전**을 본다 — 변경 감지가 작업 트리를 보므로 버전도 같은 시점을 봐야
// 한다. `HEAD:` 로 읽으면 "README 는 고쳤고 버전도 올렸는데 아직 커밋 전" 인 상태가
// 실패로 나온다. CI 에서는 체크아웃이 곧 HEAD 라 답이 같다.
const after = JSON.parse(readFileSync(resolve(ROOT, MANIFEST), 'utf8')).version;

if (before === null || before !== after) {
  console.log(`플러그인 ${before ?? '(신설)'} → ${after} · 변경 ${changed.length}건`);
  process.exit(0);
}

console.error(
  [
    `플러그인 패키지가 바뀌었는데 버전이 ${after} 그대로다.`,
    '',
    ...changed.map((f) => `  ${f}`),
    '',
    '설치된 쪽은 같은 버전이면 새 사본을 받지 않는다 — 고친 내용이 세션에 닿지 않는다.',
    `${MANIFEST} 의 version 을 올리고, 카탈로그 둘·README·매뉴얼(ko·en)도 같이 맞춘다(4.6 §3.6).`,
  ].join('\n'),
);
process.exit(1);
