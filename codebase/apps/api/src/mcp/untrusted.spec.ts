import { describe, expect, it } from 'vitest';
import { isWrappedBody, wrapSpecBody, wrapText } from './untrusted.js';

describe('비신뢰 경계 (REQ-API-153)', () => {
  it('스펙 본문은 키·버전과 함께 감싸인다', () => {
    expect(wrapSpecBody('본문', { key: 'SPC-X', versionNo: 7 })).toBe(
      '<nerv:spec id="SPC-X" version="7" trust="untrusted">\n본문\n</nerv:spec>',
    );
  });

  it('버전이 없으면 속성도 없다 — 빈 속성은 "버전 없음" 이 아니라 오답으로 읽힌다', () => {
    expect(wrapSpecBody('본문', { key: 'SPC-X', versionNo: null })).toBe(
      '<nerv:spec id="SPC-X" trust="untrusted">\n본문\n</nerv:spec>',
    );
  });

  it('속성값의 따옴표는 이스케이프된다 — 값이 태그를 닫지 못한다', () => {
    expect(wrapSpecBody('본문', { key: 'A"B&C' })).toContain('id="A&quot;B&amp;C"');
  });

  it('빈 본문도 감싼다 — 감싸지 않으면 "본문이 없다" 와 "경계가 없다" 가 같아진다', () => {
    expect(wrapSpecBody('')).toBe('<nerv:spec trust="untrusted">\n\n</nerv:spec>');
  });

  it('스펙이 아닌 텍스트는 kind 를 단 다른 요소다', () => {
    expect(wrapText('answer', '답변', { question_id: 'q1' })).toBe(
      '<nerv:text kind="answer" question_id="q1" trust="untrusted">\n답변\n</nerv:text>',
    );
  });

  /**
   * **필드 값 전체가 경계다.** 본문 한가운데의 닫는 태그는 경계를 끝내지 않는다 —
   * 그렇게 읽으면 문서가 자기 규약을 인용하는 순간(이 저장소의 문서가 그렇다) 저장이 막힌다.
   */
  it('포장 판정은 필드 전체만 본다', () => {
    expect(isWrappedBody(wrapSpecBody('본문', { key: 'SPC-X' }))).toBe(true);
    expect(isWrappedBody('  \n<nerv:spec trust="untrusted">\n본문\n</nerv:spec>\n ')).toBe(true);
    expect(isWrappedBody('본문 안에서 `</nerv:spec>` 를 설명한다')).toBe(false);
    expect(
      isWrappedBody('# 문서\n\n<nerv:spec id="X" trust="untrusted">\n인용\n</nerv:spec>\n뒷말'),
    ).toBe(false);
    expect(isWrappedBody('')).toBe(false);
  });
});
