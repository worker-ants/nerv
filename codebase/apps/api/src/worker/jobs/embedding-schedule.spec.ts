// 임베딩 잡의 **주기가 변한다** — 일감이 있으면 붙어서 돌고 없으면 물러난다 (REQ-CB-027)
//
// 이 규칙이 틀리면 둘 중 하나가 된다: 밀린 색인이 몇 시간씩 안 끝나거나(고정 5분 — 실측된
// 예전 동작), 다 채운 뒤에도 초당 142 질의로 "바뀐 것 없음"만 확인하거나. 둘 다 조용해서
// 눈으로는 안 보인다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmbeddingJob } from './embedding.job.js';
import type { IndexReport } from '../../modules/spec/embedding.service.js';
import type { EmbeddingService } from '../../modules/spec/embedding.service.js';

const EMPTY: IndexReport = {
  versions_scanned: 3,
  chunks_embedded: 0,
  chunks_unchanged: 12,
  chunks_deleted: 0,
  versions_pruned: 0,
  stopped_early: false,
  error: null,
};

function jobReturning(report: Partial<IndexReport>): EmbeddingJob {
  const service = { runOnce: async () => ({ ...EMPTY, ...report }) } as unknown as EmbeddingService;
  return new EmbeddingJob(service);
}

const FIVE_MINUTES = 5 * 60 * 1000;

beforeEach(() => {
  delete process.env['NERV_EMBED_EVERY_MS'];
});
afterEach(() => {
  delete process.env['NERV_EMBED_EVERY_MS'];
});

describe('주기는 이번 판의 결과가 정한다', () => {
  it('기동 직후에는 빠르다 — 밀린 것이 있는지부터 확인한다', () => {
    expect(jobReturning({}).everyMs).toBe(1000);
  });

  it('적재했으면 붙어서 계속한다', async () => {
    const job = jobReturning({ chunks_embedded: 7 });
    await job.run();
    expect(job.everyMs).toBe(1000);
  });

  it('삭제만 했어도 일한 것이다 — 본문에서 사라진 절을 걷는 것도 색인 갱신이다', async () => {
    const job = jobReturning({ chunks_deleted: 2 });
    await job.run();
    expect(job.everyMs).toBe(1000);
  });

  it('시간 상한에서 끊겼으면 남은 일이 있다는 뜻이다', async () => {
    const job = jobReturning({ stopped_early: true });
    await job.run();
    expect(job.everyMs).toBe(1000);
  });

  it('할 일이 없으면 물러난다 — 다 채운 뒤 초당 142 질의를 돌리지 않는다', async () => {
    const job = jobReturning({});
    await job.run();
    expect(job.everyMs).toBe(FIVE_MINUTES);
  });

  it('오류면 물러난다 — 죽은 제공자를 1초마다 두드려도 같은 실패다', async () => {
    const job = jobReturning({ error: 'SPC-X — 임베딩 제공자가 30000ms 안에 응답하지 않았다' });
    await job.run();
    expect(job.everyMs).toBe(FIVE_MINUTES);
  });

  it('빠른 주기는 env 로 바꾼다', async () => {
    process.env['NERV_EMBED_EVERY_MS'] = '5000';
    const job = jobReturning({ chunks_embedded: 1 });
    await job.run();
    expect(job.everyMs).toBe(5000);
  });
});
