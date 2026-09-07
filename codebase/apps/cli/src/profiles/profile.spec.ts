// 프로파일 파서 — **문서가 보여 주는 예시가 실제로 읽혀야 한다** (importer.md §1.4)
//
// §1.4 의 유일한 프로파일 예시가 첫 인라인 맵(`{ implemented: 117, … }`)에서 죽고 있었다
// (2026-09-07 실측: `JSON.parse` 는 따옴표 없는 키를 받지 않는다). 문서가 보여 주는 대로
// 쓴 사람은 **자기 파일이 잘못됐다고** 읽는다 — 없는 문법을 가르치는 문서가 그렇게 된다.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setLocaleForTesting } from '../i18n.js';
import { loadBuiltin, parseSimpleYaml, ProfileError } from './index.js';

setLocaleForTesting('ko');

describe('YAML 부분집합 (REQ-IMP-029)', () => {
  it('따옴표 없는 인라인 맵을 읽는다 — YAML 이지 JSON 이 아니다', () => {
    expect(parseSimpleYaml('status_distribution: { implemented: 117, partial: 17 }')).toEqual({
      status_distribution: { implemented: 117, partial: 17 },
    });
  });

  it('인라인 배열과 중첩 맵을 읽는다', () => {
    expect(parseSimpleYaml('scan:\n  spec: ["spec/**/*.md"]\n  exclude: []')).toEqual({
      scan: { spec: ['spec/**/*.md'], exclude: [] },
    });
    expect(parseSimpleYaml('m: { a: { b: 1 } }')).toEqual({ m: { a: { b: 1 } } });
  });

  it('블록 리스트를 읽는다 — 빈 값 뒤에 오는 것이 배열인지는 다음 줄이 정한다', () => {
    expect(parseSimpleYaml('scan:\n  spec:\n    - "spec/**/*.md"\n    - "docs/**/*.md"')).toEqual({
      scan: { spec: ['spec/**/*.md', 'docs/**/*.md'] },
    });
  });

  it('읽지 못한 문법은 **던진다** — 절반만 읽고 통과시키지 않는다', () => {
    expect(() => parseSimpleYaml('a: { b: 1 } trailing')).toThrow(ProfileError);
    expect(() => parseSimpleYaml('- 뿌리에 리스트')).toThrow(ProfileError);
  });

  /**
   * **문서의 예시를 그대로 태운다.** 문서가 정본이라면 그 정본이 실행 가능해야 한다 —
   * 예시가 깨져 있어도 아무 검사가 울지 않는 것이 이 결함이 오래 남은 이유다.
   */
  it('§1.4 의 프로파일 예시가 스키마 검증까지 통과한다', () => {
    const doc = readFileSync(
      new URL('../../../../../docs/04-mvp/importer.md', import.meta.url).pathname,
      'utf8',
    );
    const start = doc.indexOf('```yaml', doc.indexOf('### 1.4'));
    const body = doc.slice(doc.indexOf('\n', start) + 1, doc.indexOf('```', start + 7));
    // 예시는 자리표시자(`<기계생성 카탈로그 글롭>`)를 쓴다 — 사람이 채우는 자리다
    const yaml = body.replaceAll(/<[^>]+>/g, 'placeholder');
    const parsed = parseSimpleYaml(yaml) as Record<string, unknown>;
    expect(parsed['profile']).toBe('clemvion');
    expect(parsed['expect']).toMatchObject({ spec_total: 135 });
  });
});

describe('내장 프로파일', () => {
  it('nerv-docs 가 이 저장소의 docs/ 를 읽도록 선언돼 있다 (§5.1)', () => {
    const profile = loadBuiltin('nerv-docs');
    expect(profile.scan.spec.length).toBeGreaterThan(0);
  });
});

/**
 * **§5.1 이 적은 규칙과 프로파일이 다섯 자리에서 달랐다**(2026-09-07 실측).
 *
 * 이 프로파일은 이 저장소 자신의 문서를 옮기는 것이고, 첫 임포트의 결과가 그대로 Task 의
 * 초기 상태가 된다 — 규칙이 문서와 다르면 그 어긋남이 데이터가 된다.
 */
describe('nerv-docs 가 §5.1 과 같다 (REQ-IMP-030)', () => {
  const profile = loadBuiltin('nerv-docs');

  it('README.md 를 스캔에 넣고 vision 으로 올린다 — 제외 목록에 있었다', () => {
    expect(profile.scan.exclude).not.toContain('README.md');
    expect(profile.tree.overrides['README.md']).toBe('vision');
  });

  it('잎은 design 이다 — feature 는 clemvion 의 잎 종류였다', () => {
    expect(profile.tree.leaf_type).toBe('design');
  });

  it('status 없는 문서는 승인된 정본이다 — 기본이 draft 면 15편이 초안이 된다', () => {
    expect(profile.frontmatter.status_default).toBe('approved');
  });

  it('되돌릴 때 필요한 키를 매니페스트에 남긴다', () => {
    expect(profile.frontmatter.preserve).toEqual(['updated', 'referenced_by']);
  });
});
