// 요청 예산 — 임베딩이 멈춰 있던 원인의 회귀 방지 (2026-08-28 실측)
//
// 한 문서의 바뀐 청크를 통째로 한 요청에 실으면 로컬 프로필(ollama CPU)에서 타임아웃이다.
// 지연은 입력 개수가 아니라 **총 문자 수**를 따라가므로(실측: 1개 4,000자 5.5초 ·
// 8개 16,000자 39.8초) 예산도 문자로 센다. 여기서 지키는 것은 그 규칙 셋이다.

import { describe, expect, it } from 'vitest';
import { batchByBudget } from './embedding.service.js';

const size = (s: string): number => s.length;

describe('요청 예산으로 나누기', () => {
  it('예산이 차면 끊는다 — 문자 수가 지연을 정한다', () => {
    const items = ['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(2000), 'd'.repeat(2000)];
    const batches = batchByBudget(items, size, 5000, 8);
    expect(batches.map((b) => b.length)).toEqual([2, 2]);
  });

  it('개수 상한도 함께 본다 — 짧은 청크 수십 개가 한 요청에 몰리지 않게', () => {
    const items = Array.from({ length: 20 }, () => 'x'.repeat(10));
    expect(batchByBudget(items, size, 6000, 8).map((b) => b.length)).toEqual([8, 8, 4]);
  });

  it('한 개짜리가 예산을 넘어도 그대로 보낸다 — 청크는 더 쪼갤 수 없다', () => {
    const batches = batchByBudget(['z'.repeat(9000), 'y'.repeat(100)], size, 6000, 8);
    expect(batches.map((b) => b.length)).toEqual([1, 1]);
  });

  it('빈 입력은 빈 배치다 — 요청을 만들지 않는다', () => {
    expect(batchByBudget([], size, 6000, 8)).toEqual([]);
  });

  it('예산 안에 다 들어가면 한 요청이다 — 쪼개는 것 자체가 목적이 아니다', () => {
    const items = ['a'.repeat(100), 'b'.repeat(100)];
    expect(batchByBudget(items, size, 6000, 8)).toEqual([items]);
  });
});
