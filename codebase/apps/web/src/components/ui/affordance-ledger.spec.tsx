// 누를 수 있는 것은 쉴 때 누를 수 있어 보인다 — 장부
// (2026-09-28 · 사람 결정 A1~A7 · screens.md §4.4 · REQ-WEB-271~276)
//
// 알림의 [모두 읽음]이 쉴 때 옆의 설명문과 같은 회색 글자여서 누를 수 있는 줄 몰랐다는 보고로 웹 전체를 다시 봤다.
// 122건이 나왔고 뿌리는 `ghost` 변형 하나가 아니었다 — ghost 를 원시 `<button>` 으로 다시 짠 곳이 더 많았고, hover 때만
// 링크색이 되는 링크와 링크색 글자로 된 명령이 있었다. 한 번에 고치지 않고 **수를 장부에 적고 PR 마다 줄였고**
// (임의 px 장부와 같은 방식), 네 번째 PR 에서 장부가 비었다. 남은 것은 관례라 두는 자리이고 이유와 함께 허용 목록에
// 적는다 — 목록 밖에서 새로 생기면 실패한다.
//
// 소스를 글자로 읽는 검사라 모양을 정확히 알지는 못한다 — 여는 태그 안의 클래스(같은 파일의 상수와 `nav-styles.ts` 의
// 상수는 풀어서 본다)만 보고, 쉴 때의 단서(테두리 · 바탕 · 밑줄 · 링크색 · 상태색)가 있는지 센다. `primitives.tsx` 는
// 모양을 정하는 곳이라 세지 않는다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [p] : [];
  });
}
const rel = (file: string): string => file.slice(SRC.length + 1);

/** 여는 태그 — 중괄호·따옴표 안의 `>` 는 태그의 끝이 아니다 */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const start = new RegExp(`<${name}(?=[\\s>])`, 'g');
  for (let m = start.exec(source); m !== null; m = start.exec(source)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + name.length + 1;
    for (; i < source.length; i++) {
      const ch = source[i]!;
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

/**
 * `const 이름 = '…'` 꼴의 클래스 상수 — 클래스를 상수로 빼도 검사가 본다(`chip` · `btn` 상수가 REQ-WEB-238 검사를 피했다).
 * 값이 클래스처럼 생긴 것만 든다 — 문구 상수를 클래스로 읽지 않게.
 */
function stringConstants(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"`])([\s\S]*?)\2/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    if (/^[a-z0-9\s\-:[\]/.&>()%!_]+$/.test(m[3]!)) out[m[1]!] = m[3]!;
  }
  return out;
}
const SHARED = stringConstants(readFileSync(join(SRC, 'components/nav-styles.ts'), 'utf8'));

function expand(tag: string, local: Record<string, string>): string {
  const names = tag.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  return [tag, ...names.map((n) => local[n] ?? SHARED[n] ?? '')].join(' ');
}

/** 쉴 때의 클래스 — `hover:` · `focus:` · `group-hover:` 처럼 조건이 붙은 것은 뺀다 */
function restClasses(text: string): string[] {
  return (text.match(/[A-Za-z0-9_\-:[\]&>.()%/!]+/g) ?? []).filter((c) => !c.includes(':'));
}

/**
 * 조건이 붙은 클래스를 뺀다 — `고른 것 ? 'bg-bg-active' : '…'` · `켬 && 'bg-…'`. 고른 칸만 칠하는 묶음([뷰어|소스] ·
 * 언어 · 테마)은 고르지 않은 칸이 글자뿐이다.
 */
function unconditional(text: string): string {
  return text.replace(/(?:\?|&&)\s*(['"`])[^'"`]*\1/g, ' ');
}

/** 쉴 때 누를 수 있다는 단서가 있는가 — 테두리 · 바탕 · 밑줄 · 링크색 · 상태색 */
function hasRestCue(text: string): boolean {
  const rest = restClasses(unconditional(text));
  const has = (re: RegExp): boolean => rest.some((c) => re.test(c));
  const border =
    has(/^border(-[trblxy])?$/) &&
    has(/^border-(border|border-strong|current|text|status-[a-z-]+)$/);
  return (
    border ||
    has(/^bg-(?!transparent\b)[a-z]/) ||
    has(/^underline$/) ||
    has(/^text-link$/) ||
    has(/^text-status-/)
  );
}

interface Counts {
  /** `variant="ghost"` — 명령에 쓴 곳(A1). 모달 바닥은 `ALLOWED_GHOST` */
  ghost?: number;
  /** 쉴 때 단서가 없는 원시 `<button>`(R2) */
  plain?: number;
  /** 링크색 글자로 된 원시 `<button>` — 명령인데 이동처럼 보인다(A3) */
  linkCommand?: number;
  /** hover 때만 링크색이 되는 링크(A4 · R3) */
  hoverLink?: number;
  /** 테두리 칩을 손으로 짠 원시 `<button>` — 상수 · `cn()` 식까지(REQ-WEB-238 을 넓힌 것) */
  chip?: number;
}

/** 모달 바닥처럼 틀이 이미 있는 자리 — ghost 가 어울린다(사람 결정 A1) */
const ALLOWED_GHOST: Record<string, number> = {
  'features/spec-editor/meta-dialog.tsx': 1,
  'features/spec-editor/baseline-controls.tsx': 1,
  // 옮길 자리를 고르는 창의 [닫기](2026-10-04 · REQ-WEB-291) — 문서 정보 창의 바닥과 같은 자리다
  'features/spec-editor/arrange-bar.tsx': 1,
};

function count(file: string): Counts {
  const source = readFileSync(file, 'utf8');
  const local = stringConstants(source);
  const buttons = openingTags(source, 'button').map((t) => expand(t, local));
  const links = ['Link', 'a', 'EntityLink']
    .flatMap((n) => openingTags(source, n))
    .map((t) => expand(t, local));
  const counts: Counts = {
    ghost: (source.match(/variant="ghost"/g) ?? []).length - (ALLOWED_GHOST[rel(file)] ?? 0),
    plain: buttons.filter((t) => !hasRestCue(t)).length,
    linkCommand: buttons.filter((t) => restClasses(t).includes('text-link')).length,
    hoverLink: links.filter(
      (t) => /(?:^|[\s'"`])(?:group-)?hover:text-link\b/.test(t) && !hasRestCue(t),
    ).length,
    chip: buttons.filter((t) => {
      const rest = restClasses(t);
      return (
        rest.includes('border') &&
        rest.some((c) => /^border-border/.test(c)) &&
        rest.some((c) => /^px-/.test(c)) &&
        rest.some((c) => /^text-(2xs|xs)$/.test(c))
      );
    }).length,
  };
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) as Counts;
}

const counted: Record<string, Counts> = Object.fromEntries(
  sources()
    .filter((file) => !file.endsWith('components/ui/primitives.tsx'))
    .map((file): [string, Counts] => [rel(file), count(file)])
    .filter(([, c]) => Object.keys(c).length > 0),
);

/**
 * **장부가 비었다 — 남은 것은 이유가 있는 허용 목록이다**(2026-09-28). 42개 파일 94곳(ghost 18 · 글자뿐인 원시 단추 44 ·
 * 링크색 명령 11 · hover 때만 링크색 13 · 손으로 짠 칩 8)에서 시작해 상 13건(PR 2 → 75) · 중 51건(PR 3 → 45) · 하와 모양
 * 통일(PR 4 → 0)로 줄였다. 아래는 관례라 그대로 두는 자리다 — 검사는 모양만 보고 뜻을 모르므로 이유를 함께 적는다.
 * 새 자리를 더하려면 이유를 적고, 이유를 댈 수 없으면 `Button` · `buttonClass` · `LoadMore` · `Disclosure` ·
 * `Segmented` 로 그린다. 적힌 수와 실제가 다르면 실패한다(줄었으면 목록도 줄인다).
 */
const ALLOWED: Record<string, Counts & { why: string }> = {
  'components/app-shell.tsx': {
    plain: 5,
    why: '헤더와 사이드바의 메뉴 여는 단추(☰ · ✕ · ? · 사용자 이름 ▾ · 조직 ▾)와 연결 끊김 표시 — 기호와 이름이 있는 관례',
  },
  'components/quick-switcher.tsx': { plain: 1, why: '결과 줄의 ☆ 고정 — 별 기호와 이름이 있다' },
  'components/spec-tree.tsx': {
    plain: 1,
    why: '가지의 꺾쇠 — 24px 면 · 이름 · aria-expanded(REQ-WEB-170)',
  },
  'components/toast-stack.tsx': { plain: 1, why: '토스트의 ✕ — 이름이 있는 닫기 관례' },
  'features/session-monitor/session-card.tsx': {
    plain: 1,
    why: '세션 줄의 이름 단추 — 줄 전체가 누르는 면이고 이 단추는 키보드의 길이다',
  },
  'features/spec-editor/attachment-panel.tsx': {
    linkCommand: 1,
    why: '끌어다 놓거나 [파일 고르기] — 문장 안에서 끝나는 인라인 명령이라 밑줄을 긋는 링크 모양(사람 결정 A3)',
  },
  'features/spec-editor/comment-list.tsx': {
    linkCommand: 1,
    why: '코멘트의 앵커 키 — 문서 안의 그 자리로 가는 이동',
  },
  'features/spec-editor/meta-dialog.tsx': {
    plain: 1,
    why: '부모 후보(radio) 줄 — 테두리 상자 안의 고르는 목록',
  },
  'features/spec-editor/spec-link-picker.tsx': {
    plain: 1,
    why: '열린 팝오버의 후보 줄 — 메뉴 항목 관례',
  },
  'features/spec-editor/spec-toc.tsx': {
    plain: 1,
    why: '열린 목차 팝오버의 절 줄 — 메뉴 항목 관례',
  },
  'features/spec-graph/graph.tsx': {
    plain: 2,
    linkCommand: 1,
    why: '패널의 ✕ 와 이웃 문서 줄(목록 관례), 패널 제목은 부모의 onOpen 으로 가는 이동이라 링크색이 맞다',
  },
  'features/spec-graph/table.tsx': {
    plain: 1,
    why: '정렬 머리 — 고른 열은 ▴/▾, 고르지 않은 열은 ↕',
  },
  'features/task-board/board.tsx': {
    plain: 1,
    linkCommand: 2,
    hoverLink: 1,
    why: '레인 머리(접기 캐럿) · 빈 레인의 화면 안 이동 둘(▸) · 카드 제목(카드 전체가 누르는 면 · 사람 결정 A5)',
  },
  'features/task-board/task-sheet.tsx': { plain: 1, why: '시트의 ✕ — 이름이 있는 닫기 관례' },
  'routes/help/$chapter.tsx': { hoverLink: 1, why: '이 페이지 목차 — 목차 관례' },
  'routes/index.tsx': {
    hoverLink: 3,
    why: '프로젝트 줄의 숫자 셋 — 쉴 때 ▸ 로 갈 데가 있음을 보인다(REQ-WEB-274)',
  },
  'routes/p.$proj/reviews.index.tsx': { plain: 1, why: '필터 칸 — ☐/☑ 기호가 확인란으로 읽힌다' },
  'routes/p.$proj/specs.$spec.tsx': {
    plain: 1,
    linkCommand: 1,
    why: '레일 탭(밑줄 탭 줄)과 사전 검토의 앵커(문서 안 이동)',
  },
  'routes/settings/members.tsx': {
    chip: 1,
    why: '역할 칩 — 켬 ✓ · 끔 + · 상속 ↳ 세 상태를 테두리 칩으로 그린다(REQ-WEB-274)',
  },
};

describe('누를 수 있는 것은 쉴 때 누를 수 있어 보인다 (REQ-WEB-271~276)', () => {
  it('허용 목록 밖의 파일에는 없다 — 새 화면은 Button · buttonClass · LoadMore · Disclosure · Segmented 로 그린다', () => {
    expect(Object.keys(counted).filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it('허용 목록은 적힌 수와 같다 — 늘면 실패, 줄였으면 목록도 줄인다', () => {
    const drift = Object.entries(ALLOWED).flatMap(([file, want]) => {
      const got = counted[file] ?? {};
      const keys = new Set(
        [...Object.keys(want), ...Object.keys(got)].filter((k) => k !== 'why'),
      ) as Set<keyof Counts>;
      return [...keys]
        .filter((k) => (want[k] ?? 0) !== (got[k] ?? 0))
        .map((k) => `${file} ${k}: 허용 ${want[k] ?? 0} · 실제 ${got[k] ?? 0}`);
    });
    expect(drift).toEqual([]);
  });

  it('허용한 자리에는 이유가 있다', () => {
    expect(Object.entries(ALLOWED).filter(([, a]) => a.why.trim().length < 10)).toEqual([]);
  });

  it('ghost 를 허용한 자리는 모달 바닥뿐이다', () => {
    for (const [file, n] of Object.entries(ALLOWED_GHOST)) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect((source.match(/variant="ghost"/g) ?? []).length, file).toBe(n);
    }
  });
});

describe('판별 규칙이 무엇을 세는가', () => {
  it('테두리 · 바탕 · 밑줄 · 링크색은 단서다 — hover 에만 있는 것은 단서가 아니다', () => {
    expect(hasRestCue('<button className="text-sm text-text-mute hover:text-text">')).toBe(false);
    expect(hasRestCue('<button className="hover:underline hover:text-link">')).toBe(false);
    expect(hasRestCue('<button className="border border-border-strong px-2">')).toBe(true);
    expect(hasRestCue('<button className="border border-transparent">')).toBe(false);
    expect(hasRestCue('<button className="rounded bg-bg-active">')).toBe(true);
    expect(hasRestCue('<a className="text-link">')).toBe(true);
    expect(hasRestCue('<a className="underline decoration-dotted">')).toBe(true);
    // 고른 칸만 칠한 묶음 — 고르지 않은 칸은 글자뿐이다
    expect(
      hasRestCue("<button className={cn('px-2', on ? 'bg-bg-active' : 'text-text-mute')}>"),
    ).toBe(false);
    expect(
      hasRestCue("<button className={cn('border border-border', on && 'bg-bg-active')}>"),
    ).toBe(true);
  });

  it('상수로 뺀 클래스도 푼다 — 검사를 피하는 길을 막는다', () => {
    const tag = '<button className={CHIP}>';
    expect(hasRestCue(expand(tag, { CHIP: 'border border-border px-2 text-2xs' }))).toBe(true);
    expect(hasRestCue(expand(tag, { CHIP: 'text-text-mute' }))).toBe(false);
  });
});
