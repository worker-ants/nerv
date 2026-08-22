// 만료 리스 회수 — claimed → ready (D-13 · FR-06)
//
// 워커 잡도 도메인 서비스를 거친다 — 회수 규칙이 API 와 두 벌이 되지 않게(D-05).
// 클레임 경로도 겹침 검사 전에 같은 메서드를 부른다(spec-workflow §4.3 단계 1):
// 죽은 세션의 리스가 살아 있는 척하면 멀쩡한 클레임이 막힌다.
import { Injectable, Logger } from '@nestjs/common';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { ClaimService } from '../../modules/task/claim.service.js';

@Injectable()
export class LeaseReaperJob {
  readonly name = 'lease-reaper';
  private readonly logger = new Logger(LeaseReaperJob.name);

  constructor(
    private readonly claims: ClaimService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  async run(): Promise<number> {
    const reclaimed = await this.db.transaction(async (tx) => this.claims.reclaimExpired(tx));
    if (reclaimed > 0) this.logger.log(`만료 리스 ${reclaimed}건 회수 — Task 를 ready 로 되돌렸다`);
    return reclaimed;
  }
}
