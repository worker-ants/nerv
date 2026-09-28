// 알림 메일 요약 — 설정 표면과 워커가 같은 서비스를 쓴다(D-05)
//
// 받은 요청의 판정(결정 대기 수)을 빌려 오므로 `ApprovalModule` 에 기대고, 그 모듈이 `EventModule` 에 기대므로
// 이벤트 모듈 안에 두면 고리가 생긴다 — 그래서 따로 둔다.
import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module.js';
import { MailModule } from '../mail/mail.module.js';
import { DigestController } from './digest.controller.js';
import { DigestService } from './digest.service.js';

@Module({
  imports: [ApprovalModule, MailModule],
  controllers: [DigestController],
  providers: [DigestService],
  exports: [DigestService],
})
export class DigestModule {}
