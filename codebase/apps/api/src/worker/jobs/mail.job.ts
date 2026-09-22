// 아웃박스 → SMTP (2026-09-22 · 사람 결정 · database.md §2.17)
//
// 여덟 번째 잡이다. **주기는 새로 정하지 않고** 하트비트 간격에서 가져온다 — 잡 루프의
// 규약이고(§2.2), 그러면 "보내기까지의 상한" 이 1분이 된다. 사람이 초대를 만들고 상대가
// 메일함을 여는 시간보다 짧다.
//
// 한 틱에 한 묶음만 집는다. 밀린 큐를 한 번에 비우려 들면 메일 서버의 속도 제한에 걸리고,
// 그때 실패한 줄들이 전부 백오프로 물러나 오히려 더 늦게 나간다.
import { Injectable, Logger } from '@nestjs/common';
import { MailOutbox } from '../../modules/mail/mail.outbox.js';
import { MailSender } from '../../modules/mail/mail.sender.js';

@Injectable()
export class MailJob {
  readonly name = 'mail';
  private readonly logger = new Logger(MailJob.name);

  constructor(
    private readonly outbox: MailOutbox,
    private readonly sender: MailSender,
  ) {}

  /** 보낸 통 수 — 꺼진 배치에서는 큐를 들여다보지도 않는다 */
  async run(): Promise<number> {
    if (!this.sender.enabled) return 0;
    const due = await this.outbox.claimDue();
    let sent = 0;
    for (const mail of due) {
      try {
        await this.sender.send({
          to: mail.to_email,
          subject: mail.subject,
          text: mail.body_text,
          html: mail.body_html,
        });
        await this.outbox.markSent(mail);
        sent += 1;
      } catch (error) {
        // **한 통이 실패해도 나머지는 보낸다.** 주소 하나가 틀렸다고 그 배치의 메일이
        // 전부 멈추면, 그것이 곧 "초대가 안 온다" 의 원인이 된다.
        await this.outbox.markFailure(mail, error instanceof Error ? error.message : String(error));
      }
    }
    return sent;
  }
}
