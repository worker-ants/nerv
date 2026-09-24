// 실패한 쓰기의 기본 처리기 (REQ-WEB-196 · screens.md §1.5)
//
// `onError` 를 적지 않은 쓰기는 2026-09-24 까지 **실패해도 아무 말이 없었다** — 코멘트 달기·
// 해결, 첨부 삭제, 알림 읽음, 토큰 폐기. 이제 기본 처리기가 말하고, 자기 처리기가 있거나
// 제자리에 그리는 쓰기에는 나서지 않는다(같은 실패를 두 번 말하지 않는다).

import { MutationObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, reportMutationError, setMutationErrorHandler } from './query-client.js';

afterEach(() => setMutationErrorHandler(null));

describe('reportMutationError', () => {
  it('자기 처리기가 없는 쓰기의 실패는 기본 처리기가 받는다', () => {
    const handler = vi.fn();
    setMutationErrorHandler(handler);
    const error = new Error('거절');
    reportMutationError(error, { options: {} });
    expect(handler).toHaveBeenCalledWith(error);
  });

  it('자기 처리기가 있으면 비킨다 — 그 자리가 이미 말한다', () => {
    const handler = vi.fn();
    setMutationErrorHandler(handler);
    reportMutationError(new Error('거절'), { options: { onError: () => undefined } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('제자리에 그리는 쓰기(meta.inlineError)에도 비킨다', () => {
    const handler = vi.fn();
    setMutationErrorHandler(handler);
    reportMutationError(new Error('거절'), { options: { meta: { inlineError: true } } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('createQueryClient', () => {
  /** 캐시에 실제로 걸려 있는지 — 함수만 맞고 배선이 빠지면 화면은 여전히 조용하다 */
  it('처리기 없는 쓰기가 실패하면 기본 처리기가 한 번 불린다', async () => {
    const handler = vi.fn();
    setMutationErrorHandler(handler);
    const client = createQueryClient();
    const observer = new MutationObserver(client, {
      mutationFn: () => Promise.reject(new Error('서버가 거절했다')),
    });
    await expect(observer.mutate()).rejects.toThrow('서버가 거절했다');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
