// 메일 모듈 — 넣는 쪽(`MailOutbox`)과 내보내는 쪽(`MailSender`)을 함께 판다.
//
// API 는 넣기만 하고 워커는 내보내기만 하지만, 모듈을 가르지 않는다 — 둘은 같은 표의 두 면이고
// 나누면 "어느 쪽이 그 표의 주인인가" 가 매번 판단거리가 된다(D-05 의 정신).
import { Module } from '@nestjs/common';
import { MailOutbox } from './mail.outbox.js';
import { MailSender } from './mail.sender.js';

@Module({
  providers: [MailOutbox, MailSender],
  exports: [MailOutbox, MailSender],
})
export class MailModule {}
