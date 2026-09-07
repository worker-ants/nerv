// 만료 리스 회수 — claimed → ready (D-13 · FR-06)
//
// 워커 잡도 도메인 서비스를 거친다 — 회수 규칙이 API 와 두 벌이 되지 않게(D-05).
// 클레임 경로도 겹침 검사 전에 같은 메서드를 부른다(spec-workflow §4.3 단계 1):
// 죽은 세션의 리스가 살아 있는 척하면 멀쩡한 클레임이 막힌다.
import { Injectable, Logger } from '@nestjs/common';
import { EventService } from '../../modules/event/event.service.js';
import { ClaimService } from '../../modules/task/claim.service.js';

@Injectable()
export class LeaseReaperJob {
  readonly name = 'lease-reaper';
  private readonly logger = new Logger(LeaseReaperJob.name);

  constructor(
    private readonly claims: ClaimService,
    private readonly events: EventService,
  ) {}

  /**
   * **회수도 상태 전이라 이벤트를 남긴다**(2026-09-07 · REQ-API-127). 그래서 트랜잭션을
   * `EventService.transact` 로 연다 — 커밋 후 발행까지 그 안에서 끝난다(REQ-CB-004).
   */
  async run(): Promise<number> {
    const reclaimed = await this.events.transact(async (tx, emit) =>
      this.claims.reclaimExpired(tx, emit),
    );
    if (reclaimed.length > 0) {
      this.logger.log(`만료 리스 ${reclaimed.length}건 회수 — Task 를 ready 로 되돌렸다`);
    }
    return reclaimed.length;
  }
}
