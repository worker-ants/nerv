// 백로그의 구현 현황이 스토리와 맞는가 (AGENTS.md 문서 작업 규약 6 · 4.8 §1.4)
//
// **백로그는 첫 임포트 대상이다.** 여기 적힌 상태가 그대로 Task 74건의 초기 상태가 되므로,
// 표가 실제 스토리와 어긋나면 이미 끝난 일을 에이전트가 다시 클레임한다 — 이 제품이
// 없애려는 P2(중복 작업) 그 자체다.
//
// 실제로 그렇게 됐다: §1.1 이 "이 문서의 모든 스토리는 현재 `backlog`다" 라고 적은 채
// **74개 중 73개에 대해 거짓**인 상태로 2주를 보냈다(2026-08-22 → 09-06). 아무도 몰라서가
// 아니라 **세는 것이 사람 손에만 있어서**다.
//
// 이 스크립트가 세는 것은 셋이다.
//   ① 에픽별 `done + 부분` 이 그 에픽의 실제 스토리 수와 같은가
//   ② 합계 행이 에픽별 합과 같은가
//   ③ 부분으로 센 수만큼 "남은 것" 이 적혀 있는가 — 남은 것 없는 부분 표기는 완료와 같다
// 그리고 html 파생본이 같은 수를 말하는지도 본다(관리 규약 1).
//
// 사용: node scripts/check-backlog-status.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const MD = resolve(REPO, 'docs/04-mvp/backlog.md');
const HTML = resolve(REPO, 'docs/html/backlog.html');

const md = readFileSync(MD, 'utf8');
const html = readFileSync(HTML, 'utf8');
const fail = [];

/** §2·§3 의 스토리 표에서 실제 스토리 수를 센다 — `| E01-S01 | …` 꼴의 행이다 */
const storyIds = new Set();
for (const m of md.matchAll(/^\|\s*`?(E\d{2}-S\d{2})`?\s*\|/gm)) storyIds.add(m[1]);

const storiesPerEpic = new Map();
for (const id of storyIds) {
  const epic = id.slice(0, 3);
  storiesPerEpic.set(epic, (storiesPerEpic.get(epic) ?? 0) + 1);
}

/** §1.4 에픽별 표 — `| E01 저장소 부트스트랩 | 5 | — | 근거 |` */
const declared = new Map();
for (const m of md.matchAll(/^\|\s*(E\d{2})\s[^|]*\|\s*(\d+|—)\s*\|\s*(\d+|—)\s*\|/gm)) {
  const num = (v) => (v === '—' ? 0 : Number(v));
  declared.set(m[1], { done: num(m[2]), partial: num(m[3]) });
}

if (declared.size === 0) {
  fail.push('§1.4 의 에픽별 현황 표를 찾지 못했다 — 표가 사라졌거나 모양이 바뀌었다');
}

for (const [epic, actual] of [...storiesPerEpic].sort()) {
  const row = declared.get(epic);
  if (row === undefined) {
    fail.push(`${epic}: 스토리 ${actual}개가 있는데 §1.4 표에 행이 없다`);
    continue;
  }
  const counted = row.done + row.partial;
  if (counted !== actual) {
    fail.push(
      `${epic}: §1.4 는 ${counted}개(done ${row.done} · 부분 ${row.partial})를 세는데 ` +
        `스토리 표에는 ${actual}개가 있다`,
    );
  }
}
for (const epic of declared.keys()) {
  if (!storiesPerEpic.has(epic)) fail.push(`${epic}: §1.4 에만 있고 스토리 표에 없다`);
}

/** 합계 행 — `| **합계** | **64** | **10** | …` */
const totalRow = /\|\s*\*\*합계\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/.exec(md);
if (totalRow === null) {
  fail.push('§1.4 표에 합계 행이 없다');
} else {
  const [doneSum, partialSum] = [...declared.values()].reduce(
    ([d, p], r) => [d + r.done, p + r.partial],
    [0, 0],
  );
  if (Number(totalRow[1]) !== doneSum) {
    fail.push(`합계 done ${totalRow[1]} ≠ 에픽별 합 ${doneSum}`);
  }
  if (Number(totalRow[2]) !== partialSum) {
    fail.push(`합계 부분 ${totalRow[2]} ≠ 에픽별 합 ${partialSum}`);
  }
  if (doneSum + partialSum !== storyIds.size) {
    fail.push(`합계 ${doneSum + partialSum} ≠ 스토리 총수 ${storyIds.size}`);
  }

  // **부분에는 남은 것이 따라온다.** 남은 것을 적지 않은 부분 표기는 "완료" 와 구별되지 않는다.
  const partialSection = md.slice(
    md.indexOf('#### 부분 구현 열'),
    md.indexOf('#### 스토리가 없는 구현'),
  );
  const partialRows = [...partialSection.matchAll(/^\|\s*(E\d{2}-S\d{2})\s*\|/gm)].length;
  if (partialRows !== partialSum) {
    fail.push(`부분 구현 표의 행 ${partialRows}개 ≠ 에픽별 부분 합 ${partialSum}개`);
  }

  // 파생본이 같은 수를 말하는가 (관리 규약 1)
  if (!html.includes(`<b>${totalRow[1]}</b>`) || !html.includes(`<b>${totalRow[2]}</b>`)) {
    fail.push(`html 파생본의 합계가 md(done ${totalRow[1]} · 부분 ${totalRow[2]})와 다르다`);
  }
}

if (fail.length > 0) {
  console.error(
    [
      '백로그 현황(4.8 §1.4)이 스토리와 맞지 않는다.',
      '',
      ...fail.map((f) => `  ${f}`),
      '',
      '스토리를 끝냈으면 같은 커밋에서 §1.4 의 표를 고친다(AGENTS.md 문서 작업 규약 6).',
      '이 문서는 첫 임포트 대상이라, 틀린 상태가 그대로 Task 의 초기 상태가 된다.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `백로그 현황 정합 — 에픽 ${declared.size} · 스토리 ${storyIds.size} ` +
    `(done ${totalRow[1]} · 부분 ${totalRow[2]})`,
);
