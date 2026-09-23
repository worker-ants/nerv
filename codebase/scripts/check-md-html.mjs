// md 원본과 html 파생본이 같은 말을 하는가 (관리 규약 1 · docs/README.md)
//
// **규약 1 은 2026-09-06 까지 사람 규율뿐이었다.** "md 를 먼저 고치고 대응하는 html 을
// 반드시 같이 갱신한다. 어느 한쪽만 고치면 결함이다" 라고 적어 두고, 그것을 보는 검사가
// 없었다 — 그래서 실제로 어긋났다: 2026-09-05 v2.40 이 **여덟 자리를 손으로** 고쳤고
// (버전 줄만 고치고 절·표·DDL 을 빠뜨린 커밋이 열한 개였다), v0.82 는 파생본에서 전표
// 네 행이 통째로 빠져 **같은 문서 안의 참조가 죽어 있던** 것을 고쳤다.
//
// 사람만 지키는 규율은 같은 방식으로 다시 어긋난다. 이 스크립트가 세는 것은 넷이다.
//   ① 파일 짝 — md 한 편에 html 한 편
//   ② 버전 — md 의 `> 문서 버전 vX.Y` = html 의 `<span>버전 vX.Y …</span>`
//              = `docs/README.md` 목차의 `버전` 열
//   ③ 절 번호 — `## 4.` · `### 4.1` 의 번호가 순서까지 같은가
//   ④ 고정 ID 집합 — **본문에서** 한쪽에만 있는 번호가 없는가
//   ⑤ 고정 ID 행의 **본문** — 같은 번호가 양쪽에서 같은 것을 약속하는가
//
// 본문 문장을 전부 대조하지는 않는다. 그것은 렌더러를 다시 만드는 일이고, 파생본은 산문을
// 줄여 싣는 자유를 갖는다(그림·카드·목업은 파생본에만 있다). 대조하는 것은 **수용 기준**뿐이다.
//
// **⑤ 는 2026-09-24 전수 대조가 세운 검사다.** ④ 까지는 번호가 **있는지**만 셌고 그 번호가
// **무엇을 약속하는지**는 보지 않았다 — 그래서 둘이 초록인 채로 지났다: `REQ-CB-015` 는
// 파생본에서 배포 산출물을 아직 `codebase/` 에 두라고 말하고 있었고(2026-08-22 개정 전
// 문장 · 같은 파일의 §1.1 트리는 `deploy/` 라 적어 **문서가 자기와 모순했다**),
// `REQ-CB-021` 은 머리에 "(2026-09-22 개정 — 긴 벡터는 잘라 맞출 수 있다)" 라 써 놓고
// 본문은 개정 전 규칙("1024 가 아니면 거절")을 실었다. **번호가 같으면 약속도 같아야 한다.**
//
// 사용: node scripts/check-md-html.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const DOCS = resolve(REPO, 'docs');
const HTML = resolve(DOCS, 'html');
const fail = [];

/** 문서 md 전부 — html 파생본과 자산 디렉터리는 뺀다 */
function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'html' || entry === 'assets') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const baseOf = (md) => md.split('/').at(-1).replace(/\.md$/, '');
/** README 의 짝은 index.html 이다 — 목차는 이름이 다르다 */
const htmlFor = (md) => join(HTML, `${baseOf(md) === 'README' ? 'index' : baseOf(md)}.html`);

const mdFiles = markdownFiles(DOCS).sort();

// -- (1) 파일 짝 -------------------------------------------------------------
const expected = new Set();
for (const md of mdFiles) {
  const html = htmlFor(md);
  expected.add(html.split('/').at(-1));
  try {
    statSync(html);
  } catch {
    fail.push(`${relative(REPO, md)}: 파생본 ${relative(REPO, html)} 이 없다`);
  }
}
for (const entry of readdirSync(HTML)) {
  if (!entry.endsWith('.html') || expected.has(entry)) continue;
  fail.push(`docs/html/${entry}: 원본 md 가 없다 — 지워진 문서의 파생본이 남았나`);
}

// -- 텍스트 정규화 -----------------------------------------------------------
const unescape = (s) =>
  s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');

/** 표식을 걷고 공백을 접는다 — 굵게·인라인 코드·링크는 같은 제목의 다른 표기다 */
const norm = (s) =>
  unescape(s.replace(/<[^>]+>/g, ''))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** 목차의 `버전` 열 — 관리 규약 4 의 동기화를 대조하라고 세운 열이다 */
const declaredVersion = new Map();
for (const m of readFileSync(join(DOCS, 'README.md'), 'utf8').matchAll(
  /\]\([\w./-]*?([a-z][a-z-]*\.md)\)\s*\|\s*`(v[\d.]+)`/g,
)) {
  declaredVersion.set(m[1], m[2]);
}

const ID = /\b(?:REQ|EP|SPC|TSK)-[A-Z]+-\d+\b/g;

/** 고정 ID 행이 갈렸다고 볼 경계 — 아래는 §(5) 주석의 실측이 세운 값이다 */
const ID_ROW_MIN = 0.7;
/** 행의 첫 칸이 이것이면 고정 ID 행이다(`REQ-API-105b` 같은 꼬리도 받는다) */
const ROW_ID = /^(?:REQ|EP|SPC|TSK)-[A-Z]+-\d+[a-z]?$/;

/** md 본문의 표 행 — 코드펜스와 정렬 행은 뺀다 */
function tableRowsOfMd(body) {
  const rows = [];
  for (const line of body.replace(/^```[\s\S]*?^```/gm, '').split('\n')) {
    const t = line.trimStart();
    if (!t.startsWith('|')) continue;
    const cells = t
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map(norm);
    if (cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')))) continue;
    rows.push(cells);
  }
  return rows;
}

/** html 본문의 표 행 */
function tableRowsOfHtml(body) {
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => norm(c[1])),
  );
}

/** 첫 칸이 고정 ID 인 행만 — 같은 번호가 두 번 나오면 처음 것을 쓴다 */
function idRows(rows) {
  const out = new Map();
  for (const cells of rows) {
    const id = (cells[0] ?? '').replace(/\s/g, '');
    if (!ROW_ID.test(id) || out.has(id)) continue;
    out.set(id, cells.slice(1));
  }
  return out;
}

/**
 * 대조용 — 공백·따옴표 같은 표기 자유도를 걷는다.
 *
 * **꺾쇠 자리표시자는 통째로 걷는다**(`<hostname>`·`<타입>` 따위). 위의 `norm` 이 md 에서는
 * 그것을 태그로 보고 지우는데 html 에서는 `&lt;…&gt;` 라 살아남아, 같은 문장이 양쪽에서
 * 다르게 읽힌다 — 자리표시자의 **이름**은 그래서 이 검사가 보지 못한다(그 대신 그 이름이
 * 빠졌는지는 ④ 의 고정 ID 나 사람의 눈이 본다).
 */
const compareKey = (cells) =>
  cells
    .join(' ')
    .replace(/<[^>]*>/g, '')
    .replace(/[·‧∙•]/g, '·')
    .replace(/[—–‒-]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, '')
    .toLowerCase();

/** 3-gram 자카드 — 줄여 실은 것과 다른 말을 하는 것을 가른다 */
function similarity(a, b) {
  if (a === b) return 1;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const A = grams(a),
    B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * 머리(요약 · 변경 기록)를 떼고 **본문만** 남긴다.
 *
 * 파생본은 변경 기록을 줄여 싣는다 — 그것은 표기 선택이지 사실의 차이가 아니다. 반면
 * 본문에서 번호가 빠지는 것은 사실이 갈리는 일이다: v0.82 는 파생본의 §2.1 전표에서
 * 네 행이 통째로 빠져 **같은 문서 안의 참조가 죽어 있었다.** 본문만 세면 그런 것만 남는다.
 */
const mdBody = (source) => source.slice(Math.max(0, source.search(/^## /m)));
const htmlBody = (html) => html.slice(Math.max(0, html.search(/<h2[ >]/)));

/** README 의 짝은 렌더링본이 아니라 **포털**이다 — 절도 변경 기록도 옮기지 않는다 */
const isPortal = (md) => baseOf(md) === 'README';

for (const md of mdFiles) {
  const htmlPath = htmlFor(md);
  let html;
  try {
    html = readFileSync(htmlPath, 'utf8');
  } catch {
    continue; // (1) 이 이미 보고했다
  }
  const source = readFileSync(md, 'utf8');
  const name = relative(REPO, md);

  // -- (2) 버전 --------------------------------------------------------------
  const mdVersion = /^> (?:문서 버전 )?(v[\d.]+) · /m.exec(source)?.[1];
  const htmlVersion = /<span>버전 (v[\d.]+)/.exec(html)?.[1];
  if (mdVersion !== undefined && htmlVersion !== undefined && mdVersion !== htmlVersion) {
    fail.push(`${name}: 버전이 다르다 - md ${mdVersion} · html ${htmlVersion}`);
  }
  const declared = declaredVersion.get(`${baseOf(md)}.md`);
  if (mdVersion !== undefined && declared !== undefined && declared !== mdVersion) {
    fail.push(`${name}: 목차의 버전 열이 ${declared} 인데 문서는 ${mdVersion} 이다`);
  }

  if (isPortal(md)) continue;

  // -- (3) 절 번호 (순서까지) -----------------------------------------------
  //
  // **제목 글자가 아니라 번호를 센다.** 파생본을 손으로 옮기며 `·` 를 넣거나 괄호를
  // 걷은 자리가 스무 곳 넘는데(실측 2026-09-06), 그것은 표기이지 사실이 아니다.
  // 사실이 갈리는 자리는 **번호**다 — `docs/html/pain-points.html` 의 §4 가 md 보다
  // 한 칸씩 앞서, 사전이 "§4.1" 로 인용한 절을 html 독자는 다른 절로 읽었다.
  const fenced = source.replace(/^```[\s\S]*?^```/gm, '');
  const numbers = (heads) =>
    heads.map((h) => /^(\d+(?:\.\d+)*)\.?\s/.exec(`${h} `)?.[1]).filter((n) => n !== undefined);
  const mdNums = numbers([...fenced.matchAll(/^#{2,3} (.+)$/gm)].map((m) => norm(m[1])));
  const htmlNums = numbers(
    [...html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => norm(m[2])),
  );
  if (mdNums.join(' ') !== htmlNums.join(' ')) {
    const at = mdNums.findIndex((n, i) => n !== htmlNums[i]);
    fail.push(
      `${name}: 절 번호가 어긋난다 - ${at === -1 ? '개수' : `${at + 1}번째`}에서 ` +
        `md ${mdNums[at] ?? '(없음)'} · html ${htmlNums[at] ?? '(없음)'}` +
        ` (md ${mdNums.length}개 · html ${htmlNums.length}개)`,
    );
  }

  // -- (4) 고정 ID 집합 ------------------------------------------------------
  const mdIds = new Set(mdBody(source).match(ID) ?? []);
  const htmlIds = new Set(unescape(htmlBody(html).replace(/<[^>]+>/g, ' ')).match(ID) ?? []);
  const missing = [...mdIds].filter((id) => !htmlIds.has(id));
  const extra = [...htmlIds].filter((id) => !mdIds.has(id));
  if (missing.length > 0) {
    fail.push(
      `${name}: md 에만 있는 고정 ID ${missing.length}개 - ${missing.slice(0, 6).join(' · ')}`,
    );
  }
  if (extra.length > 0) {
    fail.push(
      `${name}: html 에만 있는 고정 ID ${extra.length}개 - ${extra.slice(0, 6).join(' · ')}`,
    );
  }

  // -- (5) 고정 ID 행의 본문 -------------------------------------------------
  //
  // 표의 첫 칸이 고정 ID 인 행을 **번호로 짝지어** 나머지 칸을 견준다. 문장을 글자까지
  // 맞추라고 하지 않는다 — 파생본은 근거를 담은 괄호를 줄여 싣고, 그것은 표기 선택이다.
  // 임계 아래로 갈리는 것은 줄인 것이 아니라 **다른 말을 하는 것**이다(실측 2026-09-24:
  // 어긋난 둘이 0.52·0.58 이고, 줄여 실은 나머지는 전부 0.75 이상이었다).
  const mdRows = idRows(tableRowsOfMd(mdBody(source)));
  const htmlRows = idRows(tableRowsOfHtml(htmlBody(html)));
  for (const [id, mdCells] of mdRows) {
    const htmlCells = htmlRows.get(id);
    if (htmlCells === undefined) continue; // 존재는 ④ 가 본다
    const a = compareKey(mdCells),
      b = compareKey(htmlCells);
    if (a === b) continue;
    const score = similarity(a, b);
    if (score >= ID_ROW_MIN) continue;
    fail.push(
      `${name}: ${id} 의 수용 기준이 md 와 html 에서 다르다 (닮은 정도 ${score.toFixed(2)} < ${ID_ROW_MIN})\n` +
        `      md   ${mdCells.join(' | ').slice(0, 180)}\n` +
        `      html ${htmlCells.join(' | ').slice(0, 180)}`,
    );
  }
}

if (fail.length > 0) {
  console.error(
    [
      'md 원본과 html 파생본이 어긋났다(docs/README.md 관리 규약 1).',
      '',
      ...fail.map((f) => `  ${f}`),
      '',
      'md 를 고쳤으면 같은 커밋에서 대응하는 docs/html/*.html 도 고친다.',
      '어느 한쪽만 고친 문서는 읽는 사람마다 다른 사실을 본다.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `md ↔ html 정합 - 문서 ${mdFiles.length}편 (파일 짝 · 버전 · 절 번호 · 고정 ID · ID 행 본문)`,
);
