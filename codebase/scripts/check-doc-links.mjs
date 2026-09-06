// 문서 간 참조가 살아 있는가 — 죽은 링크 · 역참조(frontmatter `references`) · 맨 참조
// (AGENTS.md 문서 작업 규약 7 · docs/README.md 관리 규약 · REQ-CB-030)
//
// 문서가 늘수록 문서 간 정합이 깨진다. 이 저장소는 그것을 세 가지 모양으로 겪었다 — 정본이라
// 선언한 사전이 없었고(D-09·D-10 인용 24곳에 정의 0곳), 옮긴 절 번호를 다른 문서가 옛 번호로
// 인용했고, "4.4 §1.6" 처럼 **링크 없는 번호 인용**은 어느 도구도 따라갈 수 없어 깨져도 아무도
// 몰랐다. 사람이 고칠 때 "이 문서를 누가 인용하는가" 를 알 수 있어야 그 인용을 함께 고친다.
//
// 이 스크립트가 세는 것은 넷이다.
//   ① 죽은 링크 — md 의 상대 링크가 실재하는 파일을 가리키는가 · html 의 href/앵커(`#sec-N`)가 실재하는가
//   ② 역참조 — 각 md 의 frontmatter `references` 가 **그 문서를 링크하는 문서의 목록**과 같은가
//              (링크에서 계산한다 — 사람이 적는 목록은 첫날부터 낡는다)
//   ③ 파생본 — html 머리(`.meta-line`)의 `참조하는 문서` 가 md 의 `references` 와 같은 집합인가
//   ④ 맨 참조 — 링크 없는 문서 인용(`4.4 §1.6` · `4.4 v0.87` · `api.md`)이 본문에 남아 있지 않은가
//   ⑤ 절 실재 — 링크 뒤의 `§N.N` 이 대상 문서의 절 번호로 실재하는가
//
// 사용: node scripts/check-doc-links.mjs                 — 검사
//       node scripts/check-doc-links.mjs --fix           — 맨 참조를 링크로 바꾸고 ②·③ 을 다시 쓴다(①·⑤는 사람이 고친다)
//       node scripts/check-doc-links.mjs --where 04-mvp/api.md  — 그 문서를 인용하는 자리(파일:줄 · 절)를 나열한다

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const DOCS = resolve(REPO, 'docs');
const HTML = resolve(DOCS, 'html');
/** docs/ 밖에서 문서를 인용하는 둘 — 규약 정본과 저장소 첫 화면. 역참조에 `../` 로 들어간다 */
const ROOT_SOURCES = ['AGENTS.md', 'README.md'].map((f) => resolve(REPO, f));
const fix = process.argv.includes('--fix');
/** `--where <docs 기준 경로>` — 그 문서를 인용하는 자리(파일:줄 · 절)를 읽기 전용으로 출력한다 */
const whereAt = process.argv.indexOf('--where');
const where = whereAt === -1 ? null : process.argv[whereAt + 1];
const fail = [];
const fixed = [];

// -- 파일 -----------------------------------------------------------------------
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
const mdFiles = markdownFiles(DOCS).sort();
const baseOf = (p) => p.split('/').at(-1).replace(/\.md$/, '');
const htmlNameFor = (md) => `${baseOf(md) === 'README' ? 'index' : baseOf(md)}.html`;
const docRel = (abs) => relative(DOCS, abs); // `04-mvp/api.md` · `../AGENTS.md`
const exists = (p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** 문서 번호 → md — 목차(docs/README.md)가 정본이다. 번호 없는 둘은 이름으로 부른다 */
const numberToMd = new Map();
const labelOf = new Map([
  ['README.md', '개요'],
  ['glossary.md', '용어 사전'],
  ['../AGENTS.md', 'AGENTS.md'],
  ['../README.md', 'README'],
]);
for (const m of readFileSync(join(DOCS, 'README.md'), 'utf8').matchAll(
  /\[(\d\.\d) [^\]]*\]\(([\w./-]+\.md)\)/g,
)) {
  if (!numberToMd.has(m[1])) {
    numberToMd.set(m[1], m[2]);
    labelOf.set(m[2], m[1]);
  }
}
const basenameToMd = new Map(mdFiles.map((f) => [`${baseOf(f)}.md`, docRel(f)]));
/** 목록의 순서 — 문서 번호 순, 그다음 용어 사전 · 개요 · 루트 둘. 경로 순은 3.4 를 3.2 앞에 세운다 */
const TAIL = ['glossary.md', 'README.md', '../README.md', '../AGENTS.md'];
const orderKey = (rel) => {
  const label = labelOf.get(rel) ?? '';
  return /^\d\.\d$/.test(label) ? Number(label) : 10 + TAIL.indexOf(rel);
};
const byDocOrder = (a, b) => orderKey(a) - orderKey(b) || a.localeCompare(b);

// -- 본문 분절 ----------------------------------------------------------------------
//
// 맨 참조를 찾고 바꾸는 자리는 **산문뿐**이다. 코드 블록·인라인 코드·이미 링크인 곳은 건드리지
// 않는다 — 트리 그림의 주석("4.8 §1.4 현황 표")은 코드고, 링크 글자 안의 번호는 이미 링크다.
const FENCE = /^(```|~~~)/;
const INLINE = /(`+)[^`]*?\1|!?\[[^\]]*\]\([^)]*\)|<https?:[^>]*>/g;

/** md 본문을 {text, prose} 조각으로 — prose=false 인 조각은 그대로 둔다 */
function segmentMarkdown(body) {
  const out = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push({ text: `${line}\n`, prose: false });
      continue;
    }
    if (inFence) {
      out.push({ text: `${line}\n`, prose: false });
      continue;
    }
    let last = 0;
    for (const m of line.matchAll(INLINE)) {
      if (m.index > last) out.push({ text: line.slice(last, m.index), prose: true });
      out.push({ text: m[0], prose: false });
      last = m.index + m[0].length;
    }
    out.push({ text: `${line.slice(last)}\n`, prose: true });
  }
  return out;
}

/** html 을 {text, prose} 조각으로 — 태그는 그대로, a·code·pre·script·style·title·nav 안은 산문이 아니다 */
function segmentHtml(html) {
  const out = [];
  const depth = { a: 0, code: 0, pre: 0, script: 0, style: 0, title: 0, nav: 0 };
  let last = 0;
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const inside = Object.values(depth).every((d) => d === 0);
    if (m.index > last) out.push({ text: html.slice(last, m.index), prose: inside });
    out.push({ text: m[0], prose: false });
    const tag = m[1].toLowerCase();
    if (tag in depth && !m[0].endsWith('/>'))
      depth[tag] = Math.max(0, depth[tag] + (m[0][1] === '/' ? -1 : 1));
    last = m.index + m[0].length;
  }
  out.push({ text: html.slice(last), prose: Object.values(depth).every((d) => d === 0) });
  return out;
}

// -- 맨 참조 --------------------------------------------------------------------------
//
// `4.4 §1.6` · `4.4 v0.87` · `4.7 스펙 임포터 §5` · `api.md §3.2` — 번호·이름은 사람에게는 인용이지만 도구에게는
// 그냥 글자다. 링크로 바꾸면 ① 이 죽음을 잡고 ② 가 역참조를 센다.
const BARE_NUMBER =
  /(?<![\d.\w§#/\-~])([1-4]\.[1-8])((?: (?:[가-힣]{2,}|[A-Z][A-Za-z]*)){0,3}) (?=§|v\d)/g;
const BARE_FILE = /(?<![\w/.-])([a-z][a-z-]*\.md)(?![\w/-])/g;

/**
 * 산문 조각의 맨 참조를 링크로. `self` 는 자기 문서(자기 번호는 자기 절 인용이라 링크하지 않는다),
 * `link(mdRel, label)` 가 표기를 만든다(md 와 html 이 다르다).
 */
function convertProse(text, self, link, report) {
  // 파일 이름을 먼저 바꾼다 — 번호를 먼저 바꾸면 그 링크의 경로(`api.md`)를 파일 이름으로 다시 잡는다
  let s = text.replace(BARE_FILE, (whole, name) => {
    const target = basenameToMd.get(name);
    if (target === undefined || target === self) return whole;
    report(`${name} → ${target}`);
    return link(target, name);
  });
  s = s.replace(BARE_NUMBER, (whole, num, title) => {
    const target = numberToMd.get(num);
    if (target === undefined || target === self) return whole;
    report(`${num}${title} § → ${target}`);
    return `${link(target, `${num}${title}`)} `;
  });
  return s;
}

/** 산문에 남은 맨 참조 — 고치지 않고 센다 */
function bareIn(segments, self) {
  const found = [];
  let line = 1;
  for (const seg of segments) {
    if (seg.prose)
      convertProse(
        seg.text,
        self,
        () => '',
        (what) => found.push(`${line}: ${what}`),
      );
    line += (seg.text.match(/\n/g) ?? []).length;
  }
  return found;
}

// -- frontmatter ----------------------------------------------------------------------
function splitFrontmatter(source) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  return m ? { head: m[1], body: source.slice(m[0].length) } : { head: null, body: source };
}
function readReferences(head) {
  if (head === null) return null;
  const lines = head.split('\n');
  const at = lines.findIndex((l) => /^references:/.test(l));
  if (at === -1) return null;
  const items = [];
  for (let i = at + 1; i < lines.length && /^\s+-\s/.test(lines[i]); i += 1) {
    items.push(lines[i].replace(/^\s+-\s+/, '').trim());
  }
  return /^references:\s*\[\s*\]/.test(lines[at]) ? [] : items;
}
function writeReferences(head, refs) {
  const kept = [];
  const lines = (head ?? '').split('\n').filter((l) => l !== '');
  for (let i = 0; i < lines.length; i += 1) {
    if (/^references:/.test(lines[i])) {
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) i += 1;
      continue;
    }
    kept.push(lines[i]);
  }
  kept.push(refs.length === 0 ? 'references: []' : 'references:');
  for (const r of refs) kept.push(`  - ${r}`);
  return kept.join('\n');
}

// -- html 머리의 참조 줄 ------------------------------------------------------------------
const REFS_SPAN = /\n?[ \t]*<span class="refs">[\s\S]*?<\/span>/;
const hrefFor = (mdRel) =>
  mdRel.startsWith('../') ? `../../${mdRel.slice(3)}` : htmlNameFor(mdRel);
function refsSpan(refs) {
  const body =
    refs.length === 0
      ? '없음'
      : refs.map((r) => `<a href="${hrefFor(r)}">${labelOf.get(r) ?? r}</a>`).join(' · ');
  return `<span class="refs">참조하는 문서: ${body}</span>`;
}
function readHtmlRefs(html) {
  const span = REFS_SPAN.exec(html)?.[0];
  if (span === undefined) return null;
  const hrefs = [...span.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  return hrefs.map((h) => {
    if (h.startsWith('../../')) return `../${h.slice(6)}`;
    const base = h.replace(/\.html$/, '');
    const md = [...basenameToMd.values()].find(
      (v) => baseOf(v) === (base === 'index' ? 'README' : base),
    );
    return md ?? h;
  }); // 순서도 대조한다 — 목록은 문서 번호 순이어야 읽힌다
}

// -- ① 죽은 링크 ----------------------------------------------------------------------------
for (const md of [...mdFiles, ...ROOT_SOURCES]) {
  const { body } = splitFrontmatter(readFileSync(md, 'utf8'));
  for (const seg of segmentMarkdown(body)) {
    if (seg.prose || (!seg.text.startsWith('[') && !seg.text.startsWith('!['))) continue;
    const target = /\]\(([^)\s]+)/.exec(seg.text)?.[1];
    if (target === undefined || /^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#')[0];
    // 파일 경로 모양일 때만 본다 — 앱 경로 예시(`/p/...`)·표기용 괄호(`[EP-SPEC-17](이동)`)는 링크가 아니다
    if (
      path === '' ||
      path.startsWith('/') ||
      !/\.(md|html|png|svg|json|yml|yaml|txt)$|\//.test(path)
    )
      continue;
    if (!exists(resolve(dirname(md), path)))
      fail.push(`${relative(REPO, md)}: 죽은 링크 ${target}`);
  }
}
const htmlFiles = readdirSync(HTML)
  .filter((f) => f.endsWith('.html'))
  .map((f) => join(HTML, f));
const idsOf = new Map(
  htmlFiles.map((f) => [
    f,
    new Set([...readFileSync(f, 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])),
  ]),
);
for (const html of htmlFiles) {
  for (const m of readFileSync(html, 'utf8').matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [path, anchor] = href.split('#');
    const target = path === '' ? html : resolve(dirname(html), path);
    if (!exists(target)) {
      fail.push(`docs/html/${html.split('/').at(-1)}: 죽은 href ${href}`);
      continue;
    }
    if (anchor !== undefined && idsOf.has(target) && !idsOf.get(target).has(anchor)) {
      fail.push(`docs/html/${html.split('/').at(-1)}: 없는 앵커 ${href}`);
    }
  }
}

// -- ④ 맨 참조 → 링크 (--fix) --------------------------------------------------------------
const mdLink = (from) => (target, label) =>
  `[${label}](${relative(dirname(from), join(DOCS, target))})`;
const htmlLink = (target, label) => `<a href="${hrefFor(target)}">${label}</a>`;
if (fix) {
  for (const md of mdFiles) {
    const source = readFileSync(md, 'utf8');
    const { head, body } = splitFrontmatter(source);
    const self = docRel(md);
    const changes = [];
    const next = segmentMarkdown(body)
      .map((seg) =>
        seg.prose ? convertProse(seg.text, self, mdLink(md), (w) => changes.push(w)) : seg.text,
      )
      .join('')
      .replace(/\n$/, '');
    if (changes.length > 0) {
      writeFileSync(
        md,
        `${head === null ? '' : `---\n${head}\n---\n`}${next}${body.endsWith('\n') ? '\n' : ''}`,
      );
      fixed.push(`${relative(REPO, md)}: 맨 참조 ${changes.length}곳을 링크로`);
    }
  }
  for (const html of htmlFiles) {
    const self = [...basenameToMd.values()].find((v) => htmlNameFor(v) === html.split('/').at(-1));
    const source = readFileSync(html, 'utf8');
    const changes = [];
    const next = segmentHtml(source)
      .map((seg) =>
        seg.prose ? convertProse(seg.text, self, htmlLink, (w) => changes.push(w)) : seg.text,
      )
      .join('');
    if (changes.length > 0) {
      writeFileSync(html, next);
      fixed.push(`docs/html/${html.split('/').at(-1)}: 맨 참조 ${changes.length}곳을 링크로`);
    }
  }
}

/** 문서의 절 번호 집합(`## 2.` · `### 2.4` · 코드 블록 밖) — 없는 문서는 null */
const headingCache = new Map();
function headingsOf(abs) {
  if (!headingCache.has(abs)) {
    let set = null;
    if (exists(abs)) {
      const { body } = splitFrontmatter(readFileSync(abs, 'utf8'));
      set = new Set();
      for (const seg of segmentMarkdown(body)) {
        if (!seg.prose) continue;
        for (const m of seg.text.matchAll(/^#{2,4} (\d+(?:\.\d+)*)\.?(?=\s)/gm)) set.add(m[1]);
      }
    }
    headingCache.set(abs, set);
  }
  return headingCache.get(abs);
}

// -- ② 역참조 ------------------------------------------------------------------------------
const backlinks = new Map(mdFiles.map((f) => [docRel(f), new Set()]));
for (const src of [...mdFiles, ...ROOT_SOURCES]) {
  const { body } = splitFrontmatter(readFileSync(src, 'utf8'));
  const from = src.startsWith(DOCS) ? docRel(src) : `../${relative(REPO, src)}`;
  const segs = segmentMarkdown(body);
  let line = 1;
  for (const [i, seg] of segs.entries()) {
    const at = line;
    line += (seg.text.match(/\n/g) ?? []).length;
    if (seg.prose || !seg.text.startsWith('[')) continue;
    const target = /\]\(([^)\s#]+)/.exec(seg.text)?.[1];
    if (target === undefined || !target.endsWith('.md') || /^https?:/.test(target)) continue;
    const abs = resolve(dirname(src), target);
    if (!abs.startsWith(DOCS)) continue;
    const to = docRel(abs);
    if (backlinks.has(to) && to !== from) backlinks.get(to).add(from);
    // 링크 바로 뒤의 `§N.N` — 그 절이 대상 문서에 실재하는가. 링크는 살아 있는데 절만 옮겨진
    // 자리가 실제로 있었다(§2.3→§2.4 · §2.11→§2.8). 절 번호는 이 저장소의 정체성이라 싸게 잡힌다.
    const section = /^ ?§(\d+(?:\.\d+)*)/.exec(segs[i + 1]?.text ?? '')?.[1];
    const headings = section === undefined ? null : headingsOf(abs);
    if (section !== undefined && headings !== null && !headings.has(section)) {
      fail.push(`${relative(REPO, src)}:${at}: ${to} 에 §${section} 이 없다`);
    }
    if (where !== null && to === where) {
      console.log(
        `${relative(REPO, src)}:${at}  ${seg.text.slice(0, 60)}${section ? ` §${section}` : ''}`,
      );
    }
  }
}
if (where !== null) process.exit(0);
for (const md of mdFiles) {
  const rel = docRel(md);
  const expected = [...backlinks.get(rel)].sort(byDocOrder);
  const source = readFileSync(md, 'utf8');
  const { head, body } = splitFrontmatter(source);
  const actual = readReferences(head);
  const same = actual !== null && actual.join('\n') === expected.join('\n');
  if (!same) {
    if (fix) {
      writeFileSync(md, `---\n${writeReferences(head, expected)}\n---\n${body}`);
      fixed.push(`${relative(REPO, md)}: references ${expected.length}편으로`);
    } else {
      fail.push(
        actual === null
          ? `${relative(REPO, md)}: frontmatter 에 references 가 없다 (인용 ${expected.length}편)`
          : `${relative(REPO, md)}: references 가 낡았다 - 있어야 할 것 ${expected.length}편, 적힌 것 ${actual.length}편` +
              ` (빠짐: ${expected.filter((e) => !actual.includes(e)).join(' · ') || '-'} / 남음: ${actual.filter((a) => !expected.includes(a)).join(' · ') || '-'})`,
      );
    }
  }
  // -- ③ 파생본 머리 -----------------------------------------------------------------------
  const htmlPath = join(HTML, htmlNameFor(md));
  if (!exists(htmlPath)) continue; // check-md-html 이 보고한다
  const html = readFileSync(htmlPath, 'utf8');
  const inHtml = readHtmlRefs(html);
  if (inHtml === null || inHtml.join('\n') !== expected.join('\n')) {
    if (fix) {
      const span = refsSpan(expected);
      const next = REFS_SPAN.test(html)
        ? html.replace(REFS_SPAN, `\n      ${span}`)
        : html.replace(/(<div class="meta-line">[\s\S]*?)(\n\s*<\/div>)/, `$1\n      ${span}$2`);
      if (next === html)
        fail.push(`docs/html/${htmlNameFor(md)}: .meta-line 이 없어 참조 줄을 넣지 못했다`);
      else {
        writeFileSync(htmlPath, next);
        fixed.push(`docs/html/${htmlNameFor(md)}: 참조하는 문서 줄 갱신`);
      }
    } else {
      fail.push(
        inHtml === null
          ? `docs/html/${htmlNameFor(md)}: 머리에 '참조하는 문서' 줄이 없다`
          : `docs/html/${htmlNameFor(md)}: '참조하는 문서' 가 md 의 references 와 다르다`,
      );
    }
  }
}

// -- ④ 맨 참조 (남은 것) ----------------------------------------------------------------------
for (const md of mdFiles) {
  const { body } = splitFrontmatter(readFileSync(md, 'utf8'));
  const bare = bareIn(segmentMarkdown(body), docRel(md));
  if (bare.length > 0) {
    fail.push(
      `${relative(REPO, md)}: 링크 없는 문서 인용 ${bare.length}곳 - ${bare.slice(0, 4).join(' · ')}`,
    );
  }
}
for (const html of htmlFiles) {
  const self = [...basenameToMd.values()].find((v) => htmlNameFor(v) === html.split('/').at(-1));
  const bare = bareIn(segmentHtml(readFileSync(html, 'utf8')), self);
  if (bare.length > 0) {
    fail.push(
      `docs/html/${html.split('/').at(-1)}: 링크 없는 문서 인용 ${bare.length}곳 - ${bare.slice(0, 4).join(' · ')}`,
    );
  }
}

// -- 보고 --------------------------------------------------------------------------------------
if (fixed.length > 0)
  console.log(['--fix 가 고친 것:', ...fixed.map((f) => `  ${f}`), ''].join('\n'));
if (fail.length > 0) {
  console.error(
    [
      '문서 간 참조가 어긋났다(AGENTS.md 문서 작업 규약 7).',
      '',
      ...fail.map((f) => `  ${f}`),
      '',
      '다른 문서를 인용하면 인라인 링크로 잇고, `node scripts/check-doc-links.mjs --fix` 로 역참조와 파생본 머리를 다시 쓴다.',
      '죽은 링크는 손으로 고친다 — 절이 옮겨졌거나 문서가 개명된 것이다.',
    ].join('\n'),
  );
  process.exit(1);
}
console.log(
  `문서 간 참조 - md ${mdFiles.length}편 · html ${htmlFiles.length}편 (죽은 링크 · 역참조 · 파생본 머리 · 맨 참조 · 절 실재)`,
);
