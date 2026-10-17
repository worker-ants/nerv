// 테이블 32종 · enum 39종의 **개수와 이름**을 고정한다.
//
// 근거: docs/04-mvp/database.md §2(DDL 정본) · codebase.md §2.3(모듈별 소유 배정).
// 이 숫자는 문서 전체에서 반복 인용되는 검산값이라(32 = 6+1+9+1+4+2+2+5+2), 선언이 하나
// 늘거나 빠지면 여기서 먼저 걸린다. spec_chunk_embedding 은 도메인 엔티티가 아니라
// 재생성 가능한 파생 데이터라 이 카운트에 들지 않는다(database.md §2.15).

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as enums from '../enums.js';
import * as tables from './index.js';

const allTables = Object.values(tables).filter((t) => is(t, PgTable)) as PgTable[];

/**
 * 인프라 테이블은 도메인 엔티티가 아니다 — 32종 카운트와 ERD 에 들지 않는다.
 *   · spec_chunk_embedding : 원문에서 재생성 가능한 검색 인덱스(database.md §2.15)
 *   · email_outbox         : 보내고 나면 치우는 발송 큐(§2.17 · 2026-09-22). 사람도 화면도
 *                            이 표를 읽지 않는다 — 워커가 집어 가는 줄이다.
 *   · slack_outbox         : Slack 발송 큐(§2.18 · 2026-10-17) — 메일 아웃박스와 같은 성질이다.
 *   · auth_*               : 확정 스택(better-auth)이 요구하는 인증 인프라(§2.16).
 *                            전부 지워도 사람은 다시 로그인하면 되고 도메인 데이터는 그대로다.
 * 마이그레이션에는 포함되므로 배럴에는 있지만 이 카운트에서는 뺀다.
 */
const NON_ENTITY_TABLES = new Set([
  'spec_chunk_embedding',
  'email_outbox',
  'slack_outbox',
  'auth_session',
  'auth_account',
  'auth_verification',
]);

const declaredTables = allTables.filter((t) => !NON_ENTITY_TABLES.has(getTableName(t)));
const tableNames = declaredTables.map((t) => getTableName(t)).sort();

describe('테이블 선언 (database.md §2)', () => {
  // 테넌시가 6종이 된 것은 `invitation` 이다(2026-08-27 · 사람 결정) — 초대는 레코드여야
  // 한다: 초대받은 사람이 아직 가입하지 않았으면 membership 을 만들 수 없고, 만료·회수는
  // 상태를 가진 것만이 가질 수 있다.
  // 2026-09-27 · 33 → 34: `notification_preference` 신설(마이그레이션 0035 · 사람 결정 N3 · REQ-DB-028)
  // 2026-09-27 · 34 → 35: `notification_batch_event` 신설(마이그레이션 0037 · 사람 결정 G2 · REQ-DB-030)
  // 2026-09-28 · 35 → 36: `notification_digest_setting` 신설(마이그레이션 0041 · 사람 결정 EM1~EM9 · REQ-DB-034)
  // 2026-10-16 · 36 → 38: `watch` · `pin` 신설(마이그레이션 0056 · 사람 결정 D5 · REQ-DB-051)
  // 2026-10-16 · 38 → 39: `gate_verdict_comparison` 신설(마이그레이션 0057 · 사람 결정 D6 · REQ-DB-052)
  // 2026-10-17 · 39 → 40: `project_slack` 신설(마이그레이션 0060 · 사람 결정 D1 · D2 · REQ-DB-054)
  it('40종이다 — 6(테넌시) + 1(초대) + 9(스펙) + 1(첨부) + 4(작업) + 2(세션) + 2(승인) + 6(리뷰) + 7(이벤트) + 1(멱등) + 1(Slack)', () => {
    expect(declaredTables).toHaveLength(40);
  });

  it('이름이 data-model 의 테이블 표와 1:1 이다', () => {
    expect(tableNames).toEqual([
      'activity',
      'agent_session',
      'api_token',
      'approval',
      'attachment',
      'change_request',
      'claim',
      'event',
      'evidence',
      'finding',
      'finding_comment',
      'finding_occurrence',
      'gate_verdict_comparison',
      'idempotency_key',
      'invitation',
      'membership',
      'notification',
      'notification_batch_event',
      'notification_digest_setting',
      'notification_preference',
      'organization',
      'pin',
      'project',
      'project_slack',
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
      'watch',
    ]);
  });

  it('테이블은 snake_case 단수다 (§1.3 이름 규약)', () => {
    for (const name of tableNames) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('인프라 테이블은 배럴에 있지만 엔티티로 세지 않는다 (§2.15 · §2.16 · §2.17 · §2.18)', () => {
    const all = allTables.map((t) => getTableName(t));
    // 40 엔티티 + 인프라 6종(검색 인덱스 1 + 인증 3 + 발송 큐 2 — 메일 2026-09-22 · Slack 2026-10-17)
    expect(all).toHaveLength(46);
    for (const infra of NON_ENTITY_TABLES) {
      expect(all).toContain(infra);
      expect(tableNames).not.toContain(infra);
    }
  });
});

describe('enum 선언 (database.md §2.1)', () => {
  // pgEnum 은 호출 가능한 객체다 — enumName·enumValues 를 가진 함수만 센다.
  const declaredEnums = Object.values(enums).filter(
    (e) => typeof e === 'function' && 'enumName' in e && 'enumValues' in e,
  );

  // 2026-09-10 · 39 → 40: `repo_host` 신설(마이그레이션 0026 · api.md REQ-API-158)
  // 2026-09-22 · 40 → 41: `email_kind` 신설(마이그레이션 0027 · database.md §2.17)
  // 2026-09-27 · 41 → 42: `notification_level` 신설(마이그레이션 0035 · REQ-DB-028)
  // 2026-10-09 · 42 → 43: `claim_awaiting_kind` 신설(마이그레이션 0046 · REQ-DB-039)
  // 2026-10-10 · 43 → 44: `task_archive_reason` 신설(마이그레이션 0047 · REQ-DB-040)
  // 2026-10-15 · 44 → 45: `impl_status_source` 신설(마이그레이션 0051 · REQ-DB-044)
  // 2026-10-16 · 45 → 47: `watch_target` · `pin_target` 신설(마이그레이션 0056 · REQ-DB-051)
  // 2026-10-16 · 47 → 48: `review_sot` 신설(마이그레이션 0057 · 사람 결정 D6 · REQ-DB-052)
  it('48종이다', () => {
    expect(declaredEnums).toHaveLength(48);
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

  it('Task 축 상태 7종 · 문서 축 상태 6종 (spec-workflow §1.2·§1.4)', () => {
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
      // 버린 초안 — 변경 요청을 거절 · 철회하면 그 초안이 된다(2026-10-16 · 사람 결정 D1 의 세부)
      'discarded',
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
