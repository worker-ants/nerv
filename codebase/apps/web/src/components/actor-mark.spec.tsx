// 행위자 표기 한 벌 (2026-09-28 · 사람 결정 · REQ-WEB-010 · REQ-WEB-277)
//
// 사람은 머리글자 원, 에이전트는 같은 크기의 "AI" 칸이다. 에이전트 칸은 읽는 도구에 뜻("에이전트")과 기계를 읽히고,
// 화면 코드에는 🤖/👤 이모지가 다시 들어오지 않는다 — 다섯 모양이 섞여 있던 자리를 한 벌로 모았다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { ActorMark } from './actor-mark.js';

afterEach(cleanup);

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('ActorMark (REQ-WEB-277)', () => {
  it('에이전트는 AI 칸이고, 읽는 도구와 툴팁에 뜻 · 이름 · 기계 · 맡긴 사람이 실린다', () => {
    render(
      <LocaleProvider locale="ko">
        <ActorMark
          name="코덱스"
          agent
          machine="mac-02 · claude-code"
          delegator="도현"
          testId="mark"
        />
      </LocaleProvider>,
    );
    const mark = screen.getByTestId('mark');
    expect(mark.getAttribute('title')).toBe('에이전트 · 코덱스 · mac-02 · claude-code · 도현 위임');
    // 보이는 글자는 AI 두 글자뿐이고, 읽는 도구는 뜻을 읽는다
    expect(mark.querySelector('[aria-hidden="true"]')?.textContent).toBe('AI');
    expect(mark.querySelector('.sr-only')?.textContent).toContain('에이전트');
    expect(mark.querySelector('[aria-hidden="true"]')?.className).toContain('bg-status-agent-soft');
  });

  it('사람은 머리글자 원이다 — 사람마다 색이 달라 누구인지도 보인다', () => {
    render(
      <LocaleProvider locale="ko">
        <ActorMark name="서연" agent={false} />
      </LocaleProvider>,
    );
    const face = document.querySelector('span[aria-hidden="true"]');
    expect(face?.textContent).toBe('서');
    expect(face?.className).toContain('rounded-full');
    expect(screen.queryByTestId('actor-agent')).toBeNull();
  });

  it('이름이 없으면(시스템) 자리만 둔다', () => {
    render(
      <LocaleProvider locale="ko">
        <ActorMark name={null} agent={false} />
      </LocaleProvider>,
    );
    expect(document.querySelector('span[aria-hidden="true"]')?.textContent).toBe('·');
  });

  it('화면 코드에 🤖/👤 이모지가 없다 — 주석 속 옛 이야기만 남는다', () => {
    const offenders = sources().flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => /🤖|👤/.test(line) && !/^\s*(\/\/|\*|\{\/\*)/.test(line))
        .map(([, n]) => `${file.slice(SRC.length + 1)}:${n}`),
    );
    expect(offenders).toEqual([]);
  });
});
