// 가로로 넘친 레인 알리기 — 양 끝 흐림과 이동 단추 (REQ-WEB-340 · screens.md §2.5)
//
// 백로그를 켜면 레인이 일곱 칸이고 한 칸이 268px 이라, 1440px 화면에서도 네다섯 칸만 보인다. 가로 스크롤바는
// 레인 묶음의 맨 아래에 있어 화면 밖이기 쉽고 macOS 는 평소에 스크롤바를 숨긴다. 그래서 오른쪽에 「검토 중」 ·
// 「완료」가 있는 줄 모르는 사람이 있었다(2026-10-23 사람 보고).
//
// **단추는 레인 위에 올리지 않는다**(2026-10-23 사람 결정). 시안에서 레인 위에 띄운 단추가 끝에 걸친 레인의
// 이름을 가렸다. 단추는 페이지 좌우 여백(`PageBody` 의 `px-6`)에 두고, 페이지를 내리면 레인 영역 상단에
// 고정한다. 단추에는 화살표만 두고 가려진 레인 이름은 마우스를 올리거나 포커스했을 때 보인다.

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { Button } from '../../components/ui/primitives.js';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';

/** 레인 하나의 가로 위치 — 스크롤 상자 안쪽 기준(`offsetLeft`) */
export interface LaneBox {
  key: string;
  left: number;
  width: number;
}

/** 스크롤 상자의 가로 치수 */
export interface LaneViewport {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export type LaneSide = 'before' | 'after';

export interface LaneOverflow {
  /** 왼쪽에 가려진 레인 — 보드 순서대로 */
  before: string[];
  /** 오른쪽에 가려진 레인 — 보드 순서대로 */
  after: string[];
}

/** 가장자리 흐림의 폭(px) — 이 폭 안에 걸친 레인은 가려진 것으로 센다 */
export const LANE_FADE_PX = 40;
/** 소수점 스크롤 값 때문에 끝에 있는데도 1px 남은 것으로 세지 않게 한다 */
const SLACK_PX = 2;

const NONE: LaneOverflow = { before: [], after: [] };

/** 양쪽에 더 있는가, 그리고 어느 레인이 가려졌는가 */
export function laneOverflow(view: LaneViewport, lanes: readonly LaneBox[]): LaneOverflow {
  const max = view.scrollWidth - view.clientWidth;
  const moreBefore = view.scrollLeft > SLACK_PX;
  const moreAfter = view.scrollLeft < max - SLACK_PX;
  const start = view.scrollLeft + (moreBefore ? LANE_FADE_PX : 0);
  const end = view.scrollLeft + view.clientWidth - (moreAfter ? LANE_FADE_PX : 0);
  return {
    before: moreBefore ? lanes.filter((l) => l.left < start - SLACK_PX).map((l) => l.key) : [],
    after: moreAfter
      ? lanes.filter((l) => l.left + l.width > end + SLACK_PX).map((l) => l.key)
      : [],
  };
}

/**
 * 단추 한 번에 레인 하나(2026-10-23 사람 결정). 가려진 레인 가운데 가장 가까운 것이 흐림 밖으로 온전히 들어오는
 * 자리를 돌려준다. 맨 끝 레인이면 끝까지 민다 — 끝에는 흐림이 없으므로 여백을 남길 까닭이 없다.
 */
export function laneScrollTarget(
  side: LaneSide,
  view: LaneViewport,
  lanes: readonly LaneBox[],
): number | null {
  const hidden = laneOverflow(view, lanes);
  const max = Math.max(0, view.scrollWidth - view.clientWidth);
  if (side === 'after') {
    const lane = lanes.find((l) => l.key === hidden.after[0]);
    if (lane === undefined) return null;
    if (lane === lanes.at(-1)) return max;
    return Math.min(max, lane.left + lane.width - view.clientWidth + LANE_FADE_PX);
  }
  const lane = lanes.find((l) => l.key === hidden.before.at(-1));
  if (lane === undefined) return null;
  if (lane === lanes[0]) return 0;
  return Math.max(0, lane.left - LANE_FADE_PX);
}

/**
 * 흐림은 `mask-image` 로 칠한다 — 덮개를 얹으면 페이지 바탕색을 따라 칠해야 하고, 막힘 레인처럼 바탕이 있는
 * 레인 위에서 색이 어긋난다. 더 있는 쪽만 흐리게 한다. 마스크는 색이 아니라 불투명도만 읽으므로 `black` 은 "보인다" 는 뜻이다.
 */
export function laneFadeMask(hidden: LaneOverflow): string | undefined {
  const before = hidden.before.length > 0;
  const after = hidden.after.length > 0;
  if (!before && !after) return undefined;
  const fade = `${LANE_FADE_PX}px`;
  return [
    'linear-gradient(to right',
    before ? `transparent, black ${fade}` : 'black',
    after ? `black calc(100% - ${fade}), transparent)` : 'black)',
  ].join(', ');
}

/** 스크롤 상자의 바로 아래 레인들 — 레인마다 `data-lane` 을 둔다 */
function measure(el: HTMLElement): { view: LaneViewport; lanes: LaneBox[] } {
  const lanes = Array.from(el.children)
    .filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset['lane'] !== undefined)
    .map((c) => ({ key: c.dataset['lane'] ?? '', left: c.offsetLeft, width: c.offsetWidth }));
  return {
    view: { scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth },
    lanes,
  };
}

const same = (a: LaneOverflow, b: LaneOverflow): boolean =>
  a.before.join() === b.before.join() && a.after.join() === b.after.join();

/**
 * 스크롤 · 창 크기 · 레인 수가 바뀔 때마다 가려진 레인을 다시 센다. 스크롤마다 다시 그리지 않도록 결과가 바뀔
 * 때만 상태를 바꾼다. `layoutKey` 는 레인 구성(백로그 · 보관함을 켜고 끔)이 바뀌었다는 신호다.
 */
export function useLaneOverflow(
  ref: RefObject<HTMLElement | null>,
  layoutKey: string,
): { hidden: LaneOverflow; scrollTo: (side: LaneSide) => void } {
  const [hidden, setHidden] = useState<LaneOverflow>(NONE);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const { view, lanes } = measure(el);
      const next = laneOverflow(view, lanes);
      setHidden((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ref, layoutKey]);

  const scrollTo = (side: LaneSide): void => {
    const el = ref.current;
    if (el === null) return;
    const { view, lanes } = measure(el);
    const left = laneScrollTarget(side, view, lanes);
    if (left === null) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    el.scrollTo?.({ left, behavior: reduce ? 'auto' : 'smooth' });
  };
  return { hidden, scrollTo };
}

/**
 * 페이지 여백 한 칸과 그 안의 이동 단추. 여백은 늘 자리를 차지하고(레인 폭이 흔들리지 않게), 단추는 그쪽에
 * 가려진 레인이 있을 때만 보인다. 휴대폰 폭에서는 손가락으로 밀어 넘기므로 단추를 숨기고 흐림만 남긴다.
 */
export function LaneNavGutter({
  side,
  hidden,
  labelOf,
  onMove,
}: {
  side: LaneSide;
  /** 이쪽에 가려진 레인의 키 — 보드 순서대로 */
  hidden: readonly string[];
  labelOf: (lane: string) => string;
  onMove: () => void;
}): React.JSX.Element {
  const t = useT();
  const names = hidden.map(labelOf);
  return (
    <div className="flex w-6 shrink-0 justify-center">
      {names.length > 0 && (
        <div className="group sticky top-anchor z-20 self-start max-sm:hidden">
          <Button
            size="sm"
            data-testid={`lane-nav-${side}`}
            aria-label={t(side === 'before' ? 'tasks.lane_nav.before' : 'tasks.lane_nav.after', {
              lanes: names.join(', '),
            })}
            className="w-5.5 px-0 text-text-mute hover:text-text"
            onClick={onMove}
          >
            <span aria-hidden="true">{side === 'before' ? '‹' : '›'}</span>
          </Button>
          {/* 가려진 레인 이름 — 이름은 `aria-label` 이 이미 읽으므로 보조기기에는 숨긴다 */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-0.5 hidden w-max max-w-64 rounded-nerv-sm bg-text px-2 py-1 text-xs text-bg group-focus-within:block group-hover:block',
              side === 'before' ? 'left-full ml-1.5' : 'right-full mr-1.5',
            )}
          >
            {names.join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}
