// 테이블 29종 · enum 38종의 **개수와 이름**을 고정한다.
//
// 근거: docs/04-mvp/database.md §2(DDL 정본) · codebase.md §2.3(모듈별 소유 배정).
// 이 숫자는 문서 전체에서 반복 인용되는 검산값이라(29 = 5+9+4+2+2+5+2), 선언이 하나
// 늘거나 빠지면 여기서 먼저 걸린다. spec_chunk_embedding 은 도메인 엔티티가 아니라
// 재생성 가능한 파생 데이터라 이 카운트에 들지 않는다(database.md §2.15).

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as enums from '../enums.js';
import * as tables from './index.js';

const allTables = Object.values(tables).filter((t) => is(t, PgTable)) as PgTable[];

/**
 * 검색 인덱스 테이블은 도메인 엔티티가 아니다 — 원문에서 재생성 가능한 파생 데이터라
 * 29종 카운트와 ERD 에 들지 않는다(database.md §2.15). 마이그레이션에는 포함되므로
 * 배럴에는 있지만 이 카운트에서는 뺀다.
 */
const NON_ENTITY_TABLES = new Set(['spec_chunk_embedding']);

const declaredTables = allTables.filter((t) => !NON_ENTITY_TABLES.has(getTableName(t)));
const tableNames = declaredTables.map((t) => getTableName(t)).sort();

describe('테이블 선언 (database.md §2)', () => {
  it('29종이다 — 5(테넌시) + 9(스펙) + 4(작업) + 2(세션) + 2(승인) + 5(리뷰) + 2(이벤트)', () => {
    expect(declaredTables).toHaveLength(29);
  });

  it('이름이 data-model 의 테이블 표와 1:1 이다', () => {
    expect(tableNames).toEqual([
      'activity',
      'agent_session',
      'api_token',
      'approval',
      'change_request',
      'claim',
      'event',
      'evidence',
      'finding',
      'finding_occurrence',
      'membership',
      'notification',
      'organization',
      'project',
      'question',
      'requirement',
      'requirement_version',
      'resolution',
      'review_session',
      'reviewer_report',
      'spec',
      'spec_baseline',
      'spec_baseline_item',
      'spec_comment',
      'spec_relation',
      'spec_version',
      'task',
      'task_dependency',
      'user',
    ]);
  });

  it('테이블은 snake_case 단수다 (§1.3 이름 규약)', () => {
    for (const name of tableNames) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('검색 인덱스 테이블은 배럴에 있지만 엔티티로 세지 않는다 (§2.15)', () => {
    const all = allTables.map((t) => getTableName(t));
    expect(all).toContain('spec_chunk_embedding');
    expect(all).toHaveLength(30);
    expect(tableNames).not.toContain('spec_chunk_embedding');
  });
});

describe('enum 선언 (database.md §2.1)', () => {
  // pgEnum 은 호출 가능한 객체다 — enumName·enumValues 를 가진 함수만 센다.
  const declaredEnums = Object.values(enums).filter(
    (e) => typeof e === 'function' && 'enumName' in e && 'enumValues' in e,
  );

  it('38종이다', () => {
    expect(declaredEnums).toHaveLength(38);
  });

  it('하이픈이 든 clemvion 계승 어휘를 그대로 쓴다 (data-model §2.6)', () => {
    expect(enums.escalateReason.enumValues).toEqual([
      'no',
      'spec',
      'user-decision',
      'infra',
      'e2e-fail-3x',
      'sensitive-fix',
    ]);
    expect(enums.agentType.enumValues).toContain('claude-code');
  });

  it('역할 6종은 권한 매트릭스와 같다 (FR-14)', () => {
    expect(enums.memberRole.enumValues).toEqual([
      'admin',
      'planner',
      'designer',
      'developer',
      'qa',
      'viewer',
    ]);
  });

  it('Task 축 상태 7종 · 문서 축 상태 5종 (spec-workflow §1.2·§1.4)', () => {
    expect(enums.taskStatus.enumValues).toEqual([
      'backlog',
      'ready',
      'claimed',
      'in_progress',
      'in_review',
      'done',
      'blocked',
    ]);
    expect(enums.specVersionStatus.enumValues).toEqual([
      'draft',
      'in_review',
      'approved',
      'superseded',
      'deprecated',
    ]);
  });

  it('세션 상태 머신 6종 (data-model §2.5)', () => {
    expect(enums.sessionState.enumValues).toEqual([
      'pending',
      'active',
      'awaiting_input',
      'complete',
      'error',
      'stale',
    ]);
  });
});
