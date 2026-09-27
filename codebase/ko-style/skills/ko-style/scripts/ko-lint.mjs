#!/usr/bin/env node
// ko-style 검사기 — 규칙 표 한 벌로 훅·CI·사람이 같은 판정을 쓴다 (정본: docs/04-mvp/plugin.md §7)
//
// 사용:
//   node ko-lint.mjs check [파일 …] [--staged] [--base <ref>] [--text <글>] [--tone <말투>] [--dash check|off]
//                          [--levels block,warn,hint] [--strict] [--json]
//   node ko-lint.mjs rules [--json]      켜진 규칙 목록 (저장소 설정 포함)
//   node ko-lint.mjs digest [--static]   세션 요약 (SessionStart 훅이 넣는 글)
//   node ko-lint.mjs sync                규칙 표에서 SKILL.md 규칙 표와 hooks/digest.json 을 다시 만든다
//   node ko-lint.mjs hook <이벤트> [--data <폴더>]   훅 진입점 — stdin 으로 훅 입력 JSON 을 받는다
//
// **의존성이 없다.** 훅은 사용자 기계에서 돌고, 설치 단계가 없는 플러그인이 기댈 수 있는 것은
// node 하나뿐이다. 형태소 분석기를 넣으면 모델 파일만 수십 MB 라 훅이 제한 시간 안에 끝나지 않는다.
//
// **훅은 세션을 멈추지 않는다.** 어떤 이유로든 실패하면 조용히 끝난다 — 문체 검사가 작업을 막는
// 경로가 되면 안 된다. 막는 것은 규칙에 걸린 문장뿐이고, 그것도 같은 문장을 두 번 내면 통과한다.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = join(HERE, '..', 'rules', 'core.json');
const MANIFEST_PATH = join(HERE, '..', '..', '..', '.claude-plugin', 'plugin.json');
const CONFIG_NAME = '.ko-style.json';

export const LEVEL_NAME = { block: '차단', warn: '경고', hint: '참고' };
const RANK = { block: 3, warn: 2, hint: 1 };
const TONE_NAME = { hapsyo: '합쇼체', haera: '해라체', haeyo: '해요체', request: '"-세요" 요청' };
const PARTICLES = '이|가|을|를|은|는|의|에|에서|도';

// ── 설정 ────────────────────────────────────────────────────────────────────

/** 저장소 설정이 없을 때의 값 — md 문서만 보고, 말투는 강제하지 않는다 */
const DEFAULTS = {
  enabled: true,
  surfaces: [{ name: '문서', files: ['**/*.md', '**/*.mdx'], tone: 'off', dash: 'check' }],
  commit: { tone: 'off', dash: 'check' },
  reply: { mode: 'notify', tone: 'off', dash: 'check' },
  ignore: [],
  disable: [],
  team: [],
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 저장소 설정을 찾는다 — 시작 폴더에서 위로 올라가며 `.ko-style.json` 을 찾고, git 저장소의
 * 루트(`.git` 이 있는 폴더)에서 멈춘다. 저장소 밖의 설정을 주워 오지 않기 위해서다.
 */
export function findRepoConfig(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    const path = join(dir, CONFIG_NAME);
    if (existsSync(path)) {
      try {
        return { path, root: dir, config: readJson(path), error: null };
      } catch (e) {
        return { path, root: dir, config: {}, error: String(e.message ?? e) };
      }
    }
    if (existsSync(join(dir, '.git'))) return { path: null, root: dir, config: {}, error: null };
    const up = dirname(dir);
    if (up === dir) return { path: null, root: resolve(startDir), config: {}, error: null };
    dir = up;
  }
}

export function settingsOf(config = {}) {
  return {
    ...DEFAULTS,
    ...config,
    commit: { ...DEFAULTS.commit, ...config.commit },
    reply: { ...DEFAULTS.reply, ...config.reply },
    surfaces: config.surfaces ?? DEFAULTS.surfaces,
    ignore: config.ignore ?? [],
    disable: config.disable ?? [],
    team: config.team ?? [],
  };
}

/** `**` · `*` · `?` 만 아는 작은 glob — 경로 구분자는 `/` 로 맞춘 뒤에 쓴다 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

const toPosix = (p) => p.split(sep).join('/');
const matchesAny = (rel, globs) => globs.some((g) => globToRegExp(g).test(rel));

/** 파일이 어느 글 종류인가 — 제외 목록에 있거나 어느 종류에도 들지 않으면 검사하지 않는다 */
export function surfaceFor(rel, st) {
  if (matchesAny(rel, st.ignore)) return null;
  return st.surfaces.find((s) => matchesAny(rel, s.files ?? [])) ?? null;
}

// ── 규칙 ────────────────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function loadCoreRules() {
  return readJson(CORE_PATH).rules;
}

/**
 * 규칙을 정규식으로 만든다. 팀 규칙은 `avoid`(쓰지 않는 활용형 목록)와 `when`(앞에 와야 하는
 * 말)으로 쓸 수 있다 — 한국어는 조사와 어미가 붙어 쓰이므로 영어식 단어 경계가 통하지 않는다.
 * 그래서 막을 활용형을 모두 적고, 앞뒤가 한글이 아닌 자리에서만 잡는다("머리말"·"닿소리" 오탐).
 */
export function compileRules(core, st) {
  const disabled = new Set(st.disable);
  const teamSrc = st.teamSrc ?? `저장소 설정 (${CONFIG_NAME})`;
  return [...core, ...st.team.map((r) => ({ layer: 'team', src: teamSrc, ...r }))]
    .filter((r) => !disabled.has(r.id))
    .map((r) => {
      const rule = { level: 'warn', ...r };
      if (rule.custom) return rule;
      let src = rule.pattern;
      if (!src && Array.isArray(rule.avoid) && rule.avoid.length > 0) {
        const forms = [...rule.avoid]
          .sort((a, b) => b.length - a.length)
          .map((f) => escapeRe(f).replace(/ /g, '\\s?'))
          .join('|');
        src = rule.when
          ? `(?:${rule.when})(?:${PARTICLES})?(?:\\s(?:(?!(?:면|고|서|니|며|때|데)\\s)[^.!?\\n—,]){0,20}?)?\\s?(?<![가-힣])(?:${forms})(?![가-힣])`
          : `(?<![가-힣])(?:${forms})(?![가-힣])`;
      }
      if (!src) throw new Error(`${rule.id}: pattern 이나 avoid 가 없다`);
      return { ...rule, re: new RegExp(src, 'g') };
    });
}

// ── 검사 ────────────────────────────────────────────────────────────────────

const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * 검사하지 않을 자리를 공백으로 바꾼다 — 위치는 그대로 두어야 줄 번호가 맞는다.
 * 코드·링크 주소·URL 은 글이 아니고, 따옴표 안은 대개 **다른 글을 인용한 것**이라 뺀다
 * (쓰지 않는 표현을 설명하는 문서가 그 표현을 인용하면서 걸리지 않게).
 */
export function maskText(text, { markdown = true, quotes = true } = {}) {
  let t = text;
  if (markdown) {
    t = t
      .replace(/^---\n[\s\S]*?\n---(?=\n|$)/, blank)
      .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/`[^`\n]+`/g, blank)
      .replace(/\]\([^)\n]*\)/g, (m) => `]${blank(m.slice(1))}`)
      .replace(/<\/?[a-zA-Z][^>\n]*>/g, blank);
  }
  t = t.replace(/https?:\/\/[^\s)>\]]+/g, blank);
  if (quotes) {
    t = t
      .replace(/"[^"\n]{1,200}"/g, blank)
      .replace(/“[^”\n]{1,200}”/g, blank)
      .replace(/「[^」\n]{1,200}」/g, blank)
      .replace(/『[^』\n]{1,200}』/g, blank)
      .replace(/~~[^~\n]+~~/g, blank);
  }
  return t;
}

/**
 * 줄 끝에 `ko-style-ignore: <이유>` 가 있으면 그 줄은 검사하지 않는다(md 는
 * `<!-- ko-style-ignore: 이유 -->`, 코드는 `// ko-style-ignore: 이유`). **이유가 없으면 듣지 않는다** —
 * eslint-disable 에 이유를 같은 줄에 적게 하는 것과 같은 규칙이다. 이유 없는 예외는 나중에 아무도
 * 판단할 수 없다.
 */
// 주석을 닫는 기호(`-->` · `*/`)는 이유가 아니다
export const IGNORE_MARK = /ko-style-ignore:\s*(?!-->|\*\/)\S/;

function skipIgnored(text, masked) {
  if (!text.includes('ko-style-ignore')) return masked;
  let out = '';
  let at = 0;
  for (const line of text.split('\n')) {
    const part = masked.slice(at, at + line.length);
    out += (IGNORE_MARK.test(line) ? blank(part) : part) + '\n';
    at += line.length + 1;
  }
  return out.slice(0, masked.length);
}

/**
 * 문장으로 나눈다 — 마침표·물음표·느낌표와 줄바꿈에서 끊는다.
 *
 * **문장 부호 뒤가 공백 · 닫는 괄호 · 따옴표 · 글 끝일 때만 끊는다.** "0.3.4" 나 `plugin.json` 의 점을
 * 문장 끝으로 읽으면 "플러그인 0.3.4" 앞의 줄표가 "문장 끝의 짝 없는 줄표" 로 잡힌다(2026-09-27 실측 —
 * 커밋 제목 "…고친다 — 플러그인 0.3.4").
 */
export function sentencesOf(text) {
  const out = [];
  const re = /(?:[^\n.?!]|[.?!](?=[^\s"'」』)\]]))*(?:[.?!]+|(?=\n)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      if (re.lastIndex >= text.length) break;
      re.lastIndex += 1;
      continue;
    }
    const lead = m[0].length - m[0].trimStart().length;
    const body = m[0].trim();
    if (body) out.push({ start: m.index + lead, end: m.index + lead + body.length, text: body });
  }
  return out;
}

/** 문장 끝으로 말투를 판정한다 — 끝이 분명하지 않은 문장(명사형·개조식)은 판정하지 않는다 */
export function toneOf(sentence) {
  const x = sentence.replace(/[)"'」』\]*_]+$/, '').replace(/:$/, '');
  if (/세요[.?!]?$/.test(x)) return 'request';
  // 합쇼체는 ㅂ 받침 음절 + "니다"(합니다 · 입니다 · 됩니다)다. "아니다" 는 해라체다.
  const hs = /([가-힣])(?:니다|니까)[.?!]?$/.exec(x);
  if (hs && (hs[1].charCodeAt(0) - 0xac00) % 28 === 17) return 'hapsyo';
  if (/(?:어요|아요|해요|예요|에요|네요|나요|까요|죠|래요|게요)[.?!]$/.test(x)) return 'haeyo';
  if (/다[.!?]$/.test(x)) return 'haera'; // 합쇼체는 위에서 걸렀다 — 남은 "-니다" 는 "아니다" 부류다
  return null;
}

const TONE_OK = {
  hapsyo: ['hapsyo', 'request'],
  haera: ['haera'],
  haeyo: ['haeyo', 'request'],
};

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function locate(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}

/**
 * 글 하나를 검사한다.
 * @param {string} input 검사할 글
 * @param {{rules: object[], tone?: string, dash?: string, markdown?: boolean, quotes?: boolean}} opts
 */
export function lint(input, { rules, tone = 'off', dash = 'check', markdown = true, quotes = true }) {
  const text = input.normalize('NFC');
  const masked = skipIgnored(text, maskText(text, { markdown, quotes }));
  const starts = lineStartsOf(text);
  const found = [];
  const push = (rule, start, end, extra) => {
    const { line, col } = locate(starts, start);
    const lineText = text.slice(starts[line - 1], text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start));
    found.push({
      id: rule.id,
      name: rule.name,
      level: rule.level,
      layer: rule.layer,
      use: rule.use,
      src: rule.src,
      start,
      end,
      line,
      col,
      match: text.slice(start, end),
      context: lineText.trim().slice(0, 120),
      ...extra,
    });
  };

  for (const rule of rules) {
    if (rule.custom === 'dash') {
      if (dash === 'off') continue;
      for (const s of sentencesOf(masked)) {
        if ((s.text.match(/—/g) ?? []).length !== 1 || !/[.?!]$/.test(s.text)) continue;
        const at = masked.indexOf('—', s.start);
        // 줄표 앞이 절(서술어로 끝나는 말)일 때만 잡는다. "- **용어** — 설명" 처럼 앞이 이름표면
        // 제목 — 부제와 같은 쓰임이라 규범이 허용한다.
        const lineHead = masked.slice(starts[locate(starts, at).line - 1], at);
        if (/^\s*(?:[-*+]|\d+[.)])?\s*(?:\*\*[^*]+\*\*|__[^_]+__)\s*$/.test(lineHead)) continue; // 굵은 이름표
        const before = masked.slice(s.start, at).replace(/[\s*_)\]]+$/, '');
        if (/(?:다|요|죠|음|함|됨|임|고|며|서|면|만|데)$/.test(before)) push(rule, at, at + 1);
      }
      continue;
    }
    if (rule.custom === 'tone') {
      if (!TONE_OK[tone]) continue;
      for (const s of sentencesOf(masked)) {
        const lineStart = starts[locate(starts, s.start).line - 1];
        const head = masked.slice(lineStart, s.start);
        if (/^\s*(?:#|\|)/.test(head + s.text)) continue; // 제목·표는 문장이 아니다
        const t = toneOf(s.text);
        if (t && !TONE_OK[tone].includes(t)) {
          const lastWord = s.text.search(/\S+$/);
          push(rule, s.start + Math.max(lastWord, 0), s.end, {
            found: TONE_NAME[t],
            expected: TONE_NAME[tone],
          });
        }
      }
      continue;
    }
    const hits = [];
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(masked))) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
        continue;
      }
      hits.push([m.index, m.index + m[0].length]);
    }
    // 빈도 규칙은 횟수와 비율을 함께 본다 — 사람도 쓰는 표현이라 한두 번은 문제가 아니고,
    // 긴 글에서는 횟수만 세면 언제나 넘는다(KatFishNet: 연결 어미 뒤 쉼표는 사람 4.1% · LLM 19.8%).
    if (rule.freq) {
      const total = sentencesOf(masked).filter((x) => /[가-힣]/.test(x.text)).length || 1;
      if (hits.length < rule.freq || hits.length / total < (rule.rate ?? 0)) continue;
    }
    for (const [s, e] of hits) push(rule, s, e, rule.freq ? { count: hits.length } : {});
  }
  return dedupe(found);
}

const SENTENCE_RULES = new Set(['KO-T-01', 'KO-P-01']);

/** 같은 자리를 두 규칙이 잡으면 하나만 남긴다 — 더 강한 쪽, 같으면 팀 규칙(저장소가 정한 말) */
function dedupe(found) {
  const kept = [];
  for (const f of [...found].sort((a, b) => a.start - b.start)) {
    // 말투·줄표는 문장 단위 판정이라 어휘 규칙과 겹쳐도 따로 남긴다
    if (SENTENCE_RULES.has(f.id)) {
      kept.push(f);
      continue;
    }
    const clash = kept.findIndex(
      (k) => !SENTENCE_RULES.has(k.id) && f.start < k.end && k.start < f.end,
    );
    if (clash === -1) {
      kept.push(f);
      continue;
    }
    const k = kept[clash];
    const better =
      RANK[f.level] > RANK[k.level] || (RANK[f.level] === RANK[k.level] && f.layer === 'team' && k.layer !== 'team');
    if (better) kept[clash] = f;
  }
  return kept;
}

/** 새로 쓴 줄만 남긴다 — 이전 글에 같은 줄이 있으면 빈 줄로 둔다(줄 번호를 지키려고) */
export function addedText(oldText, newText) {
  const before = new Set(oldText.split('\n').map((l) => l.trim()).filter(Boolean));
  return newText
    .split('\n')
    .map((l) => (before.has(l.trim()) ? '' : l))
    .join('\n');
}

// ── 보고 ────────────────────────────────────────────────────────────────────

function describe(f) {
  const what = f.id === 'KO-T-01' ? `「${f.match}」 ${f.found}` : `「${f.match.trim()}」`;
  const want = f.id === 'KO-T-01' ? `${f.expected}로 쓴다` : `대신 ${f.use}`;
  const count = f.count ? ` · 이 글에서 ${f.count}번` : '';
  return `${what} → ${want} (${f.id} ${f.name}${count} · ${f.src})`;
}

function listFor(findings, { lineOffset = 0, max = 10 } = {}) {
  const lines = findings
    .slice(0, max)
    .map((f) => `- ${f.line + lineOffset}행 ${describe(f)}`);
  if (findings.length > max) lines.push(`- 그 밖에 ${findings.length - max}곳`);
  return lines.join('\n');
}

// ── 명령: check · rules · digest ────────────────────────────────────────────

function git(args, cwd) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** `git diff -U0` 에서 추가된 줄만 파일별로 모은다 */
export function addedLinesOf(diff) {
  const files = new Map();
  let cur = null;
  let ln = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      cur = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (cur && !files.has(cur)) files.set(cur, []);
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) {
      ln = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
      continue;
    }
    if (cur === null) continue;
    if (line.startsWith('+')) {
      files.get(cur).push({ line: ln, text: line.slice(1) });
      ln += 1;
    } else if (line.startsWith(' ')) ln += 1;
  }
  return files;
}

const isMarkdown = (p) => /\.(?:md|mdx|markdown|txt)$/i.test(p);

function lintOptions(surface, path, override = {}) {
  const markdown = surface.markdown ?? isMarkdown(path);
  return {
    tone: override.tone ?? surface.tone ?? 'off',
    dash: override.dash ?? surface.dash ?? 'check',
    markdown,
    quotes: surface.quotes ? surface.quotes === 'skip' : markdown,
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (['staged', 'strict', 'json', 'static', 'all'].includes(key)) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(a);
  }
  return out;
}

function runCheck(args) {
  const cwd = process.cwd();
  const conf = findRepoConfig(cwd);
  if (conf.error) console.error(`${CONFIG_NAME} 를 읽지 못했다: ${conf.error}`);
  const st = settingsOf(conf.config);
  const rules = compileRules(loadCoreRules(), st);
  const levels = new Set((args.levels ?? 'block,warn,hint').split(','));
  const override = { tone: args.tone, dash: args.dash };
  const results = []; // { path, findings }

  if (args.text !== undefined) {
    const findings = lint(String(args.text), {
      rules,
      tone: args.tone ?? 'off',
      dash: args.dash ?? 'check',
      markdown: true,
      quotes: true,
    });
    results.push({ path: '(text)', findings });
  }

  const fromDiff = (diff) => {
    for (const [file, added] of addedLinesOf(diff ?? '')) {
      const abs = resolve(conf.root, file);
      const rel = toPosix(relative(conf.root, abs));
      const surface = surfaceFor(rel, st);
      if (!surface || added.length === 0) continue;
      const findings = lint(added.map((a) => a.text).join('\n'), { rules, ...lintOptions(surface, rel, override) });
      for (const f of findings) f.line = added[f.line - 1]?.line ?? f.line;
      results.push({ path: rel, findings });
    }
  };

  if (args.staged) fromDiff(git(['diff', '--cached', '-U0', '--no-color'], conf.root));
  if (args.base) {
    const mb = git(['merge-base', args.base, 'HEAD'], conf.root)?.trim() || args.base;
    fromDiff(git(['diff', '-U0', '--no-color', mb], conf.root));
  }
  for (const p of args._) {
    const abs = resolve(cwd, p);
    const rel = toPosix(relative(conf.root, abs));
    const surface = surfaceFor(rel, st) ?? { tone: 'off', dash: 'check' };
    const text = readFileSync(abs, 'utf8');
    results.push({ path: rel, findings: lint(text, { rules, ...lintOptions(surface, rel, override) }) });
  }

  const filtered = results
    .map((r) => ({ ...r, findings: r.findings.filter((f) => levels.has(f.level)) }))
    .filter((r) => r.findings.length > 0);
  const all = filtered.flatMap((r) => r.findings);
  const failing = all.filter((f) => f.level === 'block' || (args.strict && f.level === 'warn'));

  if (args.json) {
    console.log(JSON.stringify(filtered, null, 2));
  } else if (all.length === 0) {
    console.log('ko-style: 찾은 표현이 없다.');
  } else {
    for (const r of filtered) {
      for (const f of r.findings) {
        console.log(`${r.path}:${f.line}:${f.col} ${LEVEL_NAME[f.level]} ${describe(f)}`);
      }
    }
    const count = (lv) => all.filter((f) => f.level === lv).length;
    console.log(
      `\nko-style: 차단 ${count('block')} · 경고 ${count('warn')} · 참고 ${count('hint')} (파일 ${filtered.length}개)`,
    );
  }
  return failing.length > 0 ? 1 : 0;
}

function pluginVersion() {
  try {
    return readJson(MANIFEST_PATH).version;
  } catch {
    return null;
  }
}

/** 세션 요약 — 규칙 표에서 만든다. 사람이 따로 쓰지 않는다(두 벌이면 어긋난다) */
export function digest(st, conf, { staticMode = false } = {}) {
  const core = loadCoreRules();
  const version = pluginVersion();
  const pair = (r) =>
    r.examples?.bad?.[0] && r.examples?.good?.[0]
      ? `${r.examples.bad[0].replace(/[.!?]$/, '')} → ${r.examples.good[0].replace(/[.!?]$/, '')}`
      : r.avoid
        ? `${r.avoid.slice(0, 3).join(' · ')} → ${r.use}`
        : `→ ${r.use}`;
  const strong = core.filter((r) => !r.custom && r.level !== 'hint' && !r.freq);
  const hints = core.filter((r) => !r.custom && r.level === 'hint');
  const out = [
    `ko-style 한국어 문체 규칙${version ? ` (플러그인 v${version})` : ''}`,
    '한국어로 답하거나 한국어 문서·커밋 메시지·PR 본문·화면 문구를 쓸 때 적용된다. 영어 글에는 적용되지 않는다.',
    '- 한국의 개발자와 사용자가 실제로 쓰는 말로 쓴다. 영어를 옮긴 듯한 표현과 사물에 사람의 동작을 붙이는 비유를 쓰지 않는다.',
    '- 한 문장에는 한 가지만 쓴다. 문장 끝에 줄표(—) 하나를 넣어 설명을 덧붙이지 않고, 연결 어미 뒤에 쉼표를 찍지 않는다.',
    '- "A가 아니라 B" 대비는 꼭 필요할 때 한 번만 쓴다.',
    '- 소리 내어 읽었을 때 한국어 화자가 그렇게 말하지 않을 문장이면 고친다.',
    '',
    '쓰지 않는 표현 → 대신 쓸 표현',
    ...strong.map((r) => `- ${r.name}: ${pair(r)}`),
    `- 문맥을 보고 판단한다: ${hints.map((r) => r.name).join(', ')}`,
  ];
  if (!staticMode && st.team.length > 0) {
    out.push('', `이 저장소의 팀 어휘 (${CONFIG_NAME})`);
    for (const r of st.team) out.push(`- ${r.name}: ${pair(r)}`);
  }
  const toned = staticMode ? [] : st.surfaces.filter((s) => TONE_OK[s.tone]);
  if (toned.length > 0) {
    out.push('', '글 종류별 말투');
    for (const s of toned) out.push(`- ${s.name} (${(s.files ?? []).join(', ')}): ${TONE_NAME[s.tone]}`);
  }
  out.push(
    '',
    staticMode
      ? '이 기계에는 node 가 없어서 자동 검사는 돌지 않는다. 위 규칙은 그대로 적용된다.'
      : '커밋 메시지와 PR 본문은 만들기 전에, 문서 파일은 저장한 직후에 검사해서 걸린 표현을 알려 준다. 인용·고유명사·예문은 그대로 둔다. 대화 답변은 끝난 뒤 검사해서 걸린 표현을 사용자에게 알린다.',
  );
  if (!staticMode && conf?.error) out.push(`${CONFIG_NAME} 를 읽지 못해 기본값으로 검사한다: ${conf.error}`);
  return out.join('\n');
}

const SKILL_PATH = join(HERE, '..', 'SKILL.md');
const DIGEST_PATH = join(HERE, '..', '..', '..', 'hooks', 'digest.json');
export const RULES_BEGIN = '<!-- ko-style:rules:begin — rules/core.json 에서 만든다. 손으로 고치지 않는다 (ko-lint.mjs sync) -->';
export const RULES_END = '<!-- ko-style:rules:end -->';

/** SKILL.md 의 규칙 표 — 예문은 따옴표로 감싼다(인용은 검사하지 않으므로 이 표가 스스로 걸리지 않는다) */
export function skillRulesTable() {
  const q = (s) => `"${s}"`;
  const rows = loadCoreRules().map((r) => {
    const level =
      LEVEL_NAME[r.level] + (r.freq ? ` (한 글에 ${r.freq}번 이상 · 문장의 ${Math.round((r.rate ?? 0) * 100)}% 이상)` : '');
    const bad = r.examples?.bad?.[0] ? q(r.examples.bad[0]) : r.name;
    const good = r.examples?.good?.[0] ? q(r.examples.good[0]) : r.use;
    return `| ${r.id} | ${level} | ${bad} | ${good} | ${r.src} |`;
  });
  return ['| ID | 강도 | 쓰지 않는 표현 | 대신 | 근거 |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export function staticDigestJson() {
  const text = digest(settingsOf({}), null, { staticMode: true });
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }, null, 2)}\n`;
}

/** 규칙 표에서 만드는 두 파일을 다시 쓴다 — 규칙을 고친 사람이 돌린다(테스트가 어긋남을 잡는다) */
function runSync() {
  const skill = readFileSync(SKILL_PATH, 'utf8');
  const from = skill.indexOf(RULES_BEGIN);
  const to = skill.indexOf(RULES_END);
  if (from === -1 || to === -1) throw new Error('SKILL.md 에 규칙 표 표시가 없다');
  writeFileSync(SKILL_PATH, `${skill.slice(0, from + RULES_BEGIN.length)}\n\n${skillRulesTable()}\n\n${skill.slice(to)}`);
  writeFileSync(DIGEST_PATH, staticDigestJson());
  console.log('SKILL.md 규칙 표와 hooks/digest.json 을 다시 썼다');
  return 0;
}

function runRules(args) {
  const conf = findRepoConfig(process.cwd());
  const st = settingsOf(conf.config);
  const rules = compileRules(loadCoreRules(), st);
  if (args.json) {
    console.log(JSON.stringify(rules.map(({ re: _re, ...r }) => r), null, 2));
    return 0;
  }
  for (const r of rules) {
    console.log(`${r.id} [${LEVEL_NAME[r.level]}] ${r.name} → ${r.use}${r.freq ? ` (한 글에 ${r.freq}번 이상)` : ''}`);
  }
  return 0;
}

// ── 훅 ──────────────────────────────────────────────────────────────────────

function loadState(dir, name, fallback) {
  try {
    return readJson(join(dir, name));
  } catch {
    return fallback;
  }
}

function saveState(dir, name, value) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(value));
  } catch {
    // 상태를 못 남겨도 검사는 계속된다
  }
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const print = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

/**
 * 셸 명령에서 커밋 메시지와 PR 제목·본문을 꺼낸다. Claude Code 는 보통
 * `git commit -m "$(cat <<'EOF' … EOF)"` 로 커밋하므로 heredoc 을 먼저 본다.
 */
export function messagesOf(command, cwd = process.cwd()) {
  const isCommit = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+commit\b/.test(command);
  const isPr = /\bgh\s+pr\s+(?:create|edit)\b/.test(command);
  if (!isCommit && !isPr) return [];
  const kind = isCommit ? '커밋 메시지' : 'PR 본문';
  const out = [];
  for (const m of command.matchAll(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2(?=\s|$|\))/g)) {
    out.push({ kind, text: m[3] });
  }
  const value = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|[^\s'"]+)`;
  const flags = isCommit ? '-m|--message' : '-t|--title|-b|--body';
  for (const m of command.matchAll(new RegExp(String.raw`(?:^|\s)(?:${flags})(?:\s+|=)${value}`, 'g'))) {
    const v = unquote(m[1]);
    if (!v.startsWith('$(')) out.push({ kind: /-t|--title/.test(m[0]) ? 'PR 제목' : kind, text: v });
  }
  const fileFlags = isCommit ? '-F|--file' : '-F|--body-file';
  for (const m of command.matchAll(new RegExp(String.raw`(?:^|\s)(?:${fileFlags})(?:\s+|=)${value}`, 'g'))) {
    const p = unquote(m[1]);
    if (p === '-') continue;
    try {
      out.push({ kind, text: readFileSync(resolve(cwd, p), 'utf8') });
    } catch {
      // 없는 파일이면 git 이 알아서 실패한다
    }
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const strong = (findings) => findings.filter((f) => f.level === 'block' || f.level === 'warn');

export function handleHook(event, input, { data }) {
  const cwd = input.cwd || process.cwd();

  if (event === 'session-start' || event === 'subagent-start') {
    const conf = findRepoConfig(cwd);
    const st = settingsOf(conf.config);
    if (!st.enabled) return null;
    return {
      hookSpecificOutput: {
        hookEventName: event === 'session-start' ? 'SessionStart' : 'SubagentStart',
        additionalContext: digest(st, conf),
      },
    };
  }

  if (event === 'pre-bash') {
    const conf = findRepoConfig(cwd);
    const st = settingsOf(conf.config);
    if (!st.enabled) return null;
    const msgs = messagesOf(input.tool_input?.command ?? '', cwd);
    if (msgs.length === 0) return null;
    const rules = compileRules(loadCoreRules(), st);
    const found = msgs.flatMap((m) =>
      strong(lint(m.text, { rules, tone: st.commit.tone, dash: st.commit.dash, markdown: true, quotes: true })).map(
        (f) => ({ ...f, kind: m.kind }),
      ),
    );
    if (found.length === 0) return null;
    // **같은 글을 두 번 내면 통과시킨다.** 인용·고유명사처럼 그대로 둬야 하는 경우를 모델이
    // 판단할 길이다 — 이 길이 없으면 오탐 하나가 커밋을 영영 막는다.
    const key = sha(msgs.map((m) => m.text).join('\n'));
    const denied = loadState(data, 'denied.json', []);
    if (denied.includes(key)) return null;
    saveState(data, 'denied.json', [...denied, key].slice(-50));
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: [
          `ko-style: ${found[0].kind}에서 고칠 표현 ${found.length}곳을 찾았다.`,
          listFor(found),
          '고쳐서 다시 실행한다. 인용·고유명사·예문이라 그대로 둬야 하면 같은 메시지로 한 번 더 실행하면 통과한다.',
        ].join('\n'),
      },
    };
  }

  if (event === 'post-edit') {
    const tool = input.tool_name;
    const ti = input.tool_input ?? {};
    if (!ti.file_path) return null;
    const abs = isAbsolute(ti.file_path) ? ti.file_path : resolve(cwd, ti.file_path);
    const conf = findRepoConfig(dirname(abs));
    const st = settingsOf(conf.config);
    if (!st.enabled) return null;
    const rel = toPosix(relative(conf.root, abs));
    const surface = surfaceFor(rel, st);
    if (!surface) return null;
    const rules = compileRules(loadCoreRules(), st);
    const current = safeRead(abs) ?? ti.content ?? '';
    const chunks = [];
    if (tool === 'Write') {
      const before = git(['show', `HEAD:./${basename(abs)}`], dirname(abs)) ?? '';
      chunks.push({ text: addedText(before, ti.content ?? current), offset: 0 });
    } else {
      const edits = Array.isArray(ti.edits) ? ti.edits : [{ old_string: ti.old_string, new_string: ti.new_string }];
      for (const e of edits) {
        const next = e.new_string ?? '';
        const at = next ? current.indexOf(next) : -1;
        const offset = at >= 0 ? current.slice(0, at).split('\n').length - 1 : 0;
        chunks.push({ text: addedText(e.old_string ?? '', next), offset });
      }
    }
    const found = chunks.flatMap((c) =>
      strong(lint(c.text, { rules, ...lintOptions(surface, rel) })).map((f) => ({ ...f, line: f.line + c.offset })),
    );
    if (found.length === 0) return null;
    return {
      decision: 'block',
      reason: [
        `ko-style: ${rel} 에 새로 쓴 문장에서 고칠 표현 ${found.length}곳을 찾았다 (글 종류: ${surface.name ?? '문서'}).`,
        listFor(found),
        '고칠 수 있으면 고친다. 인용·고유명사·예문이라 그대로 둬야 하면 그대로 두고 넘어간다.',
      ].join('\n'),
    };
  }

  if (event === 'stop') {
    const conf = findRepoConfig(cwd);
    const st = settingsOf(conf.config);
    if (!st.enabled || st.reply.mode === 'off' || input.stop_hook_active) return null;
    const msg = input.last_assistant_message ?? '';
    if (!/[가-힣]/.test(msg)) return null;
    const rules = compileRules(loadCoreRules(), st);
    const found = strong(lint(msg, { rules, tone: st.reply.tone, dash: st.reply.dash, markdown: true, quotes: true }));
    if (found.length === 0) return null;
    if (st.reply.mode === 'rewrite') {
      return {
        decision: 'block',
        reason: [`ko-style: 방금 답변에서 고칠 표현 ${found.length}곳을 찾았다.`, listFor(found), '고친 답변을 짧게 다시 쓴다.'].join('\n'),
      };
    }
    const pending = loadState(data, 'pending.json', {});
    const now = Date.now();
    for (const [k, v] of Object.entries(pending)) if (now - (v.at ?? 0) > 86_400_000) delete pending[k];
    pending[input.session_id ?? 'default'] = { at: now, items: found.slice(0, 10).map(describe) };
    saveState(data, 'pending.json', pending);
    const shown = found
      .slice(0, 3)
      .map((f) => `「${f.match.trim()}」 → ${f.id === 'KO-T-01' ? f.expected : f.use.replace(/^"|"$/g, '').split('", "')[0]}`)
      .join(', ');
    return {
      systemMessage: `ko-style · 방금 답변에서 고칠 표현 ${found.length}곳: ${shown}${found.length > 3 ? ' 외' : ''}. 다음 답변부터 반영하도록 알렸습니다.`,
    };
  }

  if (event === 'prompt') {
    const pending = loadState(data, 'pending.json', {});
    const sid = input.session_id ?? 'default';
    const item = pending[sid];
    if (!item) return null;
    delete pending[sid];
    saveState(data, 'pending.json', pending);
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: ['ko-style: 직전 답변에 고칠 표현이 있었다. 이번 답변부터 대신 쓸 표현을 쓴다.', ...item.items.map((i) => `- ${i}`)].join('\n'),
      },
    };
  }

  return null;
}

// ── 진입점 ──────────────────────────────────────────────────────────────────

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === 'check') return runCheck(args);
  if (command === 'rules') return runRules(args);
  if (command === 'sync') return runSync();
  if (command === 'digest') {
    if (args.static) {
      process.stdout.write(staticDigestJson());
      return 0;
    }
    const conf = findRepoConfig(process.cwd());
    console.log(digest(settingsOf(conf.config), conf));
    return 0;
  }
  if (command === 'hook') {
    if (process.env.KO_STYLE_DISABLE === '1') return 0;
    try {
      const raw = await readStdin();
      const input = raw.trim() ? JSON.parse(raw) : {};
      const data = args.data || process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'ko-style');
      const out = handleHook(args._[0], input, { data });
      if (out) print(out);
    } catch {
      // 훅은 세션을 멈추지 않는다
    }
    return 0;
  }
  console.error('사용: ko-lint.mjs check|rules|digest|hook — 자세한 것은 파일 첫 주석을 본다');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // process.exit() 는 파이프로 나가는 긴 출력을 자른다 — 종료 코드만 정해 두고 자연스럽게 끝낸다
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
