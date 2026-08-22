// 만료 리스 회수 — claimed → ready (D-13 · FR-06)
import { Injectable } from '@nestjs/common';
import { ClaimService } from '../../modules/task/claim.service.js';

@Injectable()
export class LeaseReaperJob {
  readonly name = 'lease-reaper';
  constructor(private readonly claims: ClaimService) {}

  /** 워커 잡도 도메인 서비스를 거친다 — 회수 규칙이 두 벌이 되지 않게(D-05). */
  run(): never {
    return this.claims.reapExpired();
  }
}
