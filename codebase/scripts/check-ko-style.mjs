// 새로 쓴 한국어 문장이 문장 규약을 지키는가 (AGENTS.md 「한국어 문장 규약」 · 용어 사전 §3.4 · REQ-CB-058)
//
// **판정은 한 곳이다.** 문체 플러그인 `ko-style` 의 검사기(`ko-style/skills/ko-style/scripts/ko-lint.mjs`)를
// 그대로 부른다 — 훅이 에이전트에게 알리는 것과 CI 가 막는 것이 같은 규칙 표에서 나온다(4.6 §7).
// 규칙은 저장소 루트 `.ko-style.json`(용어 사전 §3.4 표의 사본)과 플러그인의 공통 규칙 표다.
//
// **새로 쓴 줄만 본다.** docs/ 에는 §3.4 가 생기기 전의 문장이 800곳 넘게 남아 있다. 파일 전체를
// 보면 첫날부터 모든 명세 수정이 막힌다 — §3.4 의 적용 규칙("새로 쓰는 문장은 처음부터 이 표를
// 따른다")과 같은 범위다.
//
// **무엇이 실패인가.** 차단(block) 규칙 전부, 그리고 규범 · 팀 어휘 층의 경고다. AI 말투 층(연결 어미
// 뒤 쉼표 · "A가 아니라 B" 되풀이)은 알리기만 한다 — 빈도로만 판단하는 규칙이고 §3.4 가 정한 것이
// 아니다. 2026-09-27 에 최근 PR 넷(#157~#160)의 새 줄을 돌려 보았을 때 걸린 것은 그 층뿐이었다.
//
// **빠지는 길.** 인용이면 따옴표로 감싼다(따옴표 안은 검사하지 않는다). 그래도 그대로 둬야 하면 그
// 줄 끝에 `ko-style-ignore: <이유>` 를 단다 — 이유가 없으면 듣지 않는다.
//
// 사용: node scripts/check-ko-style.mjs <base-ref>
//   base-ref 가 없으면(로컬 등) 아무것도 하지 않고 통과한다 — 비교 대상이 없으면 판정도 없다.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..'); // 저장소 루트 — .ko-style.json 이 여기 있다
const LINT = resolve(ROOT, 'codebase/ko-style/skills/ko-style/scripts/ko-lint.mjs');

const base = process.argv[2];
if (base === undefined || base === '') {
  console.log('base-ref 가 없다 — 비교하지 않는다');
  process.exit(0);
}

const run = spawnSync(
  process.execPath,
  [LINT, 'check', '--base', base, '--levels', 'block,warn', '--json'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (run.status !== 0 && run.status !== 1) {
  console.error(`검사기가 끝나지 못했다(종료 코드 ${run.status}).\n${run.stderr}`);
  process.exit(1);
}

let results;
try {
  results = JSON.parse(run.stdout);
} catch {
  console.error(`검사기 출력을 읽지 못했다.\n${run.stdout.slice(0, 500)}\n${run.stderr}`);
  process.exit(1);
}

const all = results.flatMap((r) => r.findings.map((f) => ({ ...f, path: r.path })));
const failing = all.filter((f) => f.level === 'block' || f.layer !== 'ai');
const advisory = all.filter((f) => f.level !== 'block' && f.layer === 'ai');

const show = (f) =>
  `  ${f.path}:${f.line}:${f.col} ${f.id} ${f.name} — 「${f.match.trim()}」 → ${f.id === 'KO-T-01' ? `${f.expected}로 쓴다` : f.use}`;

if (advisory.length > 0) {
  console.log(`AI 말투 ${advisory.length}곳 — 알리기만 한다(실패가 아니다).`);
  for (const f of advisory.slice(0, 20)) console.log(show(f));
  if (advisory.length > 20) console.log(`  그 밖에 ${advisory.length - 20}곳`);
}

if (failing.length === 0) {
  console.log('한국어 문체 — 새로 쓴 줄에서 고칠 표현 없음');
  process.exit(0);
}

console.error(
  [
    `새로 쓴 한국어 문장에서 고칠 표현 ${failing.length}곳을 찾았다(용어 사전 §3.4 · 4.6 §7).`,
    '',
    ...failing.map(show),
    '',
    '고쳐 쓴다. 다른 글을 인용한 것이면 따옴표로 감싼다(따옴표 안은 검사하지 않는다).',
    '그래도 그대로 둬야 하면 그 줄 끝에 이유를 단다 — md 는 `<!-- ko-style-ignore: 이유 -->`,',
    '코드는 `// ko-style-ignore: 이유`. 이유가 없으면 빼 주지 않는다.',
  ].join('\n'),
);
process.exit(1);
