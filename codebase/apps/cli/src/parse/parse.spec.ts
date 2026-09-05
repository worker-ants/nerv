// 파싱 규칙 — 정본: docs/04-mvp/importer.md §2
//
// 임포터의 값은 "≥95% 자동 변환 + 실패 전건 목록화"(성공 기준 0-6)에 있다. 그 둘 다
// 파싱의 정확성에 달려 있고, 특히 **실패를 조용히 삼키지 않는 것**이 핵심이다.

import { describe, expect, it } from 'vitest';
import { parseFrontmatter, splitStatus } from './frontmatter.js';
import { extractRequirements } from './requirements.js';
import { globToRegExp, matchesAny } from './scan.js';

describe('frontmatter (§2.3)', () => {
  it('본문은 원문 그대로 남긴다 — 원문 보존이 제1규칙이다(§2.4)', () => {
    const raw = '---\nid: SPC-CWC-007\nstatus: implemented\n---\n# 제목\n\n본문 그대로\n';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter['id']).toBe('SPC-CWC-007');
    expect(body).toBe('# 제목\n\n본문 그대로\n');
  });

  it('목록 값을 배열로 읽는다', () => {
    const raw = '---\npending_plans:\n  - plan/a.md\n  - plan/b.md\n---\n본문';
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['pending_plans']).toEqual(['plan/a.md', 'plan/b.md']);
  });

  it('frontmatter 가 없으면 전체가 본문이다', () => {
    const { frontmatter, body } = parseFrontmatter('# 제목만');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# 제목만');
  });
});

describe('status 2축 분해 (§2.3)', () => {
  const map = {
    implemented: { doc: 'approved', impl: 'implemented' },
    partial: { doc: 'approved', impl: 'in_progress' },
    backlog: { doc: 'draft', impl: 'unimplemented' },
  };

  it('원본 1축을 문서 축 × 구현 축으로 나눈다', () => {
    expect(splitStatus('implemented', map)).toEqual({ doc: 'approved', impl: 'implemented' });
    expect(splitStatus('partial', map)).toEqual({ doc: 'approved', impl: 'in_progress' });
  });

  it('매핑에 없는 값은 **null 이다** — 기본값으로 조용히 넘기지 않는다', () => {
    // 넘기면 117/17/1 집계가 조용히 틀어지고, 그 순간 임포트의 신뢰가 사라진다
    expect(splitStatus('알-수-없는-값', map)).toBeNull();
  });
});

describe('요구사항 추출 휴리스틱 (§2.5)', () => {
  const pattern = '[A-Z]+-[A-Z]+-\\d+';

  it('고정 ID 를 앵커로 문장을 떼어낸다', () => {
    const body =
      '- REQ-CWC-031 WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다';
    const [requirement] = extractRequirements(body, pattern);
    expect(requirement?.ref).toBe('REQ-CWC-031');
    expect(requirement?.text).toContain('WHEN 방문자가');
    expect(requirement?.line).toBe(1);
  });

  it('같은 ID 가 여러 번 나와도 하나로 센다', () => {
    const body = 'REQ-A-1 첫 언급\n다시 REQ-A-1 참조';
    expect(extractRequirements(body, pattern)).toHaveLength(1);
  });

  it('줄 번호를 남긴다 — 리포트가 파일·줄·사유를 적어야 한다(§4.1)', () => {
    const body = '머리말\n\nREQ-B-2 두 번째';
    expect(extractRequirements(body, pattern)[0]?.line).toBe(3);
  });

  it('ID 가 없으면 빈 배열 — 없는 것을 지어내지 않는다', () => {
    expect(extractRequirements('요구사항 ID 가 없는 문서', pattern)).toEqual([]);
  });
});

describe('glob 매칭 (§2.1 스캔)', () => {
  it.each([
    ['spec/**/*.md', 'spec/a/b.md', true],
    ['spec/**/*.md', 'spec/a.md', true],
    ['spec/**/*.md', 'plan/a.md', false],
    ['plan/{in-progress,complete}/**/*.md', 'plan/complete/x.md', true],
    ['plan/{in-progress,complete}/**/*.md', 'plan/research/x.md', false],
    ['spec/**/api-catalog/**', 'spec/x/api-catalog/y.md', true],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(globToRegExp(pattern).test(path)).toBe(expected);
  });

  it('제외가 포함을 이긴다 — 재생성 가능한 산출물은 옮기지 않는다(D-07)', () => {
    const include = ['spec/**/*.md'];
    const exclude = ['spec/**/api-catalog/**'];
    const path = 'spec/channel/api-catalog/gen.md';
    expect(matchesAny(path, include)).toBe(true);
    expect(matchesAny(path, exclude)).toBe(true);
  });
});
