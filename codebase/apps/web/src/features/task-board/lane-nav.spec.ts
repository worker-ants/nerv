// 가로로 넘친 레인 알리기 (REQ-WEB-340 · screens.md §2.5)
//
// 레인 일곱 칸이 화면 폭을 넘어도 그 사실을 알 단서가 없었다. 어느 레인이 가려졌는지, 단추가 어디까지 미는지를
// 치수만으로 본다 — 실제 배치는 jsdom 이 계산하지 않으므로 보드 연결은 `routes/task-board-lanes.spec.tsx` 가 본다.

import { describe, expect, it } from 'vitest';
import { LANE_FADE_PX, laneFadeMask, laneOverflow, laneScrollTarget } from './lane-nav.js';
import type { LaneBox, LaneViewport } from './lane-nav.js';

/** 보드와 같은 모양 — 268px 레인 일곱 칸, 간격 20px */
const KEYS = ['backlog', 'blocked', 'ready', 'claimed', 'in_progress', 'in_review', 'done'];
const LANES: LaneBox[] = KEYS.map((key, i) => ({ key, left: i * 288, width: 268 }));
const WIDTH = 6 * 288 + 268;

const view = (scrollLeft: number, clientWidth = 1000): LaneViewport => ({
  scrollLeft,
  clientWidth,
  scrollWidth: WIDTH,
});

describe('가려진 레인 세기', () => {
  it('맨 앞에서는 오른쪽만 가려져 있다 — 흐림에 걸친 레인도 가려진 것으로 센다', () => {
    // 오른쪽 끝 40px 은 흐림이다: 맡음(864~1132)은 반쯤 보이지만 가려진 쪽이다
    expect(laneOverflow(view(0), LANES)).toEqual({
      before: [],
      after: ['claimed', 'in_progress', 'in_review', 'done'],
    });
  });

  it('맨 끝에서는 왼쪽만 가려져 있다', () => {
    expect(laneOverflow(view(WIDTH - 1000), LANES)).toEqual({
      before: ['backlog', 'blocked', 'ready', 'claimed'],
      after: [],
    });
  });

  it('레인이 다 들어가면 아무것도 가려지지 않는다 — 단추도 흐림도 없다', () => {
    const wide = view(0, WIDTH);
    expect(laneOverflow(wide, LANES)).toEqual({ before: [], after: [] });
    expect(laneFadeMask(laneOverflow(wide, LANES))).toBeUndefined();
  });

  it('소수점 스크롤로 끝에서 1px 모자란 것은 끝으로 본다', () => {
    expect(laneOverflow(view(WIDTH - 1000 - 0.5), LANES).after).toEqual([]);
  });
});

describe('단추 한 번에 레인 하나', () => {
  it('오른쪽 단추는 가장 가까운 가려진 레인이 흐림 밖으로 온전히 들어오게 민다', () => {
    const target = laneScrollTarget('after', view(0), LANES);
    // 맡음의 오른쪽 끝(1132)이 화면 오른쪽 끝에서 흐림 폭만큼 안쪽에 온다
    expect(target).toBe(864 + 268 - 1000 + LANE_FADE_PX);
    const after = laneOverflow(view(target ?? 0), LANES);
    expect(after.after[0]).toBe('in_progress');
    expect(after.after).not.toContain('claimed');
  });

  it('왼쪽 단추는 가장 가까운 가려진 레인을 흐림 밖 왼쪽 끝에 놓는다', () => {
    const end = WIDTH - 1000;
    const target = laneScrollTarget('before', view(end), LANES);
    expect(target).toBe(864 - LANE_FADE_PX);
    expect(laneOverflow(view(target ?? 0), LANES).before.at(-1)).toBe('ready');
  });

  it('맨 끝 레인이면 끝까지 민다 — 끝에는 흐림이 없다', () => {
    expect(laneScrollTarget('after', view(WIDTH - 1000 - 100), LANES)).toBe(WIDTH - 1000);
    expect(laneScrollTarget('before', view(100), LANES)).toBe(0);
  });

  it('가려진 레인이 없으면 움직이지 않는다', () => {
    expect(laneScrollTarget('after', view(WIDTH - 1000), LANES)).toBeNull();
    expect(laneScrollTarget('before', view(0), LANES)).toBeNull();
  });
});

describe('흐림', () => {
  it('더 있는 쪽만 흐리게 한다', () => {
    expect(laneFadeMask({ before: [], after: ['done'] })).toBe(
      'linear-gradient(to right, black, black calc(100% - 40px), transparent)',
    );
    expect(laneFadeMask({ before: ['backlog'], after: [] })).toBe(
      'linear-gradient(to right, transparent, black 40px, black)',
    );
    expect(laneFadeMask({ before: ['backlog'], after: ['done'] })).toBe(
      'linear-gradient(to right, transparent, black 40px, black calc(100% - 40px), transparent)',
    );
  });
});
