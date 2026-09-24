// 멱등 키 — **누름 하나에 키 하나**(REQ-WEB-195 · api.md §1.5)
//
// 서버는 같은 주체·같은 키·같은 본문이면 24시간 동안 **첫 응답을 재생**한다. 그것이 지켜
// 주는 것은 "같은 누름의 재전송이 두 번 실행되지 않는다" 이지 "이 작업은 한 번만 잡힌다" 가
// 아니다. 2026-09-24 까지 웹은 키를 **대상에서** 만들었다 — `claim-<작업 id>`,
// `steer-<세션>-<종류>-<지시 앞 16자>`. 그래서 작업을 잡았다 놓고 하루 안에 다시 [클레임] 을
// 누르면 새 클레임은 생기지 않는데 재생된 첫 응답이 "잡았습니다" 토스트를 띄웠고, 같은
// 지시("계속 진행해")를 다시 보내면 "보냈습니다" 만 뜨고 에이전트에게는 가지 않았다.
// 사람의 개입이 성공한 것처럼 보이면서 사라지는 — 이 제품에서 가장 비싼 거짓 피드백이다.
//
// 그래서 키는 **누름에서** 만든다. 같은 누름이 아직 도는 동안의 거듭 누름(단추가 잠기기 전의
// 더블클릭)만 같은 키를 받고 — 서버가 그것을 `idempotency_in_flight` 로 막는다 — 요청이
// 끝나면 키를 버린다. 다음 누름은 새 누름이다.

import { NERV_ERROR } from '@nerv/schema';
import { useCallback, useMemo, useRef } from 'react';
import { NervApiError } from './api.js';

export interface PressKey {
  /** 지금 누름의 키 — 없으면 만든다. `mutationFn` 안에서 부른다 */
  take: () => string;
  /** 누름이 끝났다 — 성공이든 실패든 `onSettled` 에서 부른다 */
  release: () => void;
}

/** 키 하나를 새로 만든다. 접두는 서버 로그에서 무슨 조작인지 읽히게 하려는 것이다 */
export function freshKey(action: string): string {
  return `${action}-${crypto.randomUUID()}`;
}

export function usePressKey(action: string): PressKey {
  const current = useRef<string | null>(null);
  const take = useCallback(() => {
    current.current ??= freshKey(action);
    return current.current;
  }, [action]);
  const release = useCallback(() => {
    current.current = null;
  }, []);
  return useMemo(() => ({ take, release }), [take, release]);
}

/**
 * 같은 누름의 거듭 요청이 서버에 막혔는가 — **실패가 아니다.**
 *
 * 첫 요청이 아직 돌고 있을 뿐이고 그 결과는 첫 요청이 말한다. 이것까지 오류로 띄우면
 * 더블클릭 한 번에 "처리 중입니다" 경고와 성공 토스트가 나란히 뜬다.
 */
export function isRepeatedPress(error: unknown): boolean {
  return (
    error instanceof NervApiError &&
    error.code === NERV_ERROR.PRECONDITION &&
    error.body.details['kind'] === 'idempotency_in_flight'
  );
}
