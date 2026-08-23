// DB 커넥션 provider.
//
// ※ codebase.md §2.2 의 트리에는 이 파일이 없다. 그런데 도메인 서비스는 전부 DB 핸들이
//   필요하고 문서는 그 핸들이 어디 사는지 정하지 않았다 — 표면·모듈 경계는 정해져 있는데
//   접속 계층만 빈칸이다. 전역 모듈 하나로 세우고 여기 기록을 남긴다.
//
// 규약 두 가지를 이 파일이 진다.
//   ① 스키마 선언은 @nerv/schema 에서만 온다(REQ-CB-006) — 여기서 재선언하지 않는다
//   ② 표면(컨트롤러·게이트웨이·도구)은 이 토큰을 주입받지 않는다(REQ-CB-003) —
//      저장 계층 접근은 도메인 서비스에서만. lint 가 표면의 drizzle import 를 막는다.

import { Global, Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type NervDb = NodePgDatabase<Record<string, unknown>>;

/**
 * 드라이버 경계 정규화 — raw `execute()` 의 timestamptz 는 **문자열로 온다**.
 *
 * drizzle 의 node-postgres 드라이버가 pg 의 타입 파서를 덮어써서, 테이블 선언을 거친
 * 질의는 Date 를 주지만 raw sql 질의는 문자열을 준다(실측). 서비스가 Date 를 반환한다고
 * 타입에 적어두면 그 타입은 거짓말이 되고, 호출부의 .toISOString() 이 런타임에 터진다.
 * 경계에서 한 번 정규화한다.
 */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  throw new TypeError(`시각으로 해석할 수 없는 값: ${String(value)}`);
}

export const NERV_DB = Symbol('NERV_DB');
export const NERV_PG_POOL = Symbol('NERV_PG_POOL');

/** 도메인 서비스에 주입하는 데코레이터 — 토큰 문자열을 흩뿌리지 않는다. */
export const InjectDb = (): ParameterDecorator => Inject(NERV_DB);

function connectionString(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    // eslint-disable-next-line no-restricted-syntax -- 설정 오류(REQ-CB-022)
    throw new Error('DATABASE_URL 이 없습니다 (.env 전표 — codebase.md §5.2)');
  }
  return url;
}

@Global()
@Module({
  providers: [
    {
      provide: NERV_PG_POOL,
      useFactory: (): pg.Pool => new pg.Pool({ connectionString: connectionString() }),
    },
    {
      provide: NERV_DB,
      inject: [NERV_PG_POOL],
      useFactory: (pool: pg.Pool): NervDb => drizzle(pool),
    },
  ],
  exports: [NERV_DB, NERV_PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(NERV_PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
    this.logger.log('Postgres 풀을 닫았습니다');
  }
}
