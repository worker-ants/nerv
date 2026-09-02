// 편집 기준 지문의 규칙 (api.md §1.4g)
//
// 이 규칙이 틀리면 서버의 비교-교환이 **통과하면서** 남의 글이 사라진다 — 서버는 받은
// 지문대로 정확히 판정하므로 L2 로는 잡히지 않는 자리다.

import { describe, expect, it } from 'vitest';
import { baseHashFor, changedByOthers } from './edit-basis.js';

describe('baseHashFor — 무엇을 보고 썼는가', () => {
  it('연 시점의 지문이 라이브 값보다 앞선다 — 남의 저장이 내 기준을 밀어내지 않는다', () => {
    // 남이 저장해 라이브 값이 바뀐 상황. 예전에는 이 자리가 `live` 였고, 그래서 내 옛
    // 본문이 최신 지문을 달고 나가 서버의 검사를 통과했다.
    expect(baseHashFor({ saved: null, opened: 'opened', live: 'by-someone-else' })).toBe('opened');
  });

  it('내가 저장한 뒤에는 그 응답의 지문이 기준이다 — 두 번째 저장이 자기를 낡았다고 하지 않게', () => {
    expect(baseHashFor({ saved: 'mine', opened: 'opened', live: 'by-someone-else' })).toBe('mine');
  });

  it('아직 아무것도 모르면 라이브 값을 쓴다 — 첫 렌더의 한 틱을 위한 폴백이다', () => {
    expect(baseHashFor({ saved: null, opened: null, live: 'live' })).toBe('live');
    expect(baseHashFor({ saved: null, opened: null, live: null })).toBeNull();
  });
});

describe('changedByOthers — 막히기 전에 말한다', () => {
  it('편집 중에 라이브 지문이 달라지면 참이다', () => {
    expect(changedByOthers({ editing: true, opened: 'a', live: 'b' })).toBe(true);
  });

  it('읽고만 있으면 알리지 않는다 — 최신을 보는 것은 정상이다', () => {
    expect(changedByOthers({ editing: false, opened: 'a', live: 'b' })).toBe(false);
  });

  it('같으면 조용하다', () => {
    expect(changedByOthers({ editing: true, opened: 'a', live: 'a' })).toBe(false);
  });

  it('아직 모르는 값이 있으면 단정하지 않는다', () => {
    expect(changedByOthers({ editing: true, opened: null, live: 'b' })).toBe(false);
    expect(changedByOthers({ editing: true, opened: 'a', live: null })).toBe(false);
  });
});
