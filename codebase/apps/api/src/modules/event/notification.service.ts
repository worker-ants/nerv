// event → notification 라우팅 (중요도 티어·수신자 산출)
// 정본: docs/03-proposal/spec-workflow.md §6.2~6.3

import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class NotificationService {
  route(): never {
    throw new NotImplementedYetError('E13-S03', '인앱 알림 라우팅');
  }
}
