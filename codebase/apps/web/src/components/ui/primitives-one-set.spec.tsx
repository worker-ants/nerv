// 프리미티브 한 벌 — 줄 안의 작은 단추 · 요약 줄 · 임의 px
// (2026-09-26 · UI/UX 검토 SYS-08 · SYS-13 · REQ-WEB-045 · REQ-WEB-238)
//
// 검토가 짚은 세 가지가 같은 부류다 — **공용 부품이 있는데 화면이 손으로 다시 짰다.**
// ① 스무 자리가 테두리 칩 단추(`border border-border px-2 py-0.5 text-2xs …`)를 원시 `<button>` 으로 베껴 써서, 그
//    단추들에는 잠긴 까닭(REQ-WEB-003)도 오프라인 잠금(REQ-WEB-235)도 없었다 — 발견의 [처분]·[Task 로 올리기]는 권한이
//    없을 때 `title` 로만 까닭을 달아 키보드·화면 낭독기에 닿지 않았다.
// ② 세션 모니터는 요약 줄을 따로 짜서 좁은 폭의 넘침을 자기만 가로 스크롤로 풀었다.
// ③ 화면마다 `h-[27px]` · `gap-[7px]` 을 손으로 적었다(REQ-WEB-045 "화면별 임의 값 금지") — 21개 파일 109곳.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, GlyphChip, SummaryStrip } from './primitives.js';
import { cn } from '../../lib/utils.js';

afterEach(cleanup);

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** `apps/web/src` 의 소스 파일 전부(검사 파일은 뺀다) — `src` 기준 경로 */
function sources(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [p] : [];
  });
}
const rel = (file: string): string => file.slice(SRC.length + 1);

/** `<button` 의 여는 태그 — 중괄호·따옴표 안의 `>` 는 태그의 끝이 아니다 */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  let from = source.indexOf('<button');
  while (from !== -1) {
    let depth = 0;
    let quote: string | null = null;
    let i = from + '<button'.length;
    for (; i < source.length; i++) {
      const ch = source[i]!;
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(from, i + 1));
    from = source.indexOf('<button', i);
  }
  return tags;
}

describe('줄 안의 작은 단추는 Button 이다', () => {
  it('xs · subtle — 테두리 칩의 모양을 한 곳이 정하고, 잠긴 까닭도 함께 온다', () => {
    const onClick = vi.fn();
    render(
      <Button
        size="xs"
        variant="subtle"
        disabled
        disabledReason="처분 권한이 없습니다"
        onClick={onClick}
      >
        기각
      </Button>,
    );
    const button = screen.getByRole('button', { name: '기각' });
    expect(button.className).toContain('text-2xs');
    expect(button.className).toContain('border-border');
    // 칩의 모서리·굵기가 기본 단추의 것을 덮는다 — 둘 다 남아 CSS 순서가 정하게 두지 않는다
    expect(button.className).toContain('rounded-nerv-sm');
    expect(button.className).not.toMatch(/\brounded-nerv\b(?!-)/);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('data-reason')).toBe('처분 권한이 없습니다');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('테두리 칩을 손으로 짠 원시 <button> 이 없다 — 모양은 primitives.tsx 에만 있다', () => {
    // 칩의 표지: 테두리 · 가장 작은 글자 · 가로 여백. 여백 없는 동그란 아이콘 단추(그래프의 [?])는 칩이 아니다
    const chip = (tag: string): boolean =>
      /border border-border/.test(tag) && /\btext-2xs\b/.test(tag) && /\bpx-/.test(tag);
    const offenders = sources()
      .filter((file) => !file.endsWith('primitives.tsx'))
      .filter((file) => openingTags(readFileSync(file, 'utf8')).some(chip))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('머리글자 칸은 한 부품이다 (임의 px 장부 PR 2)', () => {
  it('18px 칸 · 10px 글자 · 모양 둘 — 보조기기에는 숨는다(곁의 글자가 이미 말한다)', () => {
    render(
      <>
        <GlyphChip>↑</GlyphChip>
        <GlyphChip shape="round" className="bg-status-danger-soft">
          !
        </GlyphChip>
      </>,
    );
    const [square, round] = [...document.querySelectorAll('span[aria-hidden="true"]')];
    expect(square?.className).toContain('size-4.5');
    expect(square?.className).toContain('text-3xs');
    expect(square?.className).toContain('rounded-nerv-sm');
    expect(round?.className).toContain('rounded-full');
    expect(round?.className).not.toContain('rounded-nerv-sm');
    // 색은 부르는 쪽이 고른다
    expect(round?.className).toContain('bg-status-danger-soft');
  });

  it('18px 머리글자 칸을 손으로 짠 곳이 없다 — 그래프 패널 · 관계 레일 · 타임라인이 세 벌이었다', () => {
    const glyph =
      /size-(?:\[18px\]|4\.5)[^"'`]*text-(?:\[10px\]|3xs)|text-(?:\[10px\]|3xs)[^"'`]*size-(?:\[18px\]|4\.5)/;
    const offenders = sources()
      .filter((file) => !file.endsWith('primitives.tsx'))
      .filter((file) => glyph.test(readFileSync(file, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('충돌 해소가 우리 토큰의 이름을 안다', () => {
  it('뒤에 온 반경·높이·글자 크기가 앞의 것을 덮는다', () => {
    expect(cn('rounded-nerv', 'rounded-nerv-sm')).toBe('rounded-nerv-sm');
    expect(cn('h-control-sm', 'h-auto')).toBe('h-auto');
    expect(cn('text-sm', 'text-3xs')).toBe('text-3xs');
    // 색은 크기가 아니다 — 글자 크기와 글자 색은 함께 남는다
    expect(cn('text-metric', 'text-text-mute')).toBe('text-metric text-text-mute');
  });
});

describe('요약 줄은 한 벌이다', () => {
  it('거르는 칸 — 켠 칸은 aria-pressed, 셀 것이 없는 칸은 잠기고, 점이 색을 나른다', () => {
    const onToggle = vi.fn();
    render(
      <SummaryStrip
        layout="inline"
        metrics={[
          {
            label: '활성',
            value: 2,
            testId: 'cell-active',
            dot: 'bg-status-progress',
            toggle: { pressed: true, onToggle },
          },
          {
            label: '오류',
            value: 0,
            testId: 'cell-error',
            dot: 'bg-status-danger',
            toggle: { pressed: false, onToggle, disabled: true },
            dimmed: true,
          },
        ]}
      />,
    );
    const active = screen.getByTestId('cell-active');
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.querySelector('[aria-hidden="true"]')?.className).toContain('bg-status-progress');
    fireEvent.click(active);
    expect(onToggle).toHaveBeenCalledTimes(1);
    const error = screen.getByTestId('cell-error');
    expect((error as HTMLButtonElement).disabled).toBe(true);
    expect(error.className).toContain('opacity-45');
  });

  it('요약 줄의 모양(border-y 의 한 줄)을 SummaryStrip 밖에서 짜지 않는다', () => {
    const offenders = sources()
      .filter((file) => !file.endsWith('primitives.tsx'))
      .filter((file) => /border-y border-border py-/.test(readFileSync(file, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

/**
 * **임의 px 장부**(REQ-WEB-045). 장부 밖의 파일에는 `[Npx]` 가 없어야 하고, 장부의 파일은 적힌 수와 **같아야**
 * 한다 — 줄였으면 장부도 줄인다(늘어난 수는 실패다). 2026-09-26 에 셸 · 홈 · 프리미티브 · 사이드바 줄 · 세션 요약 줄을
 * 토큰(`h-control-sm` · `h-nav-row` · `text-3xs` · `text-metric` · `rounded-nerv*`)과 척도로 접어 109곳이 51곳이 됐고,
 * 같은 날 간격 · 반경 · 글자 · 흐림 31곳을 척도로 접어 20곳이 됐다(장부 아티팩트의 PR 1 — 한 곳에 1~2px 이하가 움직였다).
 * 이어서 머리글자 칸 세 벌(A · 9곳)을 한 부품(`GlyphChip`)으로 모아 11곳이 됐다(PR 2).
 * 남은 것은 부류마다 한 PR 이다 — 상태 배지 모양(B) · 레이아웃 폭(C).
 */
const LEDGER: Record<string, number> = {
  // B — 배지의 모양은 `status-one-set.spec.tsx` 가 베낀 알약을 찾는 표지다 — 함께 옮긴다
  'components/status-badge.tsx': 4,
  // C — 최소 높이 · 안내 폭 · 옆 패널 폭
  'features/spec-graph/graph.tsx': 3,
  // C — 레인 폭
  'features/task-board/board.tsx': 1,
  // C — 장 안 목차 폭
  'routes/help/$chapter.tsx': 1,
  // C — 리뷰 레일 폭
  'routes/p.$proj/reviews.index.tsx': 1,
  // C — 세션 상세 레일 폭
  'routes/p.$proj/sessions.index.tsx': 1,
};

describe('임의 px 은 줄기만 한다 (REQ-WEB-045)', () => {
  const counted = Object.fromEntries(
    sources()
      .map((file): [string, number] => [
        rel(file),
        (readFileSync(file, 'utf8').match(/\[-?\d+(?:\.\d+)?px\]/g) ?? []).length,
      ])
      .filter(([, n]) => n > 0),
  );

  it('장부 밖의 파일에는 임의 px 이 없다 — 새로 쓰는 화면은 토큰과 척도로 쓴다', () => {
    expect(Object.keys(counted).filter((file) => !(file in LEDGER))).toEqual([]);
  });

  it('장부의 파일은 적힌 수와 같다 — 늘면 실패, 줄였으면 장부를 줄인다', () => {
    const drift = Object.entries(LEDGER)
      .filter(([file, n]) => (counted[file] ?? 0) !== n)
      .map(([file, n]) => `${file}: 장부 ${n} · 실제 ${counted[file] ?? 0}`);
    expect(drift).toEqual([]);
  });

  it('접은 파일은 장부에 없다 — 셸 · 홈 · 프리미티브 · 사이드바 줄 · 세션 요약 줄 · 피드 · 트리 · 창 뒤판', () => {
    for (const file of [
      'components/app-shell.tsx',
      'routes/index.tsx',
      'components/ui/primitives.tsx',
      'components/nav-styles.ts',
      'features/session-monitor/session-board.tsx',
      'features/session-monitor/activity-rail.tsx',
      'components/event-feed.tsx',
      'components/spec-tree.tsx',
      'components/relation-tabs.tsx',
      'components/quick-switcher.tsx',
      'components/ui/modal.tsx',
      'routes/inbox.tsx',
      'features/session-monitor/activity-timeline.tsx',
      'routes/p.$proj/specs.$spec.tsx',
    ]) {
      expect(LEDGER[file]).toBeUndefined();
      expect(counted[file]).toBeUndefined();
    }
  });
});
