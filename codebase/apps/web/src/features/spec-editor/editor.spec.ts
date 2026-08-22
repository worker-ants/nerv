// E08-S04 · E06-S02 — md 직렬화 왕복 규칙 (screens.md §3.2)
//
// 여기서 지키는 것은 하나다: **불안정한 직렬화는 저장을 막는다.** 왕복이 흔들리는 문서를
// 저장하면 웹과 터미널이 같은 초안을 오갈 때마다 정규화 차이로 diff 가 생기고, 그때부터
// 버전 이력은 "누가 무엇을 바꿨나"에 답하지 못한다.

import { describe, expect, it } from 'vitest';
import { normalize, roundTrip } from './editor.js';

describe('정규화 — 의미 없는 차이는 저장을 막지 않는다', () => {
  it('줄 끝 공백과 문서 끝 개행은 같은 문서로 본다', () => {
    expect(normalize('# 제목  \n본문\n\n')).toBe(normalize('# 제목\n본문'));
  });

  it('내용이 다르면 다르다 — 관대함이 여기까지는 아니다', () => {
    expect(normalize('# A')).not.toBe(normalize('# B'));
  });
});

describe('왕복 판정', () => {
  const serializerOf = (transform: (md: string) => string) => ({
    storage: {
      markdown: {
        parser: { parse: (md: string) => md },
        serializer: { serialize: (doc: unknown) => transform(String(doc)) },
      },
    },
  });

  it('두 번 돌려 같으면 안정이다', () => {
    const result = roundTrip(
      serializerOf((md) => md),
      '# 제목\n\n본문',
    );
    expect(result.stable).toBe(true);
  });

  it('직렬화가 문서를 바꾸면 불안정이다 — 저장 차단의 근거', () => {
    const result = roundTrip(
      serializerOf((md) => `${md}\n추가된 줄`),
      '# 제목',
    );
    expect(result.stable).toBe(false);
  });

  it('파싱이 던지면 불안정으로 친다 — 판단할 수 없으면 막는 쪽이 안전하다', () => {
    const broken = {
      storage: {
        markdown: {
          parser: {
            parse: () => {
              throw new Error('parse failure');
            },
          },
          serializer: { serialize: (doc: unknown) => String(doc) },
        },
      },
    };
    expect(roundTrip(broken, '# 제목').stable).toBe(false);
  });

  it('markdown 확장이 없으면 판정하지 않는다(안정으로 둔다)', () => {
    expect(roundTrip({ storage: {} }, '# 제목').stable).toBe(true);
  });
});
