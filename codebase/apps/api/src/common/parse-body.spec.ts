// 요청 본문의 모양 검사 — 스키마가 정한 문장으로 답한다 (REQ-API-191 · codebase.md §3.4)
//
// 일괄 결정(EP-APR-06)에 51건을 보내면 "요청 본문이 스키마와 맞지 않습니다" 한 줄만 돌아왔다.
// 상한은 zod 에 있었고 그 상한을 말하는 문구도 카탈로그에 있었는데, 둘을 잇는 곳이 없었다.

import {
  ApprovalBulkDecisionInput,
  BULK_DECISION_LIMIT,
  NERV_ERROR,
  renderMessage,
} from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { NervError, statusFor } from './nerv-exception.filter.js';
import { describeIssues, parseBody } from './parse-body.js';

const items = (n: number): { id: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}` }));

function failure(fn: () => unknown): NervError {
  try {
    fn();
  } catch (error) {
    if (error instanceof NervError) return error;
    throw error;
  }
  throw new Error('예외가 나지 않았다');
}

describe('parseBody — 스키마가 정한 문장', () => {
  it('일괄 결정이 상한을 넘으면 상한을 말한다 — 400 과 details.issues 는 그대로다', () => {
    const error = failure(() =>
      parseBody(ApprovalBulkDecisionInput, {
        decision: 'approve',
        items: items(BULK_DECISION_LIMIT + 1),
      }),
    );

    expect(error.code).toBe(NERV_ERROR.PRECONDITION);
    expect(error.descriptor).toEqual({
      key: 'error.approval.bulk_limit',
      values: { max: BULK_DECISION_LIMIT },
    });
    expect(renderMessage(error.descriptor, 'ko')).toBe('한 번에 50건까지 결정할 수 있습니다.');
    expect(renderMessage(error.descriptor, 'en')).toBe('You can decide up to 50 items at once.');
    expect(statusFor(error.code, error.details)).toBe(400);
    expect(error.details['issues']).toBeDefined();
  });

  it('상한까지는 통과한다', () => {
    const parsed = parseBody(ApprovalBulkDecisionInput, {
      decision: 'approve',
      items: items(BULK_DECISION_LIMIT),
    });
    expect(parsed.items).toHaveLength(BULK_DECISION_LIMIT);
  });

  it('키를 달지 않은 위반은 예전 문장이다', () => {
    const error = failure(() =>
      parseBody(ApprovalBulkDecisionInput, { decision: 'approve', items: [] }),
    );
    expect(error.descriptor).toEqual({ key: 'error.request.schema' });
  });
});

// 이슈 모양은 zod 가 내는 칸(message · maximum · minimum)만 흉내 낸다 — 실제 zod 의 모양은
// 위의 `ApprovalBulkDecisionInput` 검사가 본다
describe('describeIssues — 키가 아닌 문자열은 믿지 않는다', () => {
  it('zod 의 기본 영어 문장은 봉투에 싣지 않는다', () => {
    const error = { issues: [{ message: 'Too big: expected number to be <=3', maximum: 3 }] };
    expect(describeIssues(error)).toEqual({ key: 'error.request.schema' });
  });

  it('카탈로그에 없는 키 모양의 문자열도 믿지 않는다 — 사람에게 키 원문이 보인다', () => {
    const error = { issues: [{ message: 'error.no_such_key', maximum: 3 }] };
    expect(describeIssues(error)).toEqual({ key: 'error.request.schema' });
  });

  it('여럿이 어겨졌으면 키를 단 첫 이슈의 문장이다', () => {
    const error = {
      issues: [
        { message: 'Invalid input: expected string, received number' },
        { message: 'error.approval.bulk_limit', maximum: 1 },
      ],
    };
    expect(describeIssues(error)).toEqual({
      key: 'error.approval.bulk_limit',
      values: { max: 1 },
    });
  });

  it('이슈가 없거나 모양을 모르면 예전 문장이다', () => {
    expect(describeIssues(undefined)).toEqual({ key: 'error.request.schema' });
    expect(describeIssues({})).toEqual({ key: 'error.request.schema' });
  });
});
