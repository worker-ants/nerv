// 없는 토큰은 조용히 아무 색도 칠하지 않는다 (REQ-WEB-032 의 반대편)
//
// `eslint.config.js` 의 REQ-WEB-032 는 **임의 hex** 를 막는다 — 팔레트가 조용히 갈라지는 것을
// 막는 규칙이다. 그런데 반대 방향의 구멍이 있었다: `bg-surface` 처럼 **실재하지 않는 토큰 이름**은
// hex 가 아니라 lint 를 통과하고, Tailwind 는 그 클래스에 **아무 CSS 도 내지 않는다.**
//
// 그래서 기준선 생성 다이얼로그가 **배경 없이** 떴다(2026-09-06 · 사람 보고). 뒤의 관계 그래프가
// 그대로 비쳐 글이 읽히지 않았고, 같은 자리가 셀렉트 셋에 더 있었다 — 한 손이 같은 날 쓴 넷이다.
// **틀린 색이면 눈에 띄지만 없는 색은 눈에 띄지 않는다** — 라이트 테마에서는 바탕이 흰색이라
// 배경이 없어도 흰색으로 보였다. 다크 테마에서만 드러난다.
//
// 그래서 사람의 눈이 아니라 검사가 센다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(SRC, 'styles', 'tokens.css');

/** `--color-X: …` 선언에서 X 를 모은다 — 이것이 실재하는 색 이름의 전부다. */
function definedColors(): ReadonlySet<string> {
  const css = readFileSync(TOKENS, 'utf8');
  return new Set(
    [...css.matchAll(/--(?:color|shadow)-([a-z0-9-]+)\s*:/g)].map((m) => m[1] as string),
  );
}

/**
 * Tailwind 가 기본으로 주는 색 — 토큰이 아니어도 실재한다.
 *
 * 팔레트 색(`red-500` 등)은 **일부러 뺐다**: 그것을 쓰는 것은 토큰 체계를 비켜 가는 일이고
 * REQ-WEB-032 가 hex 를 막는 것과 같은 이유로 막혀야 한다.
 */
const BUILTIN = new Set(['transparent', 'current', 'inherit', 'white', 'black']);

/**
 * 같은 접두사를 쓰지만 **색이 아닌** 유틸리티.
 *
 * Tailwind 는 `text-`·`border-`·`bg-` 를 색 말고도 쓴다(크기·정렬·굵기·반복). 이 목록에
 * 없는 이름이 나오면 검사가 멈춘다 — **모르는 것을 통과시키지 않는다**는 것이 이 검사의 값이다.
 */
const NOT_A_COLOR = new Set([
  // text- 크기·정렬·줄바꿈
  '2xs',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'nowrap',
  'ellipsis',
  'clip',
  'balance',
  'pretty',
  'wrap',
  // border- 두께·모양
  '0',
  '2',
  '4',
  '8',
  'solid',
  'dashed',
  'dotted',
  'none',
  'collapse',
  'separate',
  't',
  'r',
  'b',
  'l',
  'x',
  'y',
  'e',
  's',
  // bg- 위치·크기·반복
  'cover',
  'contain',
  'fixed',
  'local',
  'scroll',
  'repeat',
  'top',
  'bottom',
  // 공통
  'auto',
  'hidden',
  'visible',
]);

/** 접두사째로 색이 아닌 것 — `bg-gradient-to-b` · `outline-offset-2`. */
const NOT_A_COLOR_PREFIX = ['gradient-', 'offset-'];

/** `apps/web/src` 의 컴포넌트 파일 전부. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [p] : [];
  });
}

/**
 * `bg-x` · `text-x/40` · `hover:border-x` 에서 x 를 뽑는다. 임의값(`[...]`)은 lint 의 몫이다.
 *
 * 뒤의 `(?!['\"]\\s*:)` 는 **Cytoscape 스타일 키**를 거른다 — 그래프는 `'text-valign'`·
 * `'border-width'` 처럼 같은 모양의 이름을 객체 키로 쓴다. 클래스가 아니라 속성이다.
 */
const COLOR_CLASS =
  /(?<![\w-])(?:bg|text|border|ring|fill|stroke|outline|divide|shadow)-([a-z][a-z0-9-]*)(?:\/\d+)?(?![\w[/-])(?!['"]\s*:)/g;

/** `border-l-status-waiting` 의 `l-` 처럼 **변 지정**이 앞에 붙는다 — 색 이름은 그 뒤다. */
const SIDE = /^(?:t|r|b|l|x|y|s|e)-/;

describe('디자인 토큰', () => {
  const defined = definedColors();

  it('토큰 파일이 실제로 색을 정의한다 — 이 검사가 빈 집합을 통과시키지 않게', () => {
    expect(defined.size).toBeGreaterThan(20);
    expect(defined.has('bg-elev')).toBe(true);
    expect(defined.has('status-danger')).toBe(true);
  });

  it('컴포넌트가 쓰는 색 이름은 모두 실재한다 — 없는 토큰은 아무 CSS 도 내지 않는다', () => {
    const ghosts: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(COLOR_CLASS)) {
        const name = (m[1] as string).replace(SIDE, '');
        if (defined.has(name) || BUILTIN.has(name) || NOT_A_COLOR.has(name)) continue;
        if (NOT_A_COLOR_PREFIX.some((p) => name.startsWith(p))) continue;
        ghosts.push(`${file.slice(SRC.length + 1)}: ${m[0]}`);
      }
    }
    // 실패하면 둘 중 하나다 — 오타이거나(그러면 고친다),
    // 색이 아닌 새 유틸리티이거나(그러면 NOT_A_COLOR 에 더한다).
    expect(ghosts).toEqual([]);
  });
});
