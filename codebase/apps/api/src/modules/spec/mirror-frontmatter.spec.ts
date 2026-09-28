// md 미러의 frontmatter 값 — 어느 YAML 파서로도 같은 값으로 읽힌다 (2026-09-28 · REQ-API-245)

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderFrontmatter, yamlString } from './mirror-frontmatter.js';

const TRICKY = [
  '마켓 스킨: CPIK 연동',
  'a: b: c',
  '# 주석처럼',
  '- 목록처럼',
  '[괄호] {중괄호}',
  'yes',
  'null',
  '123',
  '"큰따옴표" \'작은따옴표\'',
  'C:\\경로\\이름',
  '탭\t문자',
  '줄\n바꿈',
  '& * ! | > % @ `',
  'NEL\u0085 LS\u2028 PS\u2029 DEL\u007f BOM\ufeff',
  '😀 이모지',
];

describe('yamlString', () => {
  it.each(TRICKY)('%j 는 그 값 그대로 읽힌다', (value) => {
    expect(parse(`v: ${yamlString(value)}`)).toEqual({ v: value });
    // JSON 문자열이기도 하다 — JSON 으로 읽어도 같다
    expect(JSON.parse(yamlString(value))).toBe(value);
  });

  it('YAML 이 인쇄 가능한 글자로 보지 않는 것과 YAML 1.1 의 줄바꿈은 이스케이프한다', () => {
    expect(yamlString('a\u2028b')).toBe('"a\\u2028b"');
    expect(yamlString('a\u0085b')).toBe('"a\\u0085b"');
    expect(yamlString('a\u007fb')).toBe('"a\\u007fb"');
  });
});

describe('renderFrontmatter', () => {
  it('키 순서를 지키고, 숫자 · 참거짓 · null · 목록을 제 모양으로 쓴다', () => {
    const text = renderFrontmatter([
      ['id', 'CLE-MKS-CPIK'],
      ['title', '마켓 스킨: CPIK 연동'],
      ['version', 4],
      ['status', null],
      ['requirements', ['REQ-MKS-001', 'REQ, 쉼표']],
      ['basis_superseded', false],
    ]);
    expect(text.startsWith('---\n')).toBe(true);
    expect(text.endsWith('\n---\n')).toBe(true);
    const inner = text.slice(4, -5);
    expect(Object.keys(parse(inner) as object)).toEqual([
      'id',
      'title',
      'version',
      'status',
      'requirements',
      'basis_superseded',
    ]);
    expect(parse(inner)).toEqual({
      id: 'CLE-MKS-CPIK',
      title: '마켓 스킨: CPIK 연동',
      version: 4,
      status: null,
      requirements: ['REQ-MKS-001', 'REQ, 쉼표'],
      basis_superseded: false,
    });
  });
});
