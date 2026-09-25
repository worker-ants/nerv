// 읽는 글자는 어느 단이든 AA 다 (2026-09-25 — 사람 결정 D4 · UI/UX 검토 SYS-04 · SYS-X1)
//
// 2026-08-24 에 시안의 값으로 맞춘 중립 램프는 흰 바탕에서 mute 4.48 · faint 2.81 이었다. 폼 힌트 · 빈 상태의
// "다음 할 일" · 상대 시각 · 작업 키가 그 색이었고, 사이드바의 mute 글자는 hover 바탕에서 3.96 이었다. 다크의 주
// 단추는 흰 글자가 밝은 보라(#818cf8) 위에 있어 2.98 이었다. **눈으로 대조한 값은 다음 손이 한 단 흐리게 되돌린다**
// — 그래서 표로 센다. 순서도 센다: faint 를 올리다 mute 보다 진해지면 "흐린" 단이 "보조" 단보다 진해진다(SYS-X1
// 이 제안 값에서 실제로 찾은 역전이다).
//
// 네 번째 단 `ghost` 는 대비를 세지 않는다 — **장식과 비활성에만** 쓰기 때문이다(WCAG 도 비활성 요소는 뺀다).
// 대신 그 약속을 센다: 읽는 글자에 ghost 가 쓰였으면 실패한다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');

/** 한 블록의 `--color-*` 선언 — 값은 hex 이거나 다른 색의 `var()` 다 */
function declarations(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)].map(
      (m) => [m[1] as string, (m[2] as string).trim()] as const,
    ),
  );
}

function blockAfter(marker: string): string {
  const start = CSS.indexOf(marker);
  if (start < 0) throw new Error(`tokens.css 에 ${marker} 가 없다`);
  const open = CSS.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    if (CSS[i] === '}' && --depth === 0) return CSS.slice(open + 1, i);
  }
  throw new Error(`${marker} 블록이 닫히지 않았다`);
}

const LIGHT = declarations(blockAfter('@theme {'));
/** 다크는 라이트 위에 다시 정의한 것만 덮는다 — 정의하지 않은 값은 라이트의 것이 그대로 쓰인다 */
const DARK = new Map([...LIGHT, ...declarations(blockAfter(":root[data-theme='dark'] {"))]);
const THEMES = { light: LIGHT, dark: DARK } as const;

function hex(theme: Map<string, string>, name: string): string {
  let value = theme.get(name);
  for (let hop = 0; value?.startsWith('var(') === true && hop < 5; hop++) {
    value = theme.get(/var\(--color-([a-z0-9-]+)\)/.exec(value)?.[1] ?? '');
  }
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`--color-${name} 를 hex 로 풀 수 없다(${String(value)})`);
  }
  return value;
}

/** WCAG 2.x 상대 휘도 */
function luminance(color: string): number {
  const channel = (i: number): number => {
    const c = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 읽는 글자 × 그 글자가 놓이는 면 — 둘 다 4.5 이상이어야 한다 */
const READING_PAIRS: [text: string, surfaces: string[]][] = [
  ['text', ['bg', 'bg-elev', 'bg-sunken', 'bg-hover', 'bg-active']],
  // 사이드바 항목은 mute 글자가 hover·active 바탕을 지난다 — 가장 자주 읽는 글자다
  ['text-mute', ['bg', 'bg-elev', 'bg-sunken', 'bg-hover', 'bg-active']],
  ['text-faint', ['bg', 'bg-elev', 'bg-sunken']],
  ['link', ['bg', 'bg-elev', 'bg-sunken']],
  ['code-text', ['code-bg']],
  // 상태 배지(글자 on 옅은 칠)와 문장 속 상태색(글자 on 바탕)
  ...(['idle-text', 'action', 'waiting', 'agent', 'progress', 'ok', 'done', 'danger'] as const).map(
    (tone): [string, string[]] => [
      `status-${tone}`,
      [tone === 'idle-text' ? 'status-idle' : `status-${tone}-soft`, 'bg'],
    ],
  ),
  // 상태색으로 칠한 면 위의 글자(주 단추 · 파괴 확정)
  ['on-status', ['status-action', 'status-danger', 'status-done']],
];

describe('대비 — 읽는 글자는 AA(4.5:1) 이상이다 (D4)', () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    it(`${themeName} — 글자 × 면의 표`, () => {
      const failing = READING_PAIRS.flatMap(([text, surfaces]) =>
        surfaces
          .map((surface) => ({
            pair: `${text} on ${surface}`,
            ratio: Math.round(contrast(hex(theme, text), hex(theme, surface)) * 100) / 100,
          }))
          .filter((row) => row.ratio < 4.5),
      );
      expect(failing).toEqual([]);
    });

    it(`${themeName} — 단의 순서: text > mute > faint`, () => {
      const onBg = (name: string): number => contrast(hex(theme, name), hex(theme, 'bg'));
      expect(onBg('text')).toBeGreaterThan(onBg('text-mute'));
      expect(onBg('text-mute')).toBeGreaterThan(onBg('text-faint'));
    });
  }

  it('계산이 맞다 — 흰 바탕의 검정은 21:1, 같은 색은 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

/** `apps/web/src` 의 컴포넌트 파일 전부 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [p] : [];
  });
}

/**
 * 그 자리의 JSX 여는 태그 — 앞의 `<` 부터 태그를 닫는 `>` 까지. 중괄호 안(`{() => …}` · `cn(…)`)의 `>` 는
 * 태그를 닫지 않는다.
 */
function enclosingTag(source: string, at: number): string {
  const start = source.lastIndexOf('<', at);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && source[i - 1] !== '=') return source.slice(start, i + 1);
  }
  return source.slice(start);
}

describe('ghost 는 장식과 비활성에만 (2026-09-25)', () => {
  it('읽는 글자에 text-ghost 가 없다 — 쓰인 자리는 aria-hidden · 비활성 · 변형(before: · disabled:)이다', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(\S*)text-text-ghost/g)) {
        // `before:` · `disabled:` · `hover:` 처럼 상태·가상 요소에 붙은 것은 그 상태의 모양이다
        if (/:$/.test(match[1] ?? '')) continue;
        const tag = enclosingTag(source, match.index ?? 0);
        if (/aria-hidden|aria-disabled|\bdisabled\b/.test(tag)) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
