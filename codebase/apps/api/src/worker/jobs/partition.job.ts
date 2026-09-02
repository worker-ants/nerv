// 월 파티션 선생성 — event · activity (database.md §2.14)
//
// **이 잡이 없으면 서버가 두 달 뒤에 멈춘다.** 0000 은 당월과 다음 달 파티션만 만들고,
// 문서와 SQL 주석은 그 뒤를 "nerv-worker 가 매일 1회 호출한다" 고 적어 두었는데 그 잡이
// 존재하지 않았다(실측 2026-09-02 — apps/api/src·packages/schema/src 전체에 partition
// 참조 0건). 마이그레이션을 적용한 달의 +2 개월 1일 00:00 이 되는 순간 `event`·`activity`
// INSERT 가 "no partition of relation … found for row" 로 실패하고, 이벤트는 도메인
// 트랜잭션 **안에서** 쓰이므로(REQ-CB-004) 스펙 승인·클레임·리뷰까지 전부 함께 롤백된다.
//
// 파티션은 없으면 만들고 있으면 두는 함수 하나로 보장된다(`nerv_ensure_month_partitions`,
// 전부 IF NOT EXISTS) — 그래서 이 잡은 몇 번을 돌아도 같은 결과다.

import { Injectable, Logger } from '@nestjs/common';
import { PARTITION_MONTHS_AHEAD } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

@Injectable()
export class PartitionJob {
  readonly name = 'partition';
  private readonly logger = new Logger(PartitionJob.name);

  constructor(@InjectDb() private readonly db: NervDb) {}

  /** 오늘부터 `PARTITION_MONTHS_AHEAD` 개월 뒤까지 보장한다. 돌려주는 값은 보장한 달 수다. */
  async run(): Promise<number> {
    const months = PARTITION_MONTHS_AHEAD;
    await this.db.execute(sql`
      SELECT nerv_ensure_month_partitions((current_date + (n || ' month')::interval)::date)
        FROM generate_series(0, ${months}) AS n
    `);
    return months + 1;
  }
}
