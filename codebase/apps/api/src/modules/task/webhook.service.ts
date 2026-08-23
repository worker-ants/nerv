// GitHub 웹훅 → 증적 수집 (E14-S03 · FR-13)
//
// **웹훅은 판정하지 않는다.** PR 이 열렸다는 사실을 Task 에 증적으로 붙일 뿐, 그것으로
// 상태를 옮기거나 커버리지를 올리지 않는다 — 리뷰 커버리지 판정은 Phase 2 이고(FR-09),
// "무엇이 완료됐나"는 사람·게이트의 판단이다(§5.5 의 "증적 결손"이 그래서 의미를 갖는다).
//
// 연결 축은 **Task 키**다. 브랜치·제목·본문 어디에 있든 `TSK-xxxx` 를 찾으면 그 Task 에
// 붙인다 — 커밋 메시지 규약을 새로 만들지 않는 이유는, 규약이 늘수록 지켜지지 않기 때문이다.

import { Injectable, Logger } from '@nestjs/common';
import { msg, newId, NERV_ERROR, NERV_EVENT, text } from '@nerv/schema';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

/** 본문 어디에서든 Task 키를 찾는다 — 브랜치명·제목·설명 순으로 본다. */
const TASK_KEY_RE = /\bTSK-[A-Za-z0-9]{2,12}\b/;

export interface WebhookResult {
  ok: true;
  event: string;
  matched_task: string | null;
  evidence_id: string | null;
  /** 왜 아무것도 안 했는지 — 조용한 무시가 가장 나쁜 실패다 */
  skipped_reason: string | null;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * HMAC 검증 — GitHub 의 `X-Hub-Signature-256`.
   *
   * 시크릿이 설정돼 있지 않으면 **거부한다**. 검증 없는 웹훅 엔드포인트는 누구나
   * 증적을 만들 수 있는 문이고, 증적은 done 게이트의 입력이다(FR-10).
   */
  verifySignature(rawBody: string, signature: string | undefined): void {
    const secret = process.env['NERV_GITHUB_WEBHOOK_SECRET'] ?? '';
    if (secret === '') {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.webhook.no_secret'), {
        kind: 'webhook_secret_missing',
      });
    }
    if (signature === undefined || !signature.startsWith('sha256=')) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.webhook.no_signature'), {
        kind: 'signature_missing',
      });
    }
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    // 길이가 다르면 timingSafeEqual 이 던진다 — 길이 비교부터 상수 시간으로 다루지 않으면
    // 비교 자체가 정보를 흘린다.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.webhook.bad_signature'), {
        kind: 'signature_mismatch',
      });
    }
  }

  /** 페이로드에서 Task 키를 뽑는다 — 브랜치 → 제목 → 본문 순. */
  extractTaskKey(payload: Record<string, unknown>): string | null {
    const pr = (payload['pull_request'] ?? {}) as Record<string, unknown>;
    const head = (pr['head'] ?? {}) as Record<string, unknown>;
    const candidates = [
      typeof head['ref'] === 'string' ? head['ref'] : '',
      typeof pr['title'] === 'string' ? pr['title'] : '',
      typeof pr['body'] === 'string' ? pr['body'] : '',
      typeof payload['ref'] === 'string' ? payload['ref'] : '',
      ...(Array.isArray(payload['commits'])
        ? (payload['commits'] as Record<string, unknown>[]).map((c) =>
            typeof c['message'] === 'string' ? c['message'] : '',
          )
        : []),
    ];
    for (const candidate of candidates) {
      const match = TASK_KEY_RE.exec(candidate);
      if (match !== null) return match[0].toUpperCase();
    }
    return null;
  }

  /**
   * PR·push 웹훅 처리. 대응 Task 를 못 찾으면 **조용히 성공**하지 않고 사유를 돌려준다 —
   * GitHub 은 응답 본문을 배달 로그에 남기므로 그것이 곧 디버깅 경로다.
   */
  async handle(input: {
    projectId: string;
    event: string;
    payload: Record<string, unknown>;
  }): Promise<WebhookResult> {
    const { event, payload } = input;
    if (event !== 'pull_request' && event !== 'push') {
      return {
        ok: true,
        event,
        matched_task: null,
        evidence_id: null,
        skipped_reason: `수집 대상이 아닌 이벤트: ${event}`,
      };
    }

    const taskKey = this.extractTaskKey(payload);
    if (taskKey === null) {
      return {
        ok: true,
        event,
        matched_task: null,
        evidence_id: null,
        skipped_reason: text('webhook.skip.no_task_key'),
      };
    }

    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM task WHERE project_id = ${input.projectId} AND key = ${taskKey}
    `);
    const taskId = rows[0]?.id;
    if (taskId === undefined) {
      return {
        ok: true,
        event,
        matched_task: taskKey,
        evidence_id: null,
        skipped_reason: `${taskKey} 가 이 프로젝트에 없습니다.`,
      };
    }

    const repository = (payload['repository'] ?? {}) as Record<string, unknown>;
    const repo = typeof repository['full_name'] === 'string' ? repository['full_name'] : null;
    const { kind, locator } = this.locatorOf(event, payload);
    if (locator === null) {
      return {
        ok: true,
        event,
        matched_task: taskKey,
        evidence_id: null,
        skipped_reason: text('webhook.skip.no_locator'),
      };
    }

    return this.events.transact(async (tx, emit) => {
      // 같은 PR 이 여러 번 갱신돼도 증적은 하나다 — 웹훅은 재전송이 정상이다.
      const { rows: existing } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM evidence
         WHERE task_id = ${taskId} AND locator = ${locator} AND kind = ${kind}::evidence_kind
      `);
      const already = existing[0]?.id;
      if (already !== undefined) {
        return {
          ok: true as const,
          event,
          matched_task: taskKey,
          evidence_id: already,
          skipped_reason: text('webhook.skip.duplicate'),
        };
      }

      const evidenceId = newId();
      await tx.execute(sql`
        INSERT INTO evidence (id, project_id, task_id, kind, locator, repo, source)
        VALUES (${evidenceId}, ${input.projectId}, ${taskId}, ${kind}::evidence_kind,
                ${locator}, ${repo}, 'ci')
      `);

      await emit({
        type: NERV_EVENT.EVIDENCE_ADDED,
        projectId: input.projectId,
        subjectType: 'task',
        subjectId: taskId,
        actorUserId: null,
        isAgent: false,
        payload: { kind, locator, repo, via: 'github_webhook' },
      });

      this.logger.log(`증적 수집 — ${taskKey} ← ${kind} ${locator}`);
      return {
        ok: true as const,
        event,
        matched_task: taskKey,
        evidence_id: evidenceId,
        skipped_reason: null,
      };
    });
  }

  private locatorOf(
    event: string,
    payload: Record<string, unknown>,
  ): { kind: 'pr' | 'commit'; locator: string | null } {
    if (event === 'pull_request') {
      const pr = (payload['pull_request'] ?? {}) as Record<string, unknown>;
      return { kind: 'pr', locator: typeof pr['html_url'] === 'string' ? pr['html_url'] : null };
    }
    const after = payload['after'];
    return { kind: 'commit', locator: typeof after === 'string' && after !== '' ? after : null };
  }
}
