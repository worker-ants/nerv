// 결재 SLA — 만료(T+7d) · 지연(T+2d) · 리마인더(T+4h · T+1d) (spec-workflow §2.6 · api.md REQ-API-296 · 304 · 305)
//
// 판정(어느 결재가 만료 · 지연 · 몇 번째 리마인더를 받을 때인가)은 결재 서비스에 있다 — 잡은 부르기만 한다(D-05). 받는
// 사람과 알림 묶음은 알림 라우팅(notification.job)이 정한다. 결과의 수는 잡 러너가 로그로 남긴다(REQ-CB-054). 이름은
// 리마인더만 하던 때(2026-10-11)의 것을 그대로 둔다 — 로그와 운영 문서가 이 이름으로 잡을 찾는다.
import { Injectable } from '@nestjs/common';
import { ApprovalService } from '../../modules/approval/approval.service.js';

@Injectable()
export class ApprovalReminderJob {
  readonly name = 'approval-reminder';

  constructor(private readonly approvals: ApprovalService) {}

  run(): Promise<{ expired: number; escalated: number; reminded: number }> {
    return this.approvals.slaDue();
  }
}
