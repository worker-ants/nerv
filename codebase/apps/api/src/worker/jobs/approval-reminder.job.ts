// 결재 리마인더 — 요청 뒤 4시간 · 1일에 한 번씩 (2026-10-11 · api.md REQ-API-296 · spec-workflow §2.6)
//
// 판정(어느 결재가 몇 번째 리마인더를 받을 때인가)은 결재 서비스에 있다 — 잡은 부르기만 한다(D-05). 받는 사람과
// 알림 묶음은 알림 라우팅(notification.job)이 정한다. 결과의 수는 잡 러너가 로그로 남긴다(REQ-CB-054).
import { Injectable } from '@nestjs/common';
import { ApprovalService } from '../../modules/approval/approval.service.js';

@Injectable()
export class ApprovalReminderJob {
  readonly name = 'approval-reminder';

  constructor(private readonly approvals: ApprovalService) {}

  run(): Promise<{ reminded: number }> {
    return this.approvals.remindDue();
  }
}
