// 버전 diff 뷰 — screens.md §2.4 · ui-wireframes §4.3 (REQ-WEB-121·122)
//
// 서버는 2026-08-22 부터 이 데이터를 줄 수 있었고, 화면은 2026-09-01 에 붙었다.
// 그 사이 버전 레일은 **누를 수 없는 글자**였다.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { VersionDiff, render as fold } from './version-diff.js';

afterEach(cleanup);

const VERSIONS = [
  { id: 'v3', version_no: 3 },
  { id: 'v2', version_no: 2 },
  { id: 'v1', version_no: 1 },
];

const DIFF = {
  from: { version_no: 2, status: 'approved' },
  to: { version_no: 3, status: 'draft' },
  requirements: [
    { ref: 'REQ-SUD-001', statement_md: '바뀐 문장', delta: 'modified' },
    { ref: 'REQ-SUD-002', statement_md: '새 약속', delta: 'added' },
    { ref: 'REQ-SUD-003', statement_md: '그대로', delta: 'unchanged' },
  ],
  body_diff: [
    { op: 'same', text: '# 제목' },
    { op: 'del', text: '옛 문단' },
    { op: 'add', text: '새 문단' },
    { op: 'same', text: '꼬리' },
  ],
};

function draw(props: Partial<React.ComponentProps<typeof VersionDiff>> = {}): void {
  render(
    <LocaleProvider locale="ko">
      <VersionDiff
        diff={DIFF}
        isPending={false}
        isError={false}
        versions={VERSIONS}
        from={2}
        to={3}
        onChange={() => undefined}
        full={false}
        onToggleFull={() => undefined}
        {...props}
      />
    </LocaleProvider>,
  );
}

describe('요구사항 델타가 먼저다', () => {
  it('약속이 어떻게 변했는지를 먼저 센다 — 리뷰가 묻는 것이 그것이다', () => {
    draw();
    const panel = screen.getByTestId('diff-requirements');
    expect(panel.textContent).toContain('추가 1');
    expect(panel.textContent).toContain('변경 1');
    expect(panel.textContent).toContain('삭제 0');
  });

  it('바뀐 것만 줄로 세운다 — unchanged 는 목록을 채우지 않는다', () => {
    draw();
    const panel = screen.getByTestId('diff-requirements');
    expect(panel.textContent).toContain('REQ-SUD-001');
    expect(panel.textContent).toContain('REQ-SUD-002');
    expect(panel.textContent).not.toContain('REQ-SUD-003');
  });
});

describe('본문 diff', () => {
  it('op 로 갈라 그린다 — 색만으로 나르지 않고 부호도 붙인다', () => {
    draw();
    const body = screen.getByTestId('diff-body');
    expect(
      within(body)
        .getByText(/옛 문단/)
        .getAttribute('data-op'),
    ).toBe('del');
    expect(
      within(body)
        .getByText(/새 문단/)
        .getAttribute('data-op'),
    ).toBe('add');
  });

  it('양 끝을 바꾸면 그 사실이 위로 올라간다 — 주소가 진실이다', () => {
    const onChange = vi.fn();
    draw({ onChange });
    fireEvent.change(screen.getByTestId('diff-기준'), { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith(1, 3);
  });
});

describe('접기 — 1,000줄을 처음부터 읽게 만들지 않는다', () => {
  const long = [
    ...Array.from({ length: 20 }, (_, i) => ({ op: 'same', text: `줄 ${String(i)}` })),
    { op: 'add', text: '여기가 바뀌었다' },
    ...Array.from({ length: 20 }, (_, i) => ({ op: 'same', text: `뒤 ${String(i)}` })),
  ];

  it('변경 앞뒤 3줄만 남기고 접는다', () => {
    const out = fold(long, false);
    const lines = out.filter((e) => e.kind === 'line');
    // 변경 1줄 + 앞뒤 3줄씩 = 7
    expect(lines).toHaveLength(7);
  });

  it('접은 자리는 몇 줄인지 말한다 — 빈칸으로 두면 "잘렸다"를 알 수 없다', () => {
    const gaps = fold(long, false).filter((e) => e.kind === 'gap');
    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.kind === 'gap' && g.n === 17)).toBe(true);
  });

  it('전체 보기는 한 줄도 접지 않는다', () => {
    expect(fold(long, true)).toHaveLength(long.length);
  });
});
