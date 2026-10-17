// Slack Incoming Webhook 으로 보낸다 — SDK 없이 fetch 하나 (2026-10-17 · 사람 결정 D1 · 메일 · 임베딩과 같은 선례)
//
// 웹훅은 `{"text": …}` 를 POST 하면 200 `ok` 로 답한다. 실패의 갈래는 셋이다 — 다시 보내면 될 것(네트워크 · 5xx), 기다렸다
// 보낼 것(429 · `Retry-After`), 다시 보내도 같은 것(그 밖의 4xx — 지운 웹훅 404 · 보관한 채널 410 · 잘못된 주소 403). 셋째는
// 바로 포기하고 이유를 남긴다: 죽은 웹훅을 한 시간 동안 두드려도 결과는 같다.
import { Injectable } from '@nestjs/common';
import { SLACK_SEND_TIMEOUT_MS } from '@nerv/schema';

export type SlackPostResult =
  | { kind: 'sent' }
  | { kind: 'retry'; reason: string; afterSeconds: number | null }
  | { kind: 'rejected'; reason: string; status: number };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

@Injectable()
export class SlackSender {
  /** 단위 시험이 가짜 fetch 를 넣는 자리 — 운영과 L2 는 전역 fetch 다(생성자 인자로 두면 DI 가 풀려 든다) */
  fetcher: FetchLike = (url, init) => fetch(url, init);

  async post(url: string, body: string): Promise<SlackPostResult> {
    let res: Response;
    try {
      res = await this.fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body }),
        signal: AbortSignal.timeout(SLACK_SEND_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        kind: 'retry',
        reason: error instanceof Error ? error.message : String(error),
        afterSeconds: null,
      };
    }
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if (res.ok) return { kind: 'sent' };
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      return {
        kind: 'retry',
        reason: `HTTP 429 ${detail}`.trim(),
        afterSeconds: Number.isFinite(after) && after > 0 ? after : null,
      };
    }
    if (res.status >= 500)
      return { kind: 'retry', reason: `HTTP ${res.status} ${detail}`.trim(), afterSeconds: null };
    return { kind: 'rejected', reason: `HTTP ${res.status} ${detail}`.trim(), status: res.status };
  }
}
