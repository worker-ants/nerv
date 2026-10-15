// fail-open 격상과 해제 — 이벤트를 남기는 쪽 (2026-10-15 · 사람 결정 · Phase 2 E18-S02 · api.md REQ-API-319)
//
// 규칙(spec-workflow §4.6): 프로젝트 정책의 `failopen.window_hours` 안에 fail-open 이 `failopen.escalate_count` 회 이상이면
// 격상한다 — admin 에게 중요 알림 + S5 · S6 배너. 그 창 동안 새 fail-open 이 없으면 풀린다. 격상과 해제는 이벤트로 남긴다.
//
// **두 자리에서 본다.** fail-open 을 남긴 직후(플랜 승인 게이트 · done 게이트 — `afterFailopen`)와 워커 잡(`reconcile` —
// 하트비트 간격). 직후에 보는 것은 격상을 바로 알리려는 것이고, 잡이 보는 것은 시간이 지나 풀리는 것(이벤트가 생기지 않는
// 변화)과 직후의 확인이 실패했거나 정책이 바뀐 경우를 맞추려는 것이다. 판정은 둘 다 `failopenDue` 하나다.
//
// **한 번만 낸다.** 같은 프로젝트의 확인은 트랜잭션 advisory lock 으로 줄을 세우고, 잠근 뒤에 상태를 다시 읽는다 —
// 동시에 들어온 fail-open 둘이 각자 "아직 격상이 아니다" 를 읽고 격상을 두 번 내지 않는다. 락은 커밋할 때 풀리므로
// 뒤에 온 쪽은 앞의 격상 이벤트를 본다(READ COMMITTED — 문장마다 새 스냅샷).
//
// **fail-open 의 트랜잭션과 나눈다.** done 게이트의 fail-open 은 done 과 같은 트랜잭션이다. 격상 확인을 거기에 넣으면
// 확인이 실패할 때 done 까지 되돌아간다 — 판정하지 못하고 통과시킨 일이 기록 때문에 막히면 fail-open 의 뜻이 사라진다.
// 확인이 실패하면 운영 로그만 남기고, 다음 잡이 다시 본다.

import { Injectable, Logger } from '@nestjs/common';
import { NERV_EVENT_PHASE2, effectiveGatePolicy } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { EventService } from '../event/event.service.js';
import {
  failopenByGate,
  failopenDue,
  failopenPolicy,
  failopenStatus,
  failopenWindowStart,
} from './failopen.js';

@Injectable()
export class FailopenService {
  private readonly logger = new Logger(FailopenService.name);

  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * fail-open 을 남긴 **직후** — 격상할 때가 됐으면 격상한다. 풀기는 보지 않는다(방금 fail-open 이 있었다).
   * 실패해도 던지지 않는다: 부른 쪽은 이미 통과시켰고, 잡이 다시 본다.
   */
  async afterFailopen(projectId: string): Promise<void> {
    try {
      await this.settle(projectId, 'escalate');
    } catch (error) {
      this.logger.warn(`fail-open 격상 확인 실패 — project=${projectId}: ${String(error)}`);
    }
  }

  /**
   * 워커 잡 — 모든 프로젝트의 상태를 규칙에 맞춘다. 풀 때가 된 격상을 풀고, 격상할 때가 됐는데 아직 아닌 것을
   * 격상한다(직후의 확인이 실패했거나 정책의 기준을 낮춘 경우). 바꾼 프로젝트 수를 돌려준다.
   */
  async reconcile(now: number = Date.now()): Promise<number> {
    const { rows } = await this.db.execute<{ id: string; gate_policy: unknown }>(
      sql`SELECT id, gate_policy FROM project`,
    );
    let changed = 0;
    for (const { id, gate_policy } of rows) {
      // 잠그기 전에 한 번 거른다 — 할 일이 없는 프로젝트마다 트랜잭션을 열지 않는다
      const policy = effectiveGatePolicy(gate_policy).policy.failopen;
      const status = await failopenStatus(this.db, id, policy, now);
      const due = failopenDue(status);
      if (due === null) continue;
      try {
        if ((await this.settle(id, due)) !== null) changed += 1;
      } catch (error) {
        // 한 프로젝트의 실패가 나머지를 멈추지 않는다
        this.logger.warn(`fail-open 격상 상태 맞추기 실패 — project=${id}: ${String(error)}`);
      }
    }
    return changed;
  }

  /**
   * 잠그고 다시 읽은 뒤 할 일이 `want` 이면 그 이벤트를 남긴다. 남긴 것을 돌려준다(없으면 null).
   * `want` 를 받는 이유: 직후의 확인은 격상만 본다 — 해제는 시간이 지나야 생기는 일이다.
   */
  private async settle(
    projectId: string,
    want: 'escalate' | 'clear',
  ): Promise<'escalate' | 'clear' | null> {
    return this.events.transact(async (tx, emit) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`failopen:${projectId}`}, 0))`,
      );
      const now = Date.now();
      const policy = await failopenPolicy(tx, projectId);
      const status = await failopenStatus(tx, projectId, policy, now);
      if (failopenDue(status) !== want) return null;
      if (want === 'escalate') {
        await emit({
          type: NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED,
          projectId,
          subjectType: 'project',
          subjectId: projectId,
          actorUserId: null,
          isAgent: false,
          payload: {
            count: status.count,
            escalate_count: status.escalate_count,
            window_hours: status.window_hours,
            // 무엇이 판정하지 못했나 — 플랜 승인 게이트(`plan_approval`) · done 게이트(`done_gate`)마다의 수
            gates: await failopenByGate(
              tx,
              projectId,
              failopenWindowStart(policy.window_hours, now),
            ),
          },
        });
      } else {
        await emit({
          type: NERV_EVENT_PHASE2.GATE_FAILOPEN_CLEARED,
          projectId,
          subjectType: 'project',
          subjectId: projectId,
          actorUserId: null,
          isAgent: false,
          payload: {
            window_hours: status.window_hours,
            escalated_at: status.escalated_at,
          },
        });
      }
      return want;
    });
  }
}
