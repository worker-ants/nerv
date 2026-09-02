// 잡 루프 — advisory lock 보유 시에만 6종을 각자의 주기로 돌린다 (E04-S04)
// 정본: codebase.md §2.2(잡 목록) · REQ-CB-011(단일 실행)
//
// **주기는 새 결정이 아니라 기존 상수에서 유도한다.** 리스 회수·stale 판정은 하트비트
// 간격(60초)보다 촘촘할 이유가 없다 — 그보다 빨리 돌아도 새로 만료될 것이 없기 때문이다.
// 반대로 그보다 느리면 회수가 하트비트 한 주기만큼 늦어진다. 그래서 둘 다 HEARTBEAT 간격이다.
//
// 잡 하나가 실패해도 나머지는 돈다. 워커의 잡은 서로 독립이고, 하나의 실패로 회수가 멈추면
// 그것이 곧 클레임 적체(D-13이 막으려는 상태)다.

import { Injectable, Logger } from '@nestjs/common';
import { HEARTBEAT_INTERVAL_SECONDS } from '@nerv/schema';
import { AdvisoryLock } from './advisory-lock.js';
import { EmbeddingJob } from './jobs/embedding.job.js';
import { ExportJob } from './jobs/export.job.js';
import { LeaseReaperJob } from './jobs/lease-reaper.job.js';
import { RetentionJob } from './jobs/retention.job.js';
import { NotificationJob } from './jobs/notification.job.js';
import { PartitionJob } from './jobs/partition.job.js';
import { SessionStaleJob } from './jobs/session-stale.job.js';

interface Scheduled {
  name: string;
  /**
   * 주기. **함수면 매 틱 다시 묻는다** — 임베딩만 그렇다(§2.2): 일감이 있으면 붙어서 돌고
   * 없으면 물러난다. 나머지 다섯은 상수이고, 상수인 편이 읽기 쉬우므로 그대로 둔다.
   */
  everyMs: number | (() => number);
  run: () => Promise<unknown>;
  /** 아직 한 번도 안 돈 상태 — null 이면 즉시 실행 대상이다(기동 직후 첫 틱이 그렇다) */
  lastRunAt: number | null;
}

@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private readonly schedule: Scheduled[];

  constructor(
    private readonly lock: AdvisoryLock,
    leaseReaper: LeaseReaperJob,
    sessionStale: SessionStaleJob,
    notification: NotificationJob,
    embedding: EmbeddingJob,
    retention: RetentionJob,
    exporter: ExportJob,
    partition: PartitionJob,
  ) {
    const heartbeat = HEARTBEAT_INTERVAL_SECONDS * 1000;
    this.schedule = [
      { name: leaseReaper.name, everyMs: heartbeat, run: () => leaseReaper.run(), lastRunAt: null },
      {
        name: sessionStale.name,
        everyMs: heartbeat,
        run: () => sessionStale.run(),
        lastRunAt: null,
      },
      // 알림은 Valkey 방송이 주 경로이고 이 잡은 유실 대비 폴백이다(api.md §3.3) —
      // 그래서 촘촘할 필요가 없고, 하트비트 간격이면 "놓친 알림"의 상한이 1분이 된다.
      {
        name: notification.name,
        everyMs: heartbeat,
        run: () => notification.run(),
        lastRunAt: null,
      },
      // 임베딩은 비싸고 급하지 않다. 저장 직후 수 초간 벡터 결과에 새 본문이 빠지는
      // 비대칭은 문서가 이미 수용했다(api.md §2.2b "인덱싱 시점").
      // **다만 밀려 있을 때는 급하다**(2026-08-28): 고정 5분 주기는 판당 20초씩이라 가동률이
      // 6.7% 였고 문서 140편을 채우는 데 몇 시간이 걸렸다. 그래서 이 잡만 주기가 변한다.
      {
        name: embedding.name,
        // 잡이 스스로 정한다 — 밀린 색인이 있으면 1초, 다 채웠으면 5분(§2.2 · REQ-CB-027)
        everyMs: () => embedding.everyMs,
        run: () => embedding.run(),
        lastRunAt: null,
      },
      // 보존 정책·미러는 하루 단위 작업이다 — 자주 돌 이유가 없고, 자주 돌면 삭제가
      // 사용자의 작업 시간과 겹친다. 1시간 주기로 두고 잡 내부가 날짜로 판정한다.
      {
        name: retention.name,
        everyMs: heartbeat * 60,
        run: () => retention.run(),
        lastRunAt: null,
      },
      { name: exporter.name, everyMs: heartbeat * 60, run: () => exporter.run(), lastRunAt: null },
      // 파티션은 **미래를 미리 만드는** 일이라 하루 한 번이면 충분하고, 그보다 드물면
      // 워커가 며칠 멈췄을 때 경계에 닿는다. 기동 직후 첫 틱에 한 번 도는 것이 중요하다 —
      // 그 한 번이 "마이그레이션만 하고 워커를 늦게 띄운" 배치를 구한다.
      {
        name: partition.name,
        everyMs: heartbeat * 60 * 24,
        run: () => partition.run(),
        lastRunAt: null,
      },
    ];
  }

  /** 한 틱. lock 이 없으면 아무것도 하지 않는다 — 그게 REQ-CB-011 의 실물이다. */
  async tick(now = Date.now()): Promise<string[]> {
    if (!(await this.lock.acquire())) return [];

    const ran: string[] = [];
    for (const job of this.schedule) {
      const everyMs = typeof job.everyMs === 'function' ? job.everyMs() : job.everyMs;
      if (job.lastRunAt !== null && now - job.lastRunAt < everyMs) continue;
      job.lastRunAt = now;
      try {
        await job.run();
        ran.push(job.name);
      } catch (error) {
        // 삼키지 않고 기록한다. 잡 하나의 실패가 루프 전체를 멈추면 안 된다.
        this.logger.warn(`잡 실패 [${job.name}] — ${String(error)}`);
      }
    }
    return ran;
  }

  jobNames(): string[] {
    return this.schedule.map((j) => j.name);
  }
}
