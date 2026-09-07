// 소급 적재 전용 경로 — 자연 키 대조 · 배치 upsert · 전이 검사 우회 · import.applied 이벤트
// 정본: docs/04-mvp/api.md §2.10 · docs/04-mvp/importer.md §3.2·§3.5
//
// 두 가지가 이 모듈에서만 다르다.
//  ① **워크플로우 전이 검사를 우회한다.** 소급 적재는 전이가 아니라 초기 적재다 — approved 버전을
//     승인 절차 없이 만들고 done Task 를 게이트 판정 없이 만든다. "모든 상태 전이는 Event 를
//     남긴다"(data-model §5.5-6)와 충돌하지 않는다: 전이가 없으므로 전이 이벤트도 없다.
//     우회가 **이 경로에서만** 열린다는 점이 대가이고, admin + import:write 가 그 문을 지킨다.
//  ② **무결성 제약은 그대로 받는다.** approved 본문 불변 트리거·UNIQUE (project_id, ref)·
//     partial unique 는 예외가 없다 — API 경유라 오히려 우회 불가능하다. 위반은 그 **항목**의
//     실패로 응답에 담기고 배치 전체를 되돌리지 않는다(REQ-API-018).

import { Injectable, Logger } from '@nestjs/common';
import { IMPORT_SPEC_IMPACT_UNKNOWN, NERV_EVENT, newId, text } from '@nerv/schema';
import { displayKey } from '@nerv/schema/keys';
import type {
  ImportBatchResult,
  ImportItemResult,
  ImportLinkBatchInput,
  ImportReviewBatchInput,
  ImportPreflightInput,
  ImportPreflightResult,
  ImportSpecBatchInput,
  ImportSpecItem,
  ImportTaskBatchInput,
} from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { EventService } from '../event/event.service.js';
import { ReviewService } from '../review/review.service.js';

interface Actor {
  userId: string;
  projectId: string;
}

/**
 * 임포트한 Task 의 위임 명세 자리에 들어가는 출처 표시.
 *
 * DDL 의 task_delegation_spec_ck 와 REQ-IMP-009 가 부딪히는 지점의 해법이다 —
 * 지어낸 목표·산출물을 넣는 대신 "원본에 없었다"는 사실을 적는다. 고정 문자열이라
 * 나중에 전수 식별·일괄 보정이 가능하다.
 */
export const IMPORTED_DELEGATION = text('import.delegation_missing');

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly events: EventService,
    // 리뷰 적재의 판정은 이 서비스가 갖는다 — 임포터는 번역만 한다(D-05)
    private readonly reviews: ReviewService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * EP-IMP-01 — 자연 키 충돌 사전 판정. **서버 쓰기 0.**
   * 재실행이 변경분만 보내게 하는 판정이다(§3.4) — 이것이 있어야 두 번째 실행의
   * 신규 생성 레코드가 0이 된다(성공 기준 0-7).
   */
  async preflight(actor: Actor, input: ImportPreflightInput): Promise<ImportPreflightResult> {
    const items: ImportPreflightResult['items'] = [];

    for (const item of input.items) {
      const { rows } = await this.db.execute<{
        spec_id: string;
        version_no: number;
        content_hash: string;
      }>(sql`
        SELECT s.id AS spec_id, sv.version_no, encode(sv.content_hash, 'hex') AS content_hash
          FROM spec s
          JOIN spec_version sv ON sv.id = s.current_version_id
         WHERE s.project_id = ${actor.projectId} AND s.key = ${item.natural_key}
      `);

      const existing = rows[0];
      const state =
        existing === undefined
          ? 'new'
          : existing.content_hash === item.content_hash
            ? 'unchanged'
            : 'changed';

      items.push({
        source_path: item.source_path,
        natural_key: item.natural_key,
        state,
        spec_id: existing?.spec_id ?? null,
        version_no: existing?.version_no ?? null,
      });
    }

    return { items };
  }

  /**
   * EP-IMP-02 — 스펙 배치 적재.
   *
   * 트랜잭션 단위가 kind 로 갈린다(§3.5): `structure` 는 트리 골격이라 배치 1건이 트랜잭션 1건,
   * `document` 는 **파일 1건 = 트랜잭션 1건**이다. 후자를 한 트랜잭션으로 묶으면 135개 중
   * 하나가 제약을 위반할 때 나머지 134개가 함께 되돌아간다 — 전수 임포트가 불가능해진다.
   */
  async applySpecs(actor: Actor, input: ImportSpecBatchInput): Promise<ImportBatchResult> {
    const results: ImportItemResult[] = [];

    if (input.kind === 'structure') {
      await this.db.transaction(async (tx) => {
        for (const item of input.items) {
          results.push(await this.upsertSpecNode(tx, actor, item));
        }
      });
    } else {
      for (const item of input.items) {
        try {
          const result = await this.db.transaction(async (tx) =>
            this.upsertSpecDocument(tx, actor, item),
          );
          results.push(result);
        } catch (error) {
          results.push(toError(item.source_path, error));
        }
      }
    }

    await this.emitApplied(actor, input.profile, input.root_commit, results);
    return summarize(results);
  }

  /** EP-IMP-03 — Task 배치. `ready` 는 스키마가 이미 거부한다(REQ-IMP-009). */
  async applyTasks(actor: Actor, input: ImportTaskBatchInput): Promise<ImportBatchResult> {
    const results: ImportItemResult[] = [];
    // 표시 키의 접두는 프로젝트 것이다(§5.1). 배치당 한 번만 읽는다 — 항목마다 읽을 이유가 없다.
    const { rows: project } = await this.db.execute<{ key: string }>(
      sql`SELECT key FROM project WHERE id = ${actor.projectId}`,
    );
    const projectKey = project[0]?.key ?? '';

    for (const item of input.items) {
      try {
        const result = await this.db.transaction(async (tx) => {
          const taskId = newId();
          // 형식은 §5.1 정본이고 씨앗만 다르다 — 경로에서 만들어야 재실행이 같은 키를 낸다(멱등).
          const key = displayKey(projectKey, 'T', item.source_path);

          const { rows: existing } = await tx.execute<{ id: string }>(
            sql`SELECT id FROM task WHERE project_id = ${actor.projectId} AND key = ${key}`,
          );
          if (existing[0] !== undefined) {
            // 멱등 — 이미 있으면 만들지 않는다(성공 기준 0-7).
            //
            // **다만 비어 있는 링크는 채운다**(2026-08-24). 임포터가 나중에 새 축을 채우게
            // 되면(여기서는 `source_spec_key`) 이미 적재된 행은 영영 그 값을 못 받는다 —
            // 재적재하려면 지우는 수밖에 없고, 그건 임포트를 다시 위험한 작업으로 만든다.
            // 규칙은 좁다: **NULL 인 자리만 채우고, 값이 있는 자리는 건드리지 않는다.**
            // 사람이 화면에서 고친 것을 임포트가 되돌리지 않는다는 뜻이다.
            if (item.source_spec_key != null) {
              const backfill = await this.currentVersionOf(tx, actor, item.source_spec_key);
              if (backfill !== null) {
                await tx.execute(sql`
                  UPDATE task SET source_spec_version_id = ${backfill}
                   WHERE id = ${existing[0].id} AND source_spec_version_id IS NULL
                `);
              }
            }
            return {
              source_path: item.source_path,
              status: 'skipped',
              task_id: existing[0].id,
            } as const;
          }

          const specVersionId =
            item.source_spec_key == null
              ? null
              : await this.currentVersionOf(tx, actor, item.source_spec_key);

          // 위임 명세 4요소 — DDL 의 task_delegation_spec_ck 는 backlog·blocked 밖의 모든
          // 상태에 4요소를 요구한다(4.3 §2.5). 그런데 임포트한 Task 에는 그 근거가 없다
          // (REQ-IMP-009 — 원본 plan 에는 위임 명세라는 개념 자체가 없다).
          //
          // 지어내지 않는다. **출처를 그대로 적는다** — 이 문자열이 "임포트로 들어왔고 원본에
          // 위임 명세가 없었다"는 사실의 기록이고, 나중에 grep 한 번으로 전수 식별된다.
          // 판정에 쓰이지 않는 자리(ready 승격은 이 경로로 오지 않는다)라 안전하다.
          const provenance =
            item.status === 'backlog' || item.status === 'blocked' ? null : IMPORTED_DELEGATION;

          await tx.execute(sql`
            INSERT INTO task (id, project_id, key, title, body_md, status, source_spec_version_id,
                              assignee_user_id, blocked_reason, done_at, spec_impact,
                              priority, created_at,
                              goal_md, output_format_md, tools_sources_md, boundaries_md)
            VALUES (${taskId}, ${actor.projectId}, ${key}, ${item.title}, ${item.body_md},
                    ${item.status}::task_status, ${specVersionId},
                    ${item.assignee_user_id ?? null}, ${item.blocked_reason ?? null},
                    ${
                      item.status === 'done'
                        ? sql`coalesce(${item.done_at ?? null}::timestamptz, now())`
                        : sql`NULL`
                    },
                    ${
                      // **지어 넣지 않는다**(2026-09-07 · REQ-IMP-028). 원본이 계산한 선언이
                      // 있으면 그것을 쓰고, 없으면 `{"unknown": true}` 다 — `{"none": true}` 는
                      // "영향 없음을 확인했다" 는 사람의 선언이라 임포터가 적으면 거짓 부정이다.
                      item.spec_impact != null
                        ? sql`${JSON.stringify(item.spec_impact)}::jsonb`
                        : item.status === 'done'
                          ? sql`${JSON.stringify(IMPORT_SPEC_IMPACT_UNKNOWN)}::jsonb`
                          : sql`NULL`
                    },
                    -- 미표기는 NULL 이다(0024) — P2 로 채우면 고른 적 없는 값이 고른 것으로 보인다
                    ${item.priority ?? null}::task_priority,
                    coalesce(${item.created_at ?? null}::timestamptz, now()),
                    ${provenance}, ${provenance}, ${provenance}, ${provenance})
          `);
          return { source_path: item.source_path, status: 'ok', task_id: taskId } as const;
        });
        results.push(result);
      } catch (error) {
        results.push(toError(item.source_path, error));
      }
    }

    await this.emitApplied(actor, input.profile, input.root_commit, results);
    return summarize(results);
  }

  /**
   * EP-IMP-04 — 관계·pending 링크.
   * **해소 실패는 오류가 아니라 skipped 다**(api.md §2.10) — 원본의 링크가 대상 저장소 밖을
   * 가리키는 것은 정상이고, 그것을 오류로 세면 리포트가 노이즈로 덮인다.
   */
  async applyLinks(actor: Actor, input: ImportLinkBatchInput): Promise<ImportBatchResult> {
    const results: ImportItemResult[] = [];

    await this.db.transaction(async (tx) => {
      for (const relation of input.relations) {
        const from = await this.specIdOf(tx, actor, relation.from_key);
        const to = await this.specIdOf(tx, actor, relation.to_key);
        const label = `${relation.from_key} → ${relation.to_key}`;

        if (from === null || to === null || from === to) {
          results.push({
            source_path: label,
            status: 'skipped',
            detail: text('import.spec_not_found'),
          });
          continue;
        }
        await tx.execute(sql`
          INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
          VALUES (${newId()}, ${actor.projectId}, ${from}, ${to}, ${relation.kind}::spec_relation_kind)
          ON CONFLICT DO NOTHING
        `);
        results.push({ source_path: label, status: 'ok' });
      }

      // ── pending: 요구사항 ↔ Task ────────────────────────────────────────
      //
      // **계약에는 있었고 아무도 채우지 않았다**(2026-08-24 정정). 임포터가 늘 빈
      // 배열을 보냈고 서버는 이 절이 아예 없어서, 커버리지의 "요구사항 → 작업" 축이
      // 언제나 0 이었다 — 화면은 0/739 라고 정직하게 그렸지만 그 0 은 사실이 아니라
      // **묻지 않은 것**이었다.
      //
      // Task 는 표시 키로 찾는다: 임포트는 `displayKey(projectKey, 'T', source_path)`
      // 로 키를 만들므로 같은 경로에서 같은 키가 나온다(§5.1 · 재실행 멱등의 축과 같다).
      const { rows: project } = await tx.execute<{ key: string }>(
        sql`SELECT key FROM project WHERE id = ${actor.projectId}`,
      );
      const projectKey = project[0]?.key ?? '';

      for (const link of input.pending) {
        const label = `${link.requirement_ref} → ${link.task_source_path}`;
        const { rows: requirement } = await tx.execute<{ id: string; spec_id: string }>(sql`
          SELECT r.id, r.spec_id FROM requirement r
            JOIN spec s ON s.id = r.spec_id
           WHERE s.project_id = ${actor.projectId} AND r.ref = ${link.requirement_ref}
             AND r.removed_in_version_id IS NULL
           LIMIT 1
        `);
        const target = requirement[0];
        if (target === undefined) {
          // 원본이 저장소 밖 ref 를 가리키는 것은 정상이다 — 오류가 아니라 skipped
          results.push({
            source_path: label,
            status: 'skipped',
            detail: text('import.requirement_not_found'),
          });
          continue;
        }

        const { rows: updated } = await tx.execute<{ id: string }>(sql`
          UPDATE task SET source_requirement_id = ${target.id}
           WHERE project_id = ${actor.projectId}
             AND key = ${displayKey(projectKey, 'T', link.task_source_path)}
          RETURNING id
        `);
        if (updated[0] === undefined) {
          results.push({
            source_path: label,
            status: 'skipped',
            detail: text('import.task_not_found'),
          });
          continue;
        }
        results.push({ source_path: label, status: 'ok', task_id: updated[0].id });
      }
    });

    await this.emitApplied(actor, input.profile, undefined, results);
    return summarize(results);
  }

  /** EP-IMP-05 — 자연 키 → UUID 맵. `nerv import rebuild-map` 의 소스다. */
  /**
   * EP-IMP-06 — 리뷰 세션 배치. **판정은 ReviewService 한 곳에 있다**(D-05) —
   * 임포터가 자기 적재 규칙을 따로 갖는 순간, 도구로 들어온 리뷰와 임포트된 리뷰가
   * 다른 규칙을 타고 게이트는 어느 쪽을 믿어야 하는지 답할 수 없게 된다.
   *
   * **한 항목의 실패가 배치를 되돌리지 않는다**(REQ-API-018) — 실패는 리포트로 간다.
   */
  async applyReviews(actor: Actor, input: ImportReviewBatchInput): Promise<ImportBatchResult> {
    const results: ImportItemResult[] = [];
    for (const item of input.items) {
      try {
        const out = await this.reviews.ingest({
          sourcePath: item.source_path,
          projectId: actor.projectId,
          userId: actor.userId,
          branch: item.branch,
          baseSha: item.base_sha,
          headSha: item.head_sha,
          changeset: item.changeset,
          kind: item.kind,
          reviewedAt: item.reviewed_at ?? null,
          block: item.block,
          reports: item.reports.map((r) => ({
            role: r.role,
            risk: r.risk,
            bodyMd: r.body_md ?? null,
          })),
          findings: item.findings.map((f) => ({
            severity: f.severity,
            title: f.title,
            body_md: f.detail_md ?? null,
            suggestion_md: f.suggestion_md ?? null,
            category: f.category === '' ? null : f.category,
            file: f.file ?? null,
            line: f.line ?? null,
            tags: f.tags,
          })),
        });
        results.push({ source_path: item.source_path, status: 'ok', spec_id: out.session_id });
      } catch (error) {
        results.push(toError(item.source_path, error));
      }
    }
    return summarize(results);
  }

  async map(actor: Actor): Promise<{ items: Record<string, unknown>[] }> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT 'spec' AS kind, s.key AS natural_key, s.id::text AS id,
             sv.version_no, encode(sv.content_hash, 'hex') AS content_hash
        FROM spec s LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE s.project_id = ${actor.projectId}
       UNION ALL
      SELECT 'task', t.key, t.id::text, NULL, NULL FROM task t WHERE t.project_id = ${actor.projectId}
       ORDER BY 1, 2
    `);
    return { items: rows };
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  private async upsertSpecNode(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    actor: Actor,
    item: ImportSpecItem,
  ): Promise<ImportItemResult> {
    const existing = await this.specIdOf(tx, actor, item.key);
    if (existing !== null) {
      return { source_path: item.source_path, status: 'skipped', spec_id: existing };
    }
    const parentId =
      item.parent_key == null ? null : await this.specIdOf(tx, actor, item.parent_key);
    const specId = newId();
    await tx.execute(sql`
      INSERT INTO spec (id, project_id, parent_id, type, key, title, sort_key)
      VALUES (${specId}, ${actor.projectId}, ${parentId}, ${item.type}::spec_type, ${item.key}, ${item.title}, ${item.sort_key})
    `);
    return { source_path: item.source_path, status: 'ok', spec_id: specId };
  }

  private async upsertSpecDocument(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    actor: Actor,
    item: ImportSpecItem,
  ): Promise<ImportItemResult> {
    let specId = await this.specIdOf(tx, actor, item.key);
    if (specId === null) {
      const node = await this.upsertSpecNode(tx, actor, item);
      specId = node.spec_id ?? null;
    }
    // eslint-disable-next-line no-restricted-syntax -- 내부 불변식 — 사람에게 보이지 않는다(REQ-CB-022)
    if (specId === null) throw new Error('스펙 노드를 만들지 못했습니다');

    const hash = createHash('sha256').update(item.body_md, 'utf8').digest('hex');

    // 멱등 — 같은 본문이면 새 버전을 만들지 않는다(§3.4 · 성공 기준 0-7)
    const { rows: same } = await tx.execute<{ id: string }>(sql`
      SELECT sv.id FROM spec_version sv
       WHERE sv.spec_id = ${specId} AND encode(sv.content_hash, 'hex') = ${hash}
    `);
    if (same[0] !== undefined) {
      return {
        source_path: item.source_path,
        status: 'skipped',
        spec_id: specId,
        spec_version_id: same[0].id,
      };
    }

    const { rows: last } = await tx.execute<{ max: number | null }>(
      sql`SELECT max(version_no) AS max FROM spec_version WHERE spec_id = ${specId}`,
    );
    const versionNo = Number(last[0]?.max ?? 0) + 1;
    const versionId = newId();

    // 전이 검사 우회 지점 — approved 를 승인 절차 없이 만든다(이 모듈에서만)
    await tx.execute(sql`
      INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash,
                                author_user_id, approved_at, approved_by_user_id)
      VALUES (${versionId}, ${specId}, ${versionNo}, ${item.doc_status}::spec_version_status,
              ${item.body_md}, decode(${hash}, 'hex'), ${actor.userId},
              ${item.doc_status === 'approved' ? sql`now()` : sql`NULL`},
              ${item.doc_status === 'approved' ? actor.userId : null})
    `);
    await tx.execute(sql`UPDATE spec SET current_version_id = ${versionId} WHERE id = ${specId}`);

    const refs: Record<string, string> = {};
    for (const requirement of item.requirements) {
      const reqId = newId();
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, acceptance_md,
                                 priority, impl_status,
                                 introduced_in_version_id, current_version_id)
        VALUES (${reqId}, ${actor.projectId}, ${specId}, ${requirement.ref}, ${requirement.text},
                ${requirement.acceptance_md},
                ${requirement.priority}::requirement_priority, ${requirement.impl_status}::impl_status,
                ${versionId}, ${versionId})
        ON CONFLICT (project_id, ref) DO UPDATE
          SET current_version_id = ${versionId},
              acceptance_md = COALESCE(EXCLUDED.acceptance_md, requirement.acceptance_md)
        RETURNING id
      `);
      const id = rows[0]?.id;
      if (id === undefined) continue;
      refs[requirement.ref] = id;

      // **버전 델타는 임포터가 만든다**(§2.5 규칙 7). 이 행이 없으면 스펙 비교 화면의
      // 요구사항 축이 통째로 비고, 조회는 본문 재파싱으로 물러난다(spec.service 의 델타 주석).
      await tx.execute(sql`
        INSERT INTO requirement_version (requirement_id, spec_version_id, change_kind,
                                         statement_md, ordinal)
        VALUES (${id}, ${versionId}, ${reqId === id ? 'added' : 'modified'}::change_kind,
                ${requirement.text}, ${requirement.ordinal})
        ON CONFLICT (requirement_id, spec_version_id) DO NOTHING
      `);
    }

    for (const evidence of item.evidence) {
      await tx.execute(sql`
        INSERT INTO evidence (id, project_id, spec_version_id, kind, locator, source)
        VALUES (${newId()}, ${actor.projectId}, ${versionId}, ${evidence.kind}::evidence_kind,
                ${evidence.locator}, 'human')
      `);
    }

    return {
      source_path: item.source_path,
      status: 'ok',
      spec_id: specId,
      spec_version_id: versionId,
      requirement_refs: refs,
    };
  }

  private async specIdOf(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    actor: Actor,
    key: string,
  ): Promise<string | null> {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM spec WHERE project_id = ${actor.projectId} AND key = ${key}`,
    );
    return rows[0]?.id ?? null;
  }

  private async currentVersionOf(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    actor: Actor,
    key: string,
  ): Promise<string | null> {
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT current_version_id AS id FROM spec
       WHERE project_id = ${actor.projectId} AND key = ${key}
    `);
    return rows[0]?.id ?? null;
  }

  /**
   * 배치당 이벤트 1건. **알림은 만들지 않는다**(api.md §3.3) — 감사(FR-16)와 화면 갱신용이다.
   * 전이 이벤트는 만들지 않는다: 전이가 없었기 때문이다.
   */
  private async emitApplied(
    actor: Actor,
    profile: string,
    rootCommit: string | undefined,
    results: ImportItemResult[],
  ): Promise<void> {
    const counts = summarize(results);
    await this.events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.IMPORT_APPLIED,
        projectId: actor.projectId,
        subjectType: 'project',
        subjectId: actor.projectId,
        actorUserId: actor.userId,
        isAgent: false,
        payload: {
          profile,
          root_commit: rootCommit ?? null,
          applied: counts.applied,
          errors: counts.errors,
          skipped: counts.skipped,
        },
      }),
    );
  }
}

function summarize(items: ImportItemResult[]): ImportBatchResult {
  return {
    applied: items.filter((i) => i.status === 'ok').length,
    errors: items.filter((i) => i.status === 'error').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    items,
  };
}

function toError(sourcePath: string, error: unknown): ImportItemResult {
  return {
    source_path: sourcePath,
    status: 'error',
    code: 'import_failed',
    detail: error instanceof Error ? error.message : String(error),
  };
}

/** 표시 키 — 자연 키(파일 경로)의 해시 앞자리. 파일 기반 번호 충돌을 원천 제거한다(D-04 말미). */
