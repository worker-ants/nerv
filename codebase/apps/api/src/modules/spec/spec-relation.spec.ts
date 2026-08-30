// 본문 → `references` 추출 (api.md §2.2 · REQ-API-024)
//
// **링크만 센다**(2026-08-30 개정 — 사람 결정). 앞선 규칙은 `SPC-` 로 시작하는 문자열을
// 산문 아무 데서나 주웠고, 그래서 두 가지가 동시에 틀려 있었다:
//
//   접두가 상수다   → `SUD-…` 로 지은 프로젝트는 관계가 0 건이었다(실측 sudoku 13편)
//   산문을 줍는다   → 키가 일상어면(clemvion 의 `migrations`·`conventions`) 문장이 관계가 된다
//
// 링크는 사람이 "이건 그 문서다"라고 적은 자리다. 이 파일이 지키는 것은 그 경계다.

import { describe, expect, it } from 'vitest';
import { extractLinkedKeys, specKeyOfLink } from './spec-relation.service.js';

describe('링크 대상 → 스펙 키', () => {
  it('맨 키는 그대로 받는다 — 가장 짧은 표기다', () => {
    expect(specKeyOfLink('SUD-AREA-PLAY')).toBe('SUD-AREA-PLAY');
  });

  it('앱 경로는 끝의 키를 본다 — 앵커와 질의는 버린다', () => {
    expect(specKeyOfLink('/p/sudoku/specs/SUD-AREA-PLAY')).toBe('SUD-AREA-PLAY');
    expect(specKeyOfLink('/p/sudoku/specs/SUD-AREA-PLAY#3-입력')).toBe('SUD-AREA-PLAY');
    expect(specKeyOfLink('https://nerv.example.com/p/sudoku/specs/SPC-CWC-007?v=3')).toBe(
      'SPC-CWC-007',
    );
  });

  it('스펙 경로가 아닌 남의 주소는 참조가 아니다', () => {
    // 키가 일상어인 프로젝트에서 이 한 줄이 없으면 바깥 링크가 문서를 가리킨다
    expect(specKeyOfLink('https://example.com/migrations')).toBeNull();
    expect(specKeyOfLink('mailto:someone@example.com')).toBeNull();
  });

  it('상대 경로는 서버가 해소하지 않는다 — 임포터의 몫이다', () => {
    expect(specKeyOfLink('../play/index.md')).toBeNull();
    expect(specKeyOfLink('./sibling.md')).toBeNull();
  });

  it('빈 대상은 없는 것이다', () => {
    expect(specKeyOfLink('')).toBeNull();
    expect(specKeyOfLink('#anchor-only')).toBeNull();
  });
});

describe('본문에서 링크만 센다', () => {
  it('산문에 적힌 키는 관계가 아니다 — 이것이 바뀐 규칙의 핵심이다', () => {
    expect(extractLinkedKeys('SUD-AREA-PLAY 를 참조한다')).toEqual([]);
    expect(extractLinkedKeys('SPC-CWC-007 도 마찬가지다')).toEqual([]);
  });

  it('링크로 적으면 센다', () => {
    const body = '협동은 보드가 하나다([게임플레이 §3](/p/sudoku/specs/SUD-AREA-PLAY#3)).';
    expect(extractLinkedKeys(body)).toEqual(['SUD-AREA-PLAY']);
  });

  it('같은 문서를 여러 번 링크해도 관계는 하나다', () => {
    const body = '[a](SUD-X) 그리고 [b](/p/s/specs/SUD-X) 그리고 [c](SUD-X#4)';
    expect(extractLinkedKeys(body)).toEqual(['SUD-X']);
  });

  it('이미지는 참조가 아니다 — 그림은 문서를 가리키지 않는다', () => {
    expect(extractLinkedKeys('![도표](SUD-AREA-PLAY)')).toEqual([]);
  });

  it('자기 자신은 참조가 아니다', () => {
    expect(extractLinkedKeys('[나](SUD-SELF) 를 링크했다', 'SUD-SELF')).toEqual([]);
  });

  it('여러 링크를 정렬해서 준다 — 저장마다 순서가 흔들리면 델타가 거짓이 된다', () => {
    const body = '[b](SUD-B) [a](SUD-A) [c](/p/s/specs/SUD-C)';
    expect(extractLinkedKeys(body)).toEqual(['SUD-A', 'SUD-B', 'SUD-C']);
  });
});
