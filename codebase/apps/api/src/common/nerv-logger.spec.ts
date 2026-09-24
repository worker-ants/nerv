// 로거 — 요청 ID 와 형식 (4.2 §5.5 · REQ-CB-052·053)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { logFormatFromEnv, NervLogger, nervLoggerFromEnv } from './nerv-logger.js';
import { requestContext } from './request-context.js';

/** stdout·stderr 에 쓰인 것을 모은다 — 로거가 실제로 찍은 바이트다 */
function captureOutput(): string[] {
  const written: string[] = [];
  const sink = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, 'write').mockImplementation(sink);
  vi.spyOn(process.stderr, 'write').mockImplementation(sink);
  return written;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NERV_LOG_FORMAT', () => {
  it('비면 text — 개발 루프는 사람이 읽는다', () => {
    expect(logFormatFromEnv({})).toBe('text');
    expect(logFormatFromEnv({ NERV_LOG_FORMAT: '' })).toBe('text');
  });

  it('json 을 받는다 — 대소문자와 공백은 따지지 않는다', () => {
    expect(logFormatFromEnv({ NERV_LOG_FORMAT: 'json' })).toBe('json');
    expect(logFormatFromEnv({ NERV_LOG_FORMAT: ' JSON ' })).toBe('json');
  });

  it('**모르는 값에 침묵하지 않는다** — 기본으로 떨어지되 한 줄 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(logFormatFromEnv({ NERV_LOG_FORMAT: 'yaml' })).toBe('text');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NERV_LOG_FORMAT="yaml"'));
  });
});

describe('json — 한 줄에 JSON 하나 (REQ-CB-053)', () => {
  it('한 줄이고 색 코드가 없으며, 요청 안이면 req_id 가 붙는다', () => {
    const written = captureOutput();
    const logger = nervLoggerFromEnv({ NERV_LOG_FORMAT: 'json' });
    requestContext.run({ requestId: 'req-json-0001' }, () => {
      logger.warn('감사 이벤트를 남기지 못했다', 'AuthService');
    });
    expect(written).toHaveLength(1);
    const line = written[0] ?? '';
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd()).not.toContain('\n');
    // eslint-disable-next-line no-control-regex -- ANSI 색 코드(ESC)가 없는지 센다
    expect(line).not.toMatch(/\u001b\[/);
    expect(JSON.parse(line)).toMatchObject({
      level: 'warn',
      message: '감사 이벤트를 남기지 못했다',
      context: 'AuthService',
      req_id: 'req-json-0001',
    });
  });

  it('구조화 메시지는 필드를 최상위에 펼치고, 고정 키는 덮지 못한다', () => {
    const written = captureOutput();
    const logger = nervLoggerFromEnv({ NERV_LOG_FORMAT: 'json' });
    requestContext.run({ requestId: 'req-json-0002' }, () => {
      logger.log(
        { message: 'GET /x 200 3ms', status: 200, level: 'fatal', req_id: 'forged' },
        'Access',
      );
    });
    const object = JSON.parse(written[0] ?? '') as Record<string, unknown>;
    expect(object).toMatchObject({
      level: 'log',
      message: 'GET /x 200 3ms',
      status: 200,
      context: 'Access',
      req_id: 'req-json-0002',
    });
  });

  it('요청 밖(워커·기동)에서는 req_id 가 없다', () => {
    const written = captureOutput();
    nervLoggerFromEnv({ NERV_LOG_FORMAT: 'json' }).log('잡 루프 lock 획득', 'AdvisoryLock');
    expect(JSON.parse(written[0] ?? '')).not.toHaveProperty('req_id');
  });

  it('오류의 스택은 stack 필드로 간다 — 줄은 여전히 하나다', () => {
    const written = captureOutput();
    const error = new Error('boom');
    nervLoggerFromEnv({ NERV_LOG_FORMAT: 'json' }).error('처리되지 않은 예외', error.stack);
    expect(written).toHaveLength(1);
    const object = JSON.parse(written[0] ?? '') as Record<string, unknown>;
    expect(object['message']).toBe('처리되지 않은 예외');
    expect(String(object['stack'])).toContain('Error: boom');
  });
});

describe('text — 사람이 읽는 모양', () => {
  it('구조화 메시지는 문장만 찍는다 — 객체를 펼치지 않는다', () => {
    const written = captureOutput();
    new NervLogger({ colors: false }).log({ message: 'GET /x 200 3ms', status: 200 }, 'Access');
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('[Access] GET /x 200 3ms');
    expect(written[0]).not.toContain('status');
  });
});

describe('NervLogger — 요청 안의 줄에 요청 ID', () => {
  class Probe extends NervLogger {
    contextOf(name: string): string {
      return this.formatContext(name);
    }
  }

  it('요청 밖에서는 붙이지 않는다', () => {
    expect(new Probe({ colors: false }).contextOf('Task')).toBe('[Task] ');
  });

  it('요청 안에서는 컨텍스트 뒤에 붙인다 — 서비스 코드는 모른다', () => {
    const probe = new Probe({ colors: false });
    const line = requestContext.run({ requestId: 'req-0001' }, () => probe.contextOf('Task'));
    expect(line).toBe('[Task] [req=req-0001] ');
  });
});
