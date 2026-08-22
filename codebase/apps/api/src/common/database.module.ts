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

export type NervDb = NodePgDatabase<Record<string, never>>;

export const NERV_DB = Symbol('NERV_DB');
export const NERV_PG_POOL = Symbol('NERV_PG_POOL');

/** 도메인 서비스에 주입하는 데코레이터 — 토큰 문자열을 흩뿌리지 않는다. */
export const InjectDb = (): ParameterDecorator => Inject(NERV_DB);

function connectionString(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
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
    this.logger.log('Postgres 풀을 닫았습니다');
  }
}
