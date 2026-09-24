// 잡 한 판의 한 줄 (4.2 §5.5 · REQ-CB-054)

import type { Logger } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AdvisoryLock } from './advisory-lock.js';
import { JobRunner } from './job-runner.js';
import { jobLevel, jobMessage, summarizeJobResult } from './job-log.js';

describe('잡 결과 요약', () => {
  it('숫자 하나는 result 하나다 — 0 이면 일이 없던 판이다', () => {
    expect(summarizeJobResult(3)).toEqual({ fields: { result: 3 }, didWork: true });
    expect(summarizeJobResult(0)).toEqual({ fields: { result: 0 }, didWork: false });
  });

  it('보고서 객체는 수치·참거짓만 싣는다 — 경로·오류 문장은 줄을 불린다', () => {
    const summary = summarizeJobResult({
      root: '/var/nerv/export',
      projects: 2,
      files: 0,
      skipped: null,
      stopped_early: false,
    });
    expect(summary.fields).toEqual({ projects: 2, files: 0, stopped_early: false });
    expect(summary.didWork).toBe(true);
  });

  it('돌려주는 것이 없는 잡도 한 줄이다', () => {
    expect(summarizeJobResult(undefined)).toEqual({ fields: {}, didWork: false });
  });
});

describe('수준 — 소음 조절', () => {
  it('일을 한 판은 log, 할 일이 없던 판은 debug, 실패는 warn', () => {
    expect(jobLevel({ ok: true, result: 2 })).toBe('log');
    expect(jobLevel({ ok: true, result: 0 })).toBe('debug');
    expect(jobLevel({ ok: false, error: new Error('x') })).toBe('warn');
  });
});

describe('한 줄', () => {
  it('text 는 문장, json 은 필드', () => {
    expect(jobMessage('lease-reaper', 12, { ok: true, result: 3 })).toEqual({
      message: '잡 lease-reaper 12ms result=3',
      event: 'job',
      job: 'lease-reaper',
      duration_ms: 12,
      outcome: 'ok',
      result: 3,
    });
  });

  it('실패는 소요와 원인을 싣는다', () => {
    const message = jobMessage('mail', 40, { ok: false, error: new Error('SMTP 거절') });
    expect(message.message).toBe('잡 실패 [mail] 40ms — Error: SMTP 거절');
    expect(message).toMatchObject({ outcome: 'failed', job: 'mail', duration_ms: 40 });
  });
});

describe('JobRunner — 판마다 한 줄', () => {
  /** 이름·결과만 가진 가짜 잡 여덟 — 생성자 순서대로다 */
  function fakes(results: Record<string, () => Promise<unknown>>) {
    const names = [
      'lease-reaper',
      'session-stale',
      'notification',
      'embedding',
      'retention',
      'export',
      'partition',
      'mail',
    ];
    return names.map((name) => ({
      name,
      everyMs: 60_000,
      run: results[name] ?? (() => Promise.resolve(0)),
    }));
  }

  it('일을 한 판·빈 판·실패한 판이 각자의 수준으로 한 줄씩 — 실패가 루프를 멈추지 않는다', async () => {
    const lock = { acquire: () => Promise.resolve(true) } as unknown as AdvisoryLock;
    const jobs = fakes({
      'lease-reaper': () => Promise.resolve(2),
      mail: () => Promise.reject(new Error('SMTP 거절')),
    });
    // 잡 여덟은 이름·run 만 쓴다 — 생성자 모양만 맞춘다
    const Runner = JobRunner as unknown as new (...args: unknown[]) => JobRunner;
    const runner = new Runner(lock, ...jobs);
    const lines: { level: string; message: string }[] = [];
    const at = (level: string) => (message: { message: string }) =>
      lines.push({ level, message: message.message });
    Object.assign(runner, {
      logger: { log: at('log'), debug: at('debug'), warn: at('warn') } as unknown as Logger,
    });

    const ran = await runner.tick(0);
    expect(ran).toHaveLength(7); // 실패한 mail 만 빠진다
    expect(lines).toHaveLength(8);
    expect(lines.find((line) => line.message.startsWith('잡 lease-reaper'))?.level).toBe('log');
    expect(lines.find((line) => line.message.startsWith('잡 notification'))?.level).toBe('debug');
    expect(lines.find((line) => line.message.startsWith('잡 실패 [mail]'))?.level).toBe('warn');
  });
});
