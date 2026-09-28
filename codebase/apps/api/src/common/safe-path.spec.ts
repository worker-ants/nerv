// 이름을 경로의 한 칸으로 (2026-09-28 · REQ-API-235)
//
// 스펙 키와 slug 는 형식 검사가 없어서, 디스크 미러가 `../` 가 든 키를 그대로 경로에 넣으면 대상 폴더
// 밖에 파일을 썼다. 여기서는 바꾼 이름이 한 칸을 벗어나지 않는지와, 보통 키는 그대로인지를 본다.

import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside, safePathSegment } from './safe-path.js';

describe('safePathSegment (REQ-API-235)', () => {
  it('보통 키와 한글은 그대로다 — 이미 쓰던 파일 이름과 링크가 바뀌지 않는다', () => {
    expect(safePathSegment('CLE-MKS-CPIK')).toBe('CLE-MKS-CPIK');
    expect(safePathSegment('SPC_2.1-웹챗')).toBe('SPC_2.1-웹챗');
  });

  it('경로를 나누는 글자와 상위 폴더는 한 칸 안에 남는다', () => {
    const escaped = safePathSegment('../../etc/passwd');
    expect(escaped).toBe('..%2F..%2Fetc%2Fpasswd');
    expect(escaped).not.toContain('/');
    expect(safePathSegment('..')).toBe('%2E%2E');
    expect(safePathSegment('.')).toBe('%2E');
    expect(safePathSegment('a\\b')).toBe('a%5Cb');
    expect(safePathSegment('a b\u0000')).toBe('a%20b%00');
  });

  it('바꾼 이름은 URL 퍼센트 인코딩이라 원래 키로 풀린다 — llms.txt 링크로 써도 된다', () => {
    for (const key of ['A/B', 'x y', '../up', '가:나']) {
      expect(decodeURIComponent(safePathSegment(key))).toBe(key);
    }
  });

  it('너무 긴 키는 자르고 해시를 붙인다 — 한 칸은 255 바이트를 넘지 못한다', () => {
    const long = '가'.repeat(300);
    const out = safePathSegment(long);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(200);
    expect(out).toMatch(/~[0-9a-f]{16}$/);
    // 끝만 다른 두 키는 다른 이름이 된다
    expect(safePathSegment(`${long}1`)).not.toBe(safePathSegment(`${long}2`));
  });
});

describe('resolveInside (REQ-API-235)', () => {
  const root = join(sep, 'srv', 'mirror');

  it('안쪽 경로를 돌려준다', () => {
    expect(resolveInside(root, 'clemvion', 'specs', 'A.md')).toBe(
      join(root, 'clemvion', 'specs', 'A.md'),
    );
  });

  it('밖으로 나가는 칸이 섞이면 던진다 — safePathSegment 를 빠뜨려도 여기서 막힌다', () => {
    expect(() => resolveInside(root, '..', 'etc')).toThrow();
    expect(() => resolveInside(root, 'specs', '../../../x.md')).toThrow();
    expect(() => resolveInside(root, `${sep}etc`)).toThrow();
  });
});
