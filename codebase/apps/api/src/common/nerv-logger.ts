// 로거 — Nest `ConsoleLogger` 에 요청 ID 를 붙인다 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-052)
//
// 전역 로거를 이것으로 바꾸면 `new Logger(ctx)` 로 만든 기존 로거 전부가 여기로 온다 —
// 서비스가 남기던 줄에 **손대지 않고** `[req=…]` 가 붙는다. 요청 밖(기동·워커 잡)에서는
// 아무것도 붙지 않는다.

import { ConsoleLogger } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import { currentRequestId } from './request-context.js';

/** `ConsoleLogger` 의 JSON 한 줄 + 요청 ID */
interface JsonLogObject {
  level: LogLevel;
  pid: number;
  timestamp: number;
  message: unknown;
  context?: string;
  stack?: unknown;
  req_id?: string;
}

export class NervLogger extends ConsoleLogger {
  protected override formatContext(context: string): string {
    const base = super.formatContext(context);
    const id = currentRequestId();
    return id === null ? base : `${base}[req=${id}] `;
  }

  protected override getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
    },
  ): JsonLogObject {
    const object = super.getJsonLogObject(message, options);
    const id = currentRequestId();
    return id === null ? object : { ...object, req_id: id };
  }
}
