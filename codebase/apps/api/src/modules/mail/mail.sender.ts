// SMTP 로 내보내는 자리 — 여기 하나뿐이다 (2026-09-22 · 사람 결정 · scope.md §2.1)
//
// **nodemailer + SMTP 를 고른 이유**는 제공자를 갈아도 코드가 그대로이기 때문이다. 사내 메일
// 서버 · SES · Resend · Postmark 가 전부 같은 계약이고, 제공자 SDK 를 들이면 그 배치가 그
// 제공자에 묶인다. 반송(bounce) 처리처럼 SDK 가 있어야 하는 일이 생기는 날 다시 정한다.
//
// **전송기는 게으르게 만든다.** 모듈이 올라오는 것만으로 SMTP 에 붙지 않는다 — 메일이 꺼진
// 배치(대부분의 개발 기계)에서 기동이 네트워크를 기다릴 이유가 없다.
import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  mailDryRunFromEnv,
  mailFromFromEnv,
  mailReplyToFromEnv,
  smtpUrlFromEnv,
} from './mail.config.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
}

@Injectable()
export class MailSender {
  private readonly logger = new Logger(MailSender.name);
  private transport: Transporter | null = null;

  /** 보낼 수 있는가 — 잡이 매 틱 묻는다(운영 중 env 가 바뀌지는 않지만 판정을 한 곳에 둔다) */
  get enabled(): boolean {
    return smtpUrlFromEnv() !== null;
  }

  async send(mail: OutgoingMail): Promise<void> {
    const url = smtpUrlFromEnv();
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 오류다(REQ-CB-022 예외): 잡의 로그로만 나간다
    if (url === null) throw new Error('NERV_SMTP_URL 이 없습니다 — 보낼 수 없습니다.');

    // **마른 실행은 보내지 않고 남긴다.** 본문은 찍지 않는다 — 링크가 로그에 남으면 그
    // 로그를 읽을 수 있는 사람이 곧 그 초대를 수락할 수 있는 사람이 된다.
    if (mailDryRunFromEnv()) {
      this.logger.log(`[dry-run] ${mail.to} · ${mail.subject}`);
      return;
    }

    this.transport ??= createTransport(url);
    await this.transport.sendMail({
      from: mailFromFromEnv() ?? undefined,
      ...(mailReplyToFromEnv() === null ? {} : { replyTo: mailReplyToFromEnv() ?? undefined }),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html === null || mail.html === undefined ? {} : { html: mail.html }),
    });
  }
}
