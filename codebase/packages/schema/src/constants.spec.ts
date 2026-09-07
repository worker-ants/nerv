// 공통 상수 — 정본: docs/04-mvp/codebase.md §3.2 (수치의 근거는 각 행의 문서)
// 값이 바뀌면 리스·하트비트·stale 규약이 통째로 어긋난다. 다른 값을 쓰면 결함이다(scope.md §3.5).

import { describe, expect, it } from 'vitest';
import { ko } from './i18n/ko.js';
import { en } from './i18n/en.js';
import { taskStatus } from './enums.js';
import {
  EVENTS_CHANNEL,
  isDelegationFilled,
  TASK_LEASE_BOUND_TARGETS,
  TASK_TRANSITION_TARGETS,
  HEARTBEAT_INTERVAL_SECONDS,
  LEASE_TTL_SECONDS,
  RATE_LIMIT_INGEST_PER_MIN,
  RATE_LIMIT_PAT_PER_MIN,
  RATE_LIMIT_WEB_PER_MIN,
  REVIEW_PROMPT_BLOB_TTL_DAYS,
  SESSION_STALE_SECONDS,
} from './constants.js';

describe('MVP 공통 상수', () => {
  it('리스 TTL 은 30분이다', () => {
    expect(LEASE_TTL_SECONDS).toBe(1800);
  });

  it('세션 stale 임계는 리스 TTL 과 같은 값이다 (D-13)', () => {
    expect(SESSION_STALE_SECONDS).toBe(LEASE_TTL_SECONDS);
  });

  it('하트비트는 60초 — 리스 TTL 의 30회분 여유다', () => {
    expect(HEARTBEAT_INTERVAL_SECONDS).toBe(60);
    expect(LEASE_TTL_SECONDS / HEARTBEAT_INTERVAL_SECONDS).toBe(30);
  });

  it('방송 채널은 nerv_events 다 (database.md §3)', () => {
    expect(EVENTS_CHANNEL).toBe('nerv_events');
  });

  it('쿼터 시작값은 api.md §1.8 과 같다', () => {
    expect(RATE_LIMIT_PAT_PER_MIN).toBe(300);
    expect(RATE_LIMIT_WEB_PER_MIN).toBe(600);
    expect(RATE_LIMIT_INGEST_PER_MIN).toBe(120);
  });

  it('리뷰 프롬프트 blob TTL 은 30일 — MVP 범위는 아니다', () => {
    expect(REVIEW_PROMPT_BLOB_TTL_DAYS).toBe(30);
  });

  // **전이 목표 어휘**(2026-09-07 · REQ-API-129~132) — 상수가 어휘와 어긋나면 표면이
  // 조용히 갈라진다: 도구 스키마는 받고 도메인은 거절하는(또는 그 반대의) 값이 생긴다.
  it('전이 목표는 상태 어휘의 부분집합이고 claimed 를 포함하지 않는다', () => {
    for (const target of TASK_TRANSITION_TARGETS) {
      expect(taskStatus.enumValues).toContain(target);
    }
    expect([...TASK_TRANSITION_TARGETS]).not.toContain('claimed');
    // 어휘 일곱에서 claimed 하나만 빠진다 — 그 밖의 상태가 조용히 사라지면 안 된다
    expect(TASK_TRANSITION_TARGETS.length).toBe(taskStatus.enumValues.length - 1);
  });

  it('리스 구속 목표는 전이 목표의 부분집합이다', () => {
    for (const target of TASK_LEASE_BOUND_TARGETS) {
      expect([...TASK_TRANSITION_TARGETS]).toContain(target);
    }
  });

  it('위임 명세 판정은 자리표시자를 빈 것으로 본다 — 두 로케일 모두', () => {
    expect(isDelegationFilled('목표')).toBe(true);
    expect(isDelegationFilled(null)).toBe(false);
    expect(isDelegationFilled('   ')).toBe(false);
    expect(isDelegationFilled(ko['import.delegation_missing'])).toBe(false);
    expect(isDelegationFilled(en['import.delegation_missing'])).toBe(false);
  });
});
