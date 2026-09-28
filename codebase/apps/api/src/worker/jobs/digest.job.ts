// 알림 메일 요약 잡 — 켠 사람에게 하루 한 번 (2026-09-28 · 사람 결정 EM1~EM9 · api.md REQ-API-232)
//
// 판정(누가 오늘 받을 때인가 · 무엇을 담는가)은 서비스에 있다 — 잡은 부르기만 한다(D-05). 결과의 수는 잡
// 러너가 로그로 남긴다(REQ-CB-054).
import { Injectable } from '@nestjs/common';
import { DigestService } from '../../modules/digest/digest.service.js';

@Injectable()
export class DigestJob {
  readonly name = 'digest';

  constructor(private readonly digests: DigestService) {}

  run(): Promise<{ checked: number; sent: number }> {
    return this.digests.sendDue();
  }
}
