// 승인이 한 일 — 토스트에 붙는 한 문장 (2026-10-17 사람 결정 · screens.md REQ-WEB-339 · api.md REQ-API-359)
//
// 한 건 결정 · 바로 승인 · 일괄 두 곳 · CR 화면이 같은 문장을 쓴다. 변경 요청이 아닌 승인은 예전 문장 그대로여야 하고, 만든 작업이
// 0 건이어도 그 사실을 적는다(기본값이 아무것도 만들지 않았다는 것도 알릴 일이다).

import { describe, expect, it } from 'vitest';
import { createTranslator, ko } from '@nerv/schema';
import { crOutcomeSum, crOutcomeText, withCrOutcome } from './cr-plan.js';

const t = createTranslator('ko');

const cr = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  change_request: {
    key: 'CLV-C-AAAAAA',
    actions_source: 'chosen',
    created_tasks: [{ key: 'CLV-T-1', kind: 'derive', ref: 'REQ-1' }],
    archived_tasks: [],
    ...over,
  },
});

describe('crOutcomeSum · withCrOutcome', () => {
  it('변경 요청이 아닌 승인 · 실패한 항목은 건너뛰고, 하나도 없으면 문장을 그대로 둔다', () => {
    expect(crOutcomeSum([{ ok: true }, { ok: false }])).toBeNull();
    expect(withCrOutcome(t, '3건 처리했습니다.', [{ ok: true }])).toBe('3건 처리했습니다.');
  });

  it('여럿이면 합친다 — 기본값이 하나라도 있으면 그 사실을 적는다', () => {
    const sum = crOutcomeSum([
      cr(),
      { ok: true },
      cr({ actions_source: 'default', created_tasks: [{}, {}], archived_tasks: ['CLV-T-9'] }),
    ]);
    expect(sum).toEqual({ crs: 2, created: 3, archived: 1, defaulted: true });
    expect(crOutcomeText(t, sum!)).toBe(
      [
        ko['cr.result.created'].replace('{n}', '3'),
        ko['cr.result.archived'].replace('{n}', '1'),
        ko['cr.result.default'],
      ].join(' '),
    );
  });

  it('만든 작업이 없어도 0 건이라고 적는다 — 보관이 없으면 보관 문장은 없다', () => {
    expect(withCrOutcome(t, '승인했습니다.', [cr({ created_tasks: [] })])).toBe(
      `승인했습니다. ${ko['cr.result.created'].replace('{n}', '0')}`,
    );
  });
});
