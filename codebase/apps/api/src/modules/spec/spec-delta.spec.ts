// 저장 델타 (api.md §2.2 · REQ-API-046)
//
// draft 는 덮어써지므로 나중에 되짚을 diff 가 없다 — 저장하는 그 순간이 "무엇이 바뀌었나"를
// 말할 수 있는 유일한 시점이다. 그래서 이 계산이 틀리면 이력이 통째로 거짓이 된다.

import { describe, expect, it } from 'vitest';
import { specDelta } from './spec-delta.js';

const REQ = (ref: string, text: string): string => `- ${ref} ${text}`;

describe('요구사항 축', () => {
  it('새 문서는 전부 added 다', () => {
    const delta = specDelta(null, `# 새 문서\n${REQ('REQ-SUD-001', 'WHEN a THE SYSTEM SHALL b')}`);
    expect(delta.requirements).toEqual({ added: ['REQ-SUD-001'], modified: [], removed: [] });
  });

  it('문장이 바뀌면 modified, 사라지면 removed', () => {
    const before = `${REQ('REQ-SUD-001', '옛 문장')}\n${REQ('REQ-SUD-002', '그대로')}`;
    const after = `${REQ('REQ-SUD-001', '새 문장')}\n${REQ('REQ-SUD-003', '새 요구')}`;
    expect(specDelta(before, after).requirements).toEqual({
      added: ['REQ-SUD-003'],
      modified: ['REQ-SUD-001'],
      removed: ['REQ-SUD-002'],
    });
  });

  it('바뀐 것이 없으면 셋 다 비어 있다 — 저장했다는 사실만으로 이력을 만들지 않는다', () => {
    const body = REQ('REQ-SUD-001', '그대로');
    expect(specDelta(body, body).requirements).toEqual({ added: [], modified: [], removed: [] });
  });
});

describe('줄 축 — 요구사항이 없는 문서에서도 변화의 크기를 말한다', () => {
  it('덧붙인 줄과 지운 줄을 센다', () => {
    const delta = specDelta('가\n나\n다', '가\n다\n라\n마');
    expect(delta.lines).toEqual({ added: 2, removed: 1 });
  });

  it('같은 본문은 0 이다 — 무변경 저장이 이력에 남지 않게', () => {
    expect(specDelta('가\n나', '가\n나').lines).toEqual({ added: 0, removed: 0 });
  });

  it('새 문서는 지운 줄이 없다', () => {
    expect(specDelta(null, '가\n나').lines).toEqual({ added: 2, removed: 0 });
  });

  it('본문이 빈 줄로 끝나도 지운 줄은 0 이다 — 없는 문서에는 줄이 없다', () => {
    // 이전을 "빈 문자열 한 줄"로 세면 끝의 빈 줄이 상쇄돼 removed 가 **-1** 이 됐다(실측)
    expect(specDelta(null, '# 제목\n\n본문\n').lines).toEqual({ added: 4, removed: 0 });
  });

  it('줄 순서만 바뀐 것은 변화로 세지 않는다 — 같은 줄이 그대로 있다', () => {
    expect(specDelta('가\n나\n다', '다\n가\n나').lines).toEqual({ added: 0, removed: 0 });
  });
});
