// 공통 상수 — 정본: docs/04-mvp/codebase.md §3.2 (수치의 근거는 각 행의 문서)
// 값이 바뀌면 리스·하트비트·stale 규약이 통째로 어긋난다. 다른 값을 쓰면 결함이다(scope.md §3.5).

import { describe, expect, it } from 'vitest';
import {
  EVENTS_CHANNEL,
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
});
