// 승인함 — 결정 · 지시자≠승인자 검사 (D-06)
// 정본: docs/03-proposal/spec-workflow.md §2.5·§6.4
//
// spec:approve · approval:decide 는 토큰에 부여 자체가 불가능한 사람 전용 스코프다 —
// 어느 표면에도 대응 MCP 도구가 없고, A4 요청에는 NERV_HUMAN_ONLY + 웹 딥링크가 돌아간다.
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

@Injectable()
export class ApprovalService {
  constructor(private readonly events: EventService) {}

  /** 승인 요청 생성 — pending Approval 재사용(카드 중복 금지) */
  request(): never {
    throw new NotImplementedYetError('E13-S01', '승인 요청 생성');
  }

  /** EP-APR-03 — 사람 전용 결정. 지시자≠승인자 위반은 NERV_FORBIDDEN */
  decide(): never {
    throw new NotImplementedYetError('E13-S01', '승인 결정');
  }
}
