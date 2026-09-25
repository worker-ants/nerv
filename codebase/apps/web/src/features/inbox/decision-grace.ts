// 보내기 전 5초 — 결정을 무를 길(2026-09-25 · 사람 결정 D7 · UI/UX 검토 HUB-11 · SYS-03 · REQ-WEB-237)
//
// 명세는 처리됨 트레일에 **되돌리기 링크**를 약속했지만 서버에 결정 철회 경로가 없어 한 번도 링크가
// 된 적이 없다. 철회 API 는 감사·게이트의 뜻이 무거워(승인이 문서를 이미 움직였고 알림이 이미 갔다)
// 따로 정하기로 하고, 무를 길은 **보내기 전에** 준다 — 누른 결정을 카드에 5초 들고 있다가 보낸다.
// 그 사이 [취소]·`z` 를 누르면 아무것도 나가지 않는다. 서버는 바뀌지 않는다.
//
// 놓치지 않는다: 들고 있는 동안 카드가 사라지면(다른 화면으로 옮김) **곧장 보낸다** — 누른 사람은
// 보내라고 했고, 무르는 것은 누름이어야 한다. 창을 닫으려 하면 브라우저가 묻는다.

import { useCallback, useEffect, useRef, useState } from 'react';

/** 들고 있는 시간 — 사람 결정 D7(2026-09-25) */
export const DECISION_GRACE_MS = 5_000;

let graceMs: number = DECISION_GRACE_MS;

/**
 * 테스트가 유예를 끈다(0 이면 누르는 즉시 보낸다). 결정의 **내용**을 보는 검사가 5초를 기다리지
 * 않게 하려는 것이고, 유예 자체는 `decision-grace.spec.tsx` 가 실제 5초로 센다.
 */
export function setDecisionGraceForTesting(ms: number = DECISION_GRACE_MS): void {
  graceMs = ms;
}

export interface Grace<T> {
  /** 들고 있는 것 — 없으면 null */
  pending: T | null;
  /** 들기 시작한다. 이미 들고 있으면 무시한다(두 번 누름이 둘을 보내지 않게) */
  hold: (value: T) => void;
  /** 무른다 — 아무것도 나가지 않는다 */
  cancel: () => void;
}

export function useGrace<T>(send: (value: T) => void): Grace<T> {
  const [pending, setPending] = useState<T | null>(null);
  // 타이머와 언마운트 정리가 읽는 쪽 — 상태는 그리기용이다
  const held = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const stop = useCallback((): { value: T } | null => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const was = held.current;
    held.current = null;
    return was;
  }, []);

  const hold = useCallback(
    (value: T) => {
      if (held.current !== null) return;
      if (graceMs <= 0) {
        sendRef.current(value);
        return;
      }
      held.current = { value };
      setPending(value);
      timer.current = setTimeout(() => {
        const was = stop();
        setPending(null);
        if (was !== null) sendRef.current(was.value);
      }, graceMs);
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setPending(null);
  }, [stop]);

  // 카드가 사라지면 들고 있던 것을 곧장 보낸다 — 누른 결정을 조용히 버리지 않는다
  useEffect(
    () => () => {
      const was = stop();
      if (was !== null) sendRef.current(was.value);
    },
    [stop],
  );

  // 창을 닫거나 새로 고치면 들고 있던 것은 나가지 못한다 — 브라우저가 한 번 묻게 한다
  useEffect(() => {
    if (pending === null) return;
    const ask = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // 옛 브라우저는 returnValue 가 있어야 묻는다
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [pending]);

  return { pending, hold, cancel };
}
