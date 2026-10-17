// 아웃박스 → Slack 채널 (2026-10-17 · 사람 결정 D1 · database.md §2.18 · REQ-API-354)
//
// 메일 잡과 같은 모양이고 주기도 같다(하트비트 간격) — critical 이 채널에 닿기까지의 상한이 1분이다. 보내기 **직전에** 그 일이
// 받은 요청에서 이미 처리됐는지 다시 본다 — 처리된 일은 보내지 않는다(크로스 채널 dedup · spec-workflow §6.4). 파생 때 한 번
// 보고 넣었지만, 그 사이(최대 1분)에 사람이 웹에서 결정하면 채널에 이미 끝난 일이 올라간다.
import { Injectable } from '@nestjs/common';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { alreadyHandled } from '../../modules/event/handled.js';
import { SlackSender } from '../../modules/slack/slack.sender.js';
import { SlackService } from '../../modules/slack/slack.service.js';

@Injectable()
export class SlackJob {
  readonly name = 'slack';

  constructor(
    @InjectDb() private readonly db: NervDb,
    private readonly slack: SlackService,
    private readonly sender: SlackSender,
  ) {}

  /** 보낸 줄 수 — 키가 없는 배치에서는 큐를 들여다보지도 않는다 */
  async run(): Promise<number> {
    if (!this.slack.enabled) return 0;
    const due = await this.slack.claimDue();
    let sent = 0;
    for (const row of due) {
      if (await alreadyHandled(this.db, { type: row.event_type, subject_id: row.subject_id })) {
        await this.slack.markSkipped(row.id, 'handled');
        continue;
      }
      const url = await this.slack.webhookOf(row.project_id).catch(() => null);
      if (url === null) {
        await this.slack.markSkipped(row.id, 'disconnected');
        continue;
      }
      // **한 줄이 실패해도 나머지는 보낸다** — 한 프로젝트의 죽은 웹훅이 다른 프로젝트의 게시를 막지 않는다
      const result = await this.sender.post(url, row.body);
      if (result.kind === 'sent') {
        await this.slack.markSent(row.id);
        sent += 1;
      } else {
        await this.slack.markFailure(row, result.reason, {
          permanent: result.kind === 'rejected',
          afterSeconds: result.kind === 'retry' ? result.afterSeconds : null,
        });
      }
    }
    return sent;
  }
}
