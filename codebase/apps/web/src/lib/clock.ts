// 화면의 시계 — **카운트다운은 클라이언트가 센다**(screens.md §1.4 · REQ-WEB-148)
//
// 서버가 준 "남은 초" 는 받은 순간에 이미 낡는다. 그 값을 그대로 그리면 시간이 멈춘 것처럼
// 보이고, 재조회 때마다 튄다. 서버는 **만료 시각**을 주고 여기서 매초 다시 그린다 —
// 시계가 어긋나도 방향은 맞고, 만료는 서버가 판정한다(화면은 그것을 말할 뿐이다).

import { useEffect, useState } from 'react';

/** 지금 — 기본 1초마다 갱신한다. 보이지 않는 화면에서는 브라우저가 알아서 늦춘다. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 만료 시각까지 남은 초 — 지난 값은 0 이다. 못 읽는 값은 null(모른다)이다. */
export function secondsUntil(iso: unknown, now: number): number | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((at - now) / 1000));
}
