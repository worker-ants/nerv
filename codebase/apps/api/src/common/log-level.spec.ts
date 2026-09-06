// `NERV_LOG_LEVEL` — 전표가 소비자를 적으면 그것이 계약이다 (4.2 §5.2)
//
// 이 변수는 2026-09-06 까지 **읽는 코드가 0건**이었다. 전표는 소비자를 "api · worker" 라
// 적었고 compose·k8s 는 값을 넘기고 있었는데, 운영자가 그것을 바꿔도 아무 일이 일어나지
// 않았다 — 장애 때 로그를 늘릴 손잡이가 실은 없었다는 뜻이다.

import { describe, expect, it, vi } from 'vitest';
import { logLevelsFromEnv } from './log-level.js';

describe('NERV_LOG_LEVEL', () => {
  it('기본은 log — 지정이 없으면 verbose·debug 를 켜지 않는다', () => {
    expect(logLevelsFromEnv({})).toEqual(['log', 'warn', 'error', 'fatal']);
  });

  it('고른 수준과 **그보다 심각한 것**을 켠다 — warn 을 고른 사람은 오류도 보고 싶다', () => {
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: 'warn' })).toEqual(['warn', 'error', 'fatal']);
  });

  it('debug 는 위쪽까지 연다', () => {
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: 'debug' })).toContain('debug');
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: 'debug' })).not.toContain('verbose');
  });

  it('**`info` 를 받는다** — compose·k8s 가 이미 그 값을 넘기고 있다', () => {
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: 'info' })).toEqual(
      logLevelsFromEnv({ NERV_LOG_LEVEL: 'log' }),
    );
  });

  it.each([
    ['warning', 'warn'],
    ['trace', 'verbose'],
    ['critical', 'fatal'],
  ])('%s 는 %s 의 별칭이다 — 다른 스택에서 몸에 밴 이름을 받는다', (alias, canonical) => {
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: alias })).toEqual(
      logLevelsFromEnv({ NERV_LOG_LEVEL: canonical }),
    );
  });

  it('대소문자·공백을 흘려 받는다 — `.env` 는 사람이 손으로 쓴다', () => {
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: '  WARN ' })).toEqual(['warn', 'error', 'fatal']);
  });

  it('**모르는 값에 침묵하지 않는다** — 오타로 로그가 꺼지면 그 사실을 알려 줄 로그도 없다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(logLevelsFromEnv({ NERV_LOG_LEVEL: 'nonsense' })).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('빈 값은 오타가 아니다 — 경고 없이 기본으로 간다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logLevelsFromEnv({ NERV_LOG_LEVEL: '' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
