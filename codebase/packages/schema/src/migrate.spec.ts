// 남은 마이그레이션 판정 — drizzle 적용기와 같은 규칙 (REQ-CB-056)
//
// 적용기는 이력의 가장 늦은 `created_at` 보다 나중인 파일만 돌린다. 검사가 다른 규칙을 쓰면
// "검사는 남았다는데 적용기는 할 것이 없다" 가 된다. 실제 DB 대조는 L2(apps/api migrate.spec).

import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { journalEntries, migrationsFolder, pendingMigrations } from './migrate.js';

const ENTRIES = [
  { tag: '0000_init', when: 100 },
  { tag: '0001_auth', when: 200 },
  { tag: '0002_more', when: 300 },
];

describe('pendingMigrations', () => {
  it('이력이 없으면 전부가 남은 것이다', () => {
    expect(pendingMigrations(ENTRIES, null)).toEqual(['0000_init', '0001_auth', '0002_more']);
  });

  it('마지막 적용보다 나중인 파일만 남은 것이다', () => {
    expect(pendingMigrations(ENTRIES, 100)).toEqual(['0001_auth', '0002_more']);
  });

  it('다 따라왔으면 남은 것이 없다', () => {
    expect(pendingMigrations(ENTRIES, 300)).toEqual([]);
  });

  it('DB 가 코드보다 앞서 있어도 뒤처진 것이 아니다 — 롤링 배포의 옛 파드가 그 모양이다', () => {
    expect(pendingMigrations(ENTRIES, 999)).toEqual([]);
  });
});

describe('journalEntries', () => {
  it('동봉된 순서표가 SQL 파일과 하나씩 맞는다', () => {
    const files = readdirSync(migrationsFolder())
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    expect(
      journalEntries()
        .map((e) => e.tag)
        .sort(),
    ).toEqual(files);
  });

  it('시각이 순서대로 늘어난다 — 적용기의 "나중" 판정이 그것에 기댄다', () => {
    const whens = journalEntries().map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });
});
