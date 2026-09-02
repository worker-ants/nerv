// 스펙 도메인 서비스 — 상태 전이·게이트 판정의 단일 구현 (D-05 · REQ-CB-003)
//
// SpecVersion 은 **불변 스냅샷**이다. 가변인 구간은 draft 하나뿐이고, in_review 진입 시점에
// 본문이 동결된다(spec-workflow §1.2) — DB 트리거가 그것을 최종 강제한다(4.3 §2.13).
// 승인된 버전을 고치는 유일한 경로는 새 draft 를 만드는 것이다.
//
// 에이전트는 **draft 까지만** 만들 수 있다. spec:approve 는 어떤 자율성 설정에서도 사람 전용이고
// 카탈로그에 대응 도구가 처음부터 없다(agent-integration §2.1 원칙 3).

import { Injectable, Logger } from '@nestjs/common';
import {
  canCreateSpecType,
  msg,
  newId,
  text,
  LEASE_HEARTBEAT_GRACE_SECONDS,
  LEASE_TTL_SECONDS,
  NERV_ERROR,
  NERV_EVENT,
} from '@nerv/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { sqlSeconds } from '../../common/sql-array.js';
import { entityRef } from '../../common/entity-ref.js';
import { InjectDb, toDate } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { decideGate, inferAxes } from './gate-tier.js';
import type { GateDecision } from './gate-tier.js';
import { SpecCheckService } from './spec-check.service.js';
import type { CheckResult } from './spec-check.service.js';
import { readerHash } from './reader-hash.js';
import { requirementsOf, specDelta } from './spec-delta.js';
import { SpecRelationService } from './spec-relation.service.js';
import type { RelationSyncResult } from './spec-relation.service.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

export interface SpecTreeNode extends Record<string, unknown> {
  id: string;
  key: string;
  title: string;
  type: string;
  parent_id: string | null;
  sort_key: string;
  doc_status: string | null;
  version_no: number | null;
  /** 보관 시각 — `include_archived` 로 받아 온 목록에서 **어느 것이 보관된 것인지** 화면이 갈라야 한다 */
  archived_at: string | null;
}

export interface DraftUpsertInput {
  projectId: string;
  /** 기존 스펙에 이어쓰기면 지정. 없으면 새 스펙을 만든다 */
  specId?: string | null;
  /** 주체의 역할 — **생성 가능한 타입**을 가른다(EP-SPEC-07 의 ● / ○) */
  roles?: readonly string[];
  /** 새 스펙 생성 시의 메타 — 기존 spec 에 다른 값이 오면 409(api.md §4) */
  key?: string;
  title?: string;
  type?: string;
  parentId?: string | null;
  bodyMd: string;
  /**
   * 무엇을 왜 바꿨나 — 버전 행에 남는 유일한 사람 말이다.
   *
   * **주지 않으면 앞의 것을 지우지 않는다.** draft 는 여러 번 덮어써지는데, 요약 없는
   * 저장이 앞의 요약을 지우면 마지막 자동 저장 하나가 이력을 비운다.
   */
  changeSummary?: string | undefined;
  /**
   * 선언 관계(`refines`·`depends_on`·`duplicates`·`supersedes`) — 저장 한 번에 확정한다.
   *
   * **주지 않으면 건드리지 않는다.** 본문만 고치는 저장이 매번 관계를 쓸어버리면
   * 아무도 관계를 선언하지 않게 된다. 빈 배열은 "전부 지워라"다.
   * `references` 는 여기 넣지 못한다 — 본문의 링크가 그것의 주인이다.
   */
  relations?: readonly { to: string; kind: string; baseHash?: string | undefined }[] | undefined;
  /**
   * **내가 보고 쓴 본문의 지문**(`nerv_spec_get` 응답의 `content_hash`).
   *
   * 기존 문서를 고칠 때는 **필수이자 유일한** 전제조건이다(2026-08-30 — 사람 결정).
   * 지문은 내용이 바뀌면 함께 바뀐다 — 버전 id 는 초안이 같은 행을 덮어쓰는 동안
   * 변하지 않아 "무엇을 보고 썼는가"를 식별하지 못했다.
   */
  baseHash?: string | undefined;

  /**
   * **남의 리스를 뺏는다**(§1.4h). 리스 보유자는 세션이므로, 죽은 에이전트 세션이 쥔
   * 리스를 사람이 30분씩 기다리지 않게 하는 탈출구다. 뺏어도 본문은 `base_hash` 가 지킨다 —
   * 리스는 신호이고 지문이 자물쇠다.
   */
  takeover?: boolean | undefined;
  userId: string;
  sessionId?: string | null;
}

export interface SpecGraphEdge extends Record<string, unknown> {
  from_id: string;
  to_id: string;
  kind: string;
}

/**
 * 스펙 한 건을 가리키는 조건 — **키와 UUID 를 둘 다 받는다**(§1.4b).
 *
 * UUID 로 보이는 값만 `id` 와 견준다. 아무 문자열이나 `::uuid` 로 캐스팅하면 못 읽는 값에서
 * 22P02 가 나고, 그건 "못 찾았다"가 아니라 500 이 된다.
 */
function specMatch(ref: string): SQL {
  const parsed = entityRef(ref);
  return parsed.id === null ? sql`s.key = ${ref}` : sql`s.id = ${parsed.id}`;
}

@Injectable()
export class SpecService {
  private readonly logger = new Logger(SpecService.name);

  /** 초안 편집 리스 TTL — Task 클레임 리스와 **같은 상수**다(D-04 문서 축 확장) */
  readonly draftLeaseTtlSeconds = LEASE_TTL_SECONDS;

  constructor(
    private readonly events: EventService,
    private readonly checks: SpecCheckService,
    private readonly relationService: SpecRelationService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /** nerv_spec_tree · EP-SPEC-01 */
  async tree(input: { projectId: string; includeArchived?: boolean }): Promise<SpecTreeNode[]> {
    const archived = input.includeArchived === true ? sql`` : sql` AND s.archived_at IS NULL`;
    const { rows } = await this.db.execute<SpecTreeNode>(sql`
      SELECT s.id, s.key, s.title, s.type::text AS type, s.parent_id, s.sort_key,
             s.archived_at, sv.status::text AS doc_status, sv.version_no
        FROM spec s
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE s.project_id = ${input.projectId}${archived}
       ORDER BY s.sort_key, s.key
    `);
    return rows;
  }

  /**
   * EP-SPEC-19 — 프로젝트 전역 그래프(노드 + 간선)를 **한 번에** 준다.
   *
   * 트리와 관계를 두 번에 나눠 받으면 그 사이에 문서가 생기거나 사라졌을 때 **끝점이 없는
   * 간선**이 화면에 남는다. 그래프는 한 시점의 스냅샷이어야 읽을 수 있다.
   *
   * 노드는 트리와 같은 모양이다 — 화면이 계층(부모)과 참조(간선)를 같은 좌표계에 그린다.
   */
  async graph(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<{ nodes: SpecTreeNode[]; edges: SpecGraphEdge[] }> {
    const nodes = await this.tree(input);
    const visible = new Set(nodes.map((node) => node.id));
    const { rows } = await this.db.execute<SpecGraphEdge>(sql`
      SELECT r.from_spec_id AS from_id, r.to_spec_id AS to_id, r.kind::text AS kind
        FROM spec_relation r
       WHERE r.project_id = ${input.projectId}
    `);
    // 아카이브 등으로 노드에서 빠진 끝점은 간선도 함께 뺀다 — 허공을 가리키는 선을 만들지 않는다
    return { nodes, edges: rows.filter((e) => visible.has(e.from_id) && visible.has(e.to_id)) };
  }

  /** nerv_spec_get · EP-SPEC-03 — 기준 버전 지정 조회를 지원한다(agent-integration §2.4) */
  async get(input: {
    projectId: string;
    /** 안정 키(`SPC-…`) 또는 UUID — 둘 다 받는다(§1.4b) */
    specKey: string;
    versionNo?: number | null;
  }): Promise<Record<string, unknown>> {
    // **기본은 최신 approved 다**(EP-SPEC-03 · REQ-WEB-011). current_version_id 를 그냥 주면
    // 초안이 기본 화면에 뜨고, 그러면 "승인된 것"과 "쓰는 중인 것"의 구분이 화면에서 사라진다
    // — 문서 축 분리(D-02)의 요점이 거기다. 승인본이 아직 없는 새 스펙만 draft 로 떨어진다.
    // **버전이 없는 노드도 문서다.** 임포터의 골격 배치는 디렉터리에서 area 노드를 만들고
    // 본문 파일이 없으면 버전 행을 만들지 않는다 — 그런 노드가 트리에는 보이는데
    // `nerv_spec_get` 은 **"스펙을 찾을 수 없습니다"** 라고 답했다(실측 2026-08-30:
    // clemvion `channel-web-chat` — 자식 둘을 거느린 영역이 도구로는 읽히지 않았다).
    // 그건 "없다"가 아니라 "아직 본문이 없다"이므로 LEFT JOIN 으로 노드를 돌려준다.
    const pick =
      input.versionNo == null
        ? sql`sv.id = coalesce(
                (SELECT a.id FROM spec_version a
                  WHERE a.spec_id = s.id AND a.status = 'approved'
                  ORDER BY a.version_no DESC LIMIT 1),
                s.current_version_id)`
        : sql`sv.spec_id = s.id AND sv.version_no = ${input.versionNo}`;

    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT s.id AS spec_id, s.key, s.title, s.type::text AS type, s.archived_at,
             sv.id AS version_id, sv.version_no, sv.status::text AS doc_status, sv.body_md,
             -- **읽은 내용의 지문**. 다음 저장이 이것을 base_hash 로 되돌려 주면 서버는
             -- "그 사이 아무도 안 바꿨다"를 확인할 수 있다(§1.4g — 비교-교환)
             encode(sv.content_hash, 'hex') AS content_hash,
             sv.superseded_by_version_id,
             -- 곁줄(시안) — 누가 언제 승인했는가. 이 문서의 무게를 한 줄로 말한다
             sv.approved_at, u.display_name AS approved_by_name
        FROM spec s
   LEFT JOIN spec_version sv ON ${pick}
   LEFT JOIN "user" u ON u.id = sv.approved_by_user_id
       WHERE s.project_id = ${input.projectId} AND ${specMatch(input.specKey)}
    `);
    const spec = rows[0];
    if (spec === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: input.specKey,
      });
    }

    const { rows: requirements } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT ref, statement_md, priority::text AS priority, impl_status::text AS impl_status
        FROM requirement WHERE spec_id = ${spec['spec_id'] as string} AND removed_in_version_id IS NULL
       ORDER BY ref
    `);

    return {
      ...spec,
      // 본문이 없는 노드는 빈 본문이다 — null 을 그대로 흘리면 화면이 "null" 을 쓴다
      body_md: spec['body_md'] ?? '',
      requirements,
      // 기준 버전이 이미 지나간 판이면 표시한다 — 재브리핑의 신호다(§2.4)
      basis_superseded: spec['superseded_by_version_id'] != null,
    };
  }

  /**
   * nerv_spec_draft_upsert · EP-SPEC-07·08.
   *
   * 세 가지가 이 메서드 안에 있다: **초안 편집 리스**(D-04 문서 축 확장) ·
   * **base_hash 비교-교환**(§1.4g) · **불변 스냅샷 규칙**(draft 밖은 못 고친다).
   * 리스는 1차 사전 조정이고 지문이 데이터 유실의 최후 방어선이다 — 역할이 달라 둘 다 있다.
   */
  /**
   * 이벤트에 실을 **스펙 키**. 봉투의 `subject_id` 는 버전·스펙 UUID 라 화면의 쿼리 키
   * (안정 키)와 축이 다르다 — 키가 없으면 무효화가 목표를 못 맞춘다(screens.md §1.4).
   */
  private async keyOfSpec(tx: Tx, specId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ key: string }>(
      sql`SELECT key FROM spec WHERE id = ${specId}`,
    );
    return rows[0]?.key ?? null;
  }

  /** 같은 것을 버전 id 로 찾을 때 */
  private async keyOfVersion(tx: Tx, versionId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ key: string }>(
      sql`SELECT s.key FROM spec_version sv JOIN spec s ON s.id = sv.spec_id WHERE sv.id = ${versionId}`,
    );
    return rows[0]?.key ?? null;
  }

  /**
   * 참조(키 또는 UUID)를 스펙 UUID 로 바꾼다. 빈 값이면 null 그대로 — "안 준 것"이다.
   *
   * 키로 왔는데 그런 스펙이 없으면 **못 찾았다고 말한다**. 조용히 null 로 떨어뜨리면
   * `parent_id` 오타가 "최상위에 만들기"로 둔갑한다.
   */
  private async resolveSpecId(
    tx: Tx,
    projectId: string,
    ref: string | null,
  ): Promise<string | null> {
    const parsed = entityRef(ref);
    if (parsed.id !== null) return parsed.id;
    if (parsed.key === null) return null;
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM spec WHERE project_id = ${projectId} AND key = ${parsed.key}`,
    );
    const found = rows[0]?.id;
    if (found === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: parsed.key,
      });
    }
    return found;
  }

  /**
   * 부모가 **살아 있는지** 본다 — 보관된 부모 아래에 문서를 두면 그 문서는 어느 목록에도
   * 없다(트리는 부모를 못 찾아 버리고, 기본 목록은 부모째 빠져 있다). 복원에 이미 같은
   * 규칙이 있었는데(`parent_archived`) 생성·이동에는 없어서, 실제로 만들 수 있었다
   * (실측 2026-08-29 — 보관된 부모 아래 생성 201, 그 뒤 트리 응답에 부모 없는 노드가 남았다).
   */
  private async requireLiveParent(tx: Tx, parentId: string | null): Promise<void> {
    if (parentId === null) return;
    const { rows } = await tx.execute<{ archived_at: unknown; key: string }>(
      sql`SELECT archived_at, key FROM spec WHERE id = ${parentId}`,
    );
    if (rows[0]?.archived_at != null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.parent_archived'), {
        kind: 'parent_archived',
        parent: rows[0].key,
      });
    }
  }

  /**
   * 안정 키는 프로젝트 안에서 유일하다 — 이미 쓰이고 있으면 만들지 않는다(2026-08-30 사람 결정).
   *
   * **덮어쓰지도, 이어쓰지도 않는다.** 같은 키로 온 생성은 대개 "이미 있는 줄 몰랐다"이고,
   * 그때 조용히 남의 문서에 이어 쓰는 것이 가장 나쁘다. 어느 문서가 그 키를 쥐고 있는지
   * 딥링크로 알려주면 부른 쪽이 읽고 정한다.
   *
   * 동시에 들어온 두 생성은 이 검사를 둘 다 통과할 수 있다 — 그 자리는 유니크 인덱스가
   * 잡는다(`spec_key_uq` → §1.4a 의 `unique_violation`). 검사는 흔한 길의 말이고,
   * 인덱스가 자물쇠다.
   */
  private async requireFreeKey(tx: Tx, projectId: string, key: string): Promise<void> {
    const { rows } = await tx.execute<{ id: string; archived_at: unknown }>(
      sql`SELECT id, archived_at FROM spec WHERE project_id = ${projectId} AND key = ${key}`,
    );
    const taken = rows[0];
    if (taken === undefined) return;
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.key_taken'), {
      kind: 'key_taken',
      key,
      spec_id: taken.id,
      // 보관된 문서가 키를 쥔 경우가 있다 — 그때 답은 새로 만드는 것이 아니라 복구다
      archived: taken.archived_at != null,
      web_url: await this.webUrl(tx, projectId, taken.id),
    });
  }

  async draftUpsert(input: DraftUpsertInput): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      // **키로 왔든 UUID 로 왔든 같은 스펙을 가리킨다**(§1.4b). 예전에는 이 자리가 UUID 만
      // 받았고, 바로 옆 `nerv_spec_get` 은 키만 받았다 — 같은 이름의 인자가 도구마다 다른
      // 것을 뜻하면 에이전트는 실패로 배운다.
      let specId = await this.resolveSpecId(tx, input.projectId, input.specId ?? null);
      // 기존 문서를 고치는 저장인가 — 그때만 base_hash 를 요구한다(새 문서에는 기준이 없다)
      const isExisting = specId !== null;
      let created = false;

      if (specId === null) {
        if (input.key === undefined || input.title === undefined || input.type === undefined) {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.missing_fields'), {
            kind: 'missing_meta',
          });
        }
        // **역할이 타입을 가른다**(EP-SPEC-07). designer 는 design 을, developer 는
        // convention·adr 을 만든다. qa 가 만드는 것은 리뷰이지 스펙이 아니다(2026-08-23).
        // 스코프(`spec:draft`)는 "초안을 쓸 수 있는가"이고 이것은 "무엇을 시작할 수 있는가"다 —
        // 다른 물음이라 따로 판정한다.
        if (!canCreateSpecType(input.roles ?? [], input.type)) {
          throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.spec.type_not_allowed'), {
            kind: 'spec_type_not_allowed',
            type: input.type,
            roles: input.roles ?? [],
          });
        }
        const parentId = await this.resolveSpecId(tx, input.projectId, input.parentId ?? null);
        await this.requireLiveParent(tx, parentId);
        await this.requireFreeKey(tx, input.projectId, input.key);
        specId = newId();
        await tx.execute(sql`
          INSERT INTO spec (id, project_id, parent_id, type, key, title)
          VALUES (${specId}, ${input.projectId}, ${parentId}, ${input.type}::spec_type,
                  ${input.key}, ${input.title})
        `);
        created = true;
      } else if (
        input.parentId !== undefined ||
        input.type !== undefined ||
        input.title !== undefined
      ) {
        // REQ-API-021 — **메타는 이 경로로 못 바꾼다.** 트리 구조는 거버넌스 대상이라
        // EP-SPEC-15 가 전담한다(api.md §2.2). 조용히 무시하지 않는 이유는 그쪽이 더
        // 나쁘기 때문이다: 부른 쪽은 옮겨졌다고 믿고 다음 일을 한다.
        // 같은 값이면 통과시킨다 — 멱등 재호출이 여기서 걸리면 안 된다.
        await this.assertMetaUnchanged(tx, specId, input);
      }

      const draft = await this.currentDraft(tx, specId);

      // 편집 리스 — 같은 **세션**이면 이어쓰기, 남의 리스는 `takeover` 없이는 하드 차단(§1.4h)
      const seized =
        draft === null
          ? false
          : await this.assertDraftLease(tx, draft, {
              userId: input.userId,
              sessionId: input.sessionId ?? null,
              takeover: input.takeover === true,
            });

      // **비교-교환**(§1.4g). 부른 쪽이 말하는 것은 **"어느 내용을 보고 썼는가" 하나**다.
      // "어느 행에서 갈라졌는가"(계보)는 서버가 아는 사실이라 묻지 않는다 — 예전에는
      // `base_version` 으로 물었는데, 초안은 같은 행을 덮어쓰므로 그 답은 아무것도 막지
      // 못했다(실측에서 세 세션이 다 성공하고 둘이 글을 잃었다).
      const current = isExisting
        ? draft !== null
          ? draft.content_hash
          : await readerHash(tx, specId)
        : null;
      // **지킬 내용이 있을 때만 지문을 요구한다.** 예전 조건은 "기존 스펙이면"이었는데,
      // 임포터의 골격 노드는 스펙 행만 있고 버전이 없다 — 견줄 지문이 없는데 지문을
      // 요구하니 에이전트는 얻을 수 없는 값을 내놓아야 했고(그 문서의 get 은 "없다"고
      // 답했다), 아무 문자열이나 넣으면 통과했다. 필수를 흉내만 낸 자리였다(실측 2026-08-30).
      if (current !== null) {
        if (input.baseHash == null || input.baseHash === '') {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.base_hash_required'), {
            kind: 'base_hash_required',
            current_hash: current,
          });
        }
        if (input.baseHash !== current) {
          // 재시도가 아니라 **다시 읽고 다시 얹는 것**이 답이다 — 같은 본문으로 다시 부르면
          // 그건 덮어쓰기다. 그래서 현재 지문과 딥링크를 함께 준다.
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.stale_body'), {
            kind: 'stale_body',
            current_hash: current,
            received: input.baseHash,
            web_url: await this.webUrl(tx, input.projectId, specId),
          });
        }
      }

      // 덮어쓰기 **전의** 본문 — 델타의 기준이자 빈 본문 방어의 근거다.
      // draft 는 이 UPDATE 뒤에 이전 본문을 남기지 않으므로 지금 읽어 두어야 한다.
      const previousBody =
        draft === null
          ? null
          : ((
              await tx.execute<{ body_md: string }>(
                sql`SELECT body_md FROM spec_version WHERE id = ${draft.id}`,
              )
            ).rows[0]?.body_md ?? null);

      // **빈 본문으로 덮어쓰지 않는다.** draft 는 가변 구간이라 이전 본문이 남지 않는다 —
      // 여기서 통과시키면 이름을 잘못 적은 호출 하나가 그 문서를 지운다(실측 2026-08-30).
      // 새로 만드는 문서의 빈 본문은 막지 않는다: `area` 는 본문 없이 자리만 잡는다.
      if (draft !== null && input.bodyMd.trim() === '') {
        if ((previousBody ?? '').trim() !== '') {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.empty_body'), {
            kind: 'empty_body',
            spec_version_id: draft.id,
          });
        }
      }

      const hash = createHash('sha256').update(input.bodyMd, 'utf8').digest('hex');
      const leaseExpires = new Date(Date.now() + this.draftLeaseTtlSeconds * 1000);

      if (draft !== null) {
        // 무변경 저장은 새 버전을 만들지 않는다 — content_hash 가 그것을 판정한다
        await tx.execute(sql`
          UPDATE spec_version
             SET body_md = ${input.bodyMd}, content_hash = decode(${hash}, 'hex'),
                 change_summary_md = coalesce(${input.changeSummary ?? null}, change_summary_md),
                 -- **본문이 바뀐 시각**이지 저장된 시각이 아니다. 요약만 고치는 저장이나
                 -- 리스 갱신에 시계가 움직이면 "언제 바뀌었나"가 거짓이 된다.
                 updated_at = CASE
                   WHEN content_hash IS DISTINCT FROM decode(${hash}, 'hex') THEN now()
                   ELSE updated_at
                 END,
                 edit_lease_user_id = ${input.userId},
                 edit_lease_session_id = ${input.sessionId ?? null},
                 edit_lease_expires_at = ${leaseExpires.toISOString()}
           WHERE id = ${draft.id} AND content_hash = decode(${draft.content_hash}, 'hex')
        `);
        const relations = await this.syncRelations(tx, input.projectId, specId, input.bodyMd);
        const declared = await this.syncDeclared(tx, input.projectId, specId, input.relations);
        const delta = specDelta(previousBody, input.bodyMd);

        // **같은 draft 를 다시 저장해도 알린다**(2026-08-29 개정 — 사람 보고).
        // 예전에는 여기서 아무 이벤트도 내지 않았다("리스 갱신만" — api.md EP-SPEC-08).
        // 그런데 에이전트가 스펙을 쓰는 방식이 대부분 이 경로라, 본문이 바뀌어도 화면은
        // 새로고침 전에는 알 수 없었다. 새 버전이 생긴 것이 아니므로 이름이 다르다.
        await emit({
          // 요약은 **이벤트에도** 싣는다 — 버전 행은 마지막 상태만 남지만 이벤트는 매번 남는다.
          // 40번 덮어쓴 draft 에서 "무엇이 바뀌었나"를 되짚을 수 있는 곳은 여기뿐이다.
          payload: {
            ...(input.changeSummary === undefined ? {} : { change_summary: input.changeSummary }),
            // 뺏었으면 남긴다 — 리스를 넘긴 쪽이 나중에 "왜 내 자리가 사라졌나"를 물을 곳이다
            ...(seized ? { takeover: true } : {}),
            // 봉투에는 **수**만 싣는다 — 본문은 이벤트에 담지 않는다(D-14)
            lines_added: delta.lines.added,
            lines_removed: delta.lines.removed,
          },
          type: NERV_EVENT.SPEC_DRAFT_UPDATED,
          projectId: input.projectId,
          subjectType: 'spec_version',
          subjectId: draft.id,
          subjectKey: await this.keyOfSpec(tx, specId),
          actorUserId: input.userId,
          actorSessionId: input.sessionId ?? null,
          isAgent: input.sessionId != null,
          toState: 'draft',
        });

        return {
          spec_id: specId,
          spec_version_id: draft.id,
          version_no: draft.version_no,
          created: false,
          // 다음 저장의 base_hash — 응답이 주지 않으면 에이전트는 매번 다시 읽어야 한다
          content_hash: hash,
          delta,
          relations: { ...relations, declared },
          web_url: await this.webUrl(tx, input.projectId, specId),
        };
      }

      const { rows: last } = await tx.execute<{ max: number | null }>(
        sql`SELECT max(version_no) AS max FROM spec_version WHERE spec_id = ${specId}`,
      );
      const versionNo = Number(last[0]?.max ?? 0) + 1;
      const versionId = newId();
      // **계보는 시스템이 채운다**(2026-08-30 사람 결정). 예전에는 부른 쪽이 `base_version` 으로
      // 선언했는데, 부른 쪽은 "무엇을 보고 썼는가"를 지문으로 이미 말하고 있다(§1.4g).
      // 어느 버전에서 갈라져 나왔는가는 서버가 아는 사실이지 물어볼 일이 아니다.
      const { rows: lineage } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM spec_version WHERE spec_id = ${specId} AND version_no < ${versionNo}
         ORDER BY version_no DESC LIMIT 1
      `);
      const baseVersionId = lineage[0]?.id ?? null;

      await tx.execute(sql`
        INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash,
                                  change_summary_md,
                                  author_user_id, author_session_id, base_version_id,
                                  edit_lease_user_id, edit_lease_session_id, edit_lease_expires_at)
        VALUES (${versionId}, ${specId}, ${versionNo}, 'draft', ${input.bodyMd},
                decode(${hash}, 'hex'), ${input.changeSummary ?? null},
                ${input.userId}, ${input.sessionId ?? null},
                ${baseVersionId}, ${input.userId}, ${input.sessionId ?? null},
                ${leaseExpires.toISOString()})
      `);
      if (created) {
        await tx.execute(
          sql`UPDATE spec SET current_version_id = ${versionId} WHERE id = ${specId}`,
        );
      }

      await emit({
        payload: input.changeSummary === undefined ? {} : { change_summary: input.changeSummary },
        type: NERV_EVENT.SPEC_DRAFT_CREATED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: versionId,
        subjectKey: await this.keyOfSpec(tx, specId),
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        toState: 'draft',
      });

      const relations = await this.syncRelations(tx, input.projectId, specId, input.bodyMd);
      const declared = await this.syncDeclared(tx, input.projectId, specId, input.relations);
      // 새 버전의 기준은 **직전 버전**이다. 첫 버전이면 기준이 없으니 전부 새로 쓴 것이다.
      const { rows: prior } = await tx.execute<{ body_md: string }>(sql`
        SELECT body_md FROM spec_version
         WHERE spec_id = ${specId} AND version_no < ${versionNo}
         ORDER BY version_no DESC LIMIT 1
      `);
      return {
        spec_id: specId,
        spec_version_id: versionId,
        version_no: versionNo,
        created: true,
        content_hash: hash,
        delta: specDelta(prior[0]?.body_md ?? null, input.bodyMd),
        relations: { ...relations, declared },
        web_url: await this.webUrl(tx, input.projectId, specId),
      };
    });
  }

  /**
   * EP-SPEC-08 — 키로 지정한 스펙의 초안을 이어쓴다.
   *
   * `draftUpsert` 는 UUID 를 받는다(도구·내부 경로). REST 는 사람이 읽는 키를 쓰므로
   * 여기서 한 번 해소한다 — URL 에 UUID 가 박히면 링크를 사람이 못 읽는다.
   */
  async draftUpsertByKey(input: {
    projectId: string;
    specKey: string;
    bodyMd: string;
    baseHash?: string | undefined;
    changeSummary?: string | undefined;
    takeover?: boolean | undefined;
    userId: string;
    sessionId?: string | null;
  }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM spec WHERE project_id = ${input.projectId} AND key = ${input.specKey}`,
    );
    const specId = rows[0]?.id;
    if (specId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: input.specKey,
      });
    }
    return this.draftUpsert({
      projectId: input.projectId,
      specId,
      bodyMd: input.bodyMd,
      userId: input.userId,
      ...(input.baseHash == null ? {} : { baseHash: input.baseHash }),
      ...(input.changeSummary == null ? {} : { changeSummary: input.changeSummary }),
      ...(input.takeover === true ? { takeover: true } : {}),
      ...(input.sessionId == null ? {} : { sessionId: input.sessionId }),
    });
  }

  /**
   * nerv_spec_submit_review · EP-SPEC-10 (A3 — 사람 승인 필요).
   *
   * 제출은 **본문을 동결한다**. 게이트 티어를 산출해 T0·T1 은 자동 통과시키고
   * T2·T3 은 승인 대기로 보낸다(D-06). 자동 통과 경로가 없으면 "버그 하나에 16개 인수 기준"
   * 비판을 그대로 실현하는 도구가 된다(§2.4).
   */
  async submitReview(input: {
    projectId: string;
    specVersionId: string;
    userId: string;
    sessionId?: string | null;
  }): Promise<{
    status: string;
    gate: GateDecision;
    approval_id: string | null;
    /** 사람이 이어서 볼 곳 — 에이전트가 대화에 붙일 딥링크다(E10-S04) */
    web_url: string;
  }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        spec_id: string;
        status: string;
        spec_type: string;
      }>(sql`
        SELECT sv.id, sv.spec_id, sv.status::text AS status, s.type::text AS spec_type
          FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
         FOR UPDATE OF sv
      `);
      const version = rows[0];
      if (version === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.draft_not_found'), {
          kind: 'not_found',
        });
      }
      if (version.status !== 'draft') {
        throw new NervError(
          NERV_ERROR.PRECONDITION,
          msg('error.spec.not_draft', { status: version.status }),
          {
            kind: 'not_draft',
            status: version.status,
          },
        );
      }

      // 사전 검토 — block 이 있으면 제출 자체가 막힌다(§1.2 전이 가드).
      // clemvion 의 "쓰기 직전 consistency-check 의무"가 여기로 옮겨 온 것이다.
      const check = await this.checks.check({
        projectId: input.projectId,
        specVersionId: input.specVersionId,
      });
      if (check.verdict === 'block') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.check_blocked'), {
          kind: 'precheck_blocked',
          findings: check.findings.filter((f) => f.severity === 'block'),
        });
      }

      const gate = await this.assessGate(tx, version.spec_id, version.spec_type, input.specVersionId);

      // 제출 = 본문 동결. 트리거가 이후 UPDATE 를 막는다(4.3 §2.13)
      await tx.execute(sql`
        UPDATE spec_version
           SET status = 'in_review', submitted_at = now(),
               edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
         WHERE id = ${input.specVersionId}
      `);
      await emit({
        type: NERV_EVENT.SPEC_SUBMITTED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: input.specVersionId,
        subjectKey: await this.keyOfVersion(tx, input.specVersionId),
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        fromState: 'draft',
        toState: 'in_review',
        payload: { gate_tier: gate.tier, gate_score: gate.score },
      });

      if (gate.autoPass) {
        // T0·T1 — 승인 없이 approved. T1 은 24시간 이의제기 창이 열린다
        await this.approveInTx(tx, emit, {
          projectId: input.projectId,
          specVersionId: input.specVersionId,
          specId: version.spec_id,
          approverUserId: null,
          gate,
        });
        return {
          status: 'approved',
          gate,
          approval_id: null,
          web_url: await this.webUrl(tx, input.projectId, version.spec_id),
        };
      }

      // T2·T3 — 승인 대기. pending Approval 을 재사용해 카드 중복을 막는다(§2.5)
      const approvalId = await this.ensurePendingApproval(tx, {
        projectId: input.projectId,
        specVersionId: input.specVersionId,
        requestedByUserId: input.userId,
        requestedBySessionId: input.sessionId ?? null,
      });
      await emit({
        type: NERV_EVENT.APPROVAL_REQUESTED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: approvalId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        payload: { gate_tier: gate.tier, required_approvers: gate.requiredApprovers },
      });

      // T2·T3 은 받은 요청이 다음 목적지다 — 문서가 아니라 결정할 곳으로 보낸다
      return { status: 'in_review', gate, approval_id: approvalId, web_url: '/inbox' };
    });
  }

  /**
   * 승인 — **사람 전용**이다(A4). 지시자≠승인자를 여기서 강제한다(D-06 · §2.3).
   * 소규모 완화(멤버 2인 미만이면 차단 대신 감사 이벤트)는 정본이 정한 예외다.
   */
  async approve(input: {
    projectId: string;
    specVersionId: string;
    approverUserId: string;
  }): Promise<{ status: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        spec_id: string;
        status: string;
        author_user_id: string;
        spec_type: string;
      }>(sql`
        SELECT sv.spec_id, sv.status::text AS status, sv.author_user_id, s.type::text AS spec_type
          FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
         FOR UPDATE OF sv
      `);
      const version = rows[0];
      if (version === undefined || version.status !== 'in_review') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_in_review'), {
          kind: 'not_in_review',
          status: version?.status ?? null,
        });
      }

      await this.assertDifferentApprover(tx, input, version.author_user_id);

      const gate = await this.assessGate(tx, version.spec_id, version.spec_type, input.specVersionId);
      await this.approveInTx(tx, emit, {
        projectId: input.projectId,
        specVersionId: input.specVersionId,
        specId: version.spec_id,
        approverUserId: input.approverUserId,
        gate,
      });
      return { status: 'approved' };
    });
  }

  /**
   * 받은편지함의 결정이 부르는 자리 — **남의 트랜잭션 안에서** 같은 전이를 한다.
   *
   * 공개 `approve()`/`reject()` 는 스스로 트랜잭션을 연다. 결재 결정과 문서 전이는
   * **한 트랜잭션이어야** 하므로(둘로 나누면 그 사이의 실패가 "결재는 됐는데 문서는
   * 안 움직인" 상태를 만든다 — 실측된 그 자리다) 트랜잭션을 받는 판을 따로 연다.
   *
   * `assertDifferentApprover` 는 여기서 부르지 않는다: 지시자≠승인자 판정은 결재 쪽이
   * 이미 했고(완화 둘 포함), 두 곳에서 판정하면 규칙이 두 벌이 된다.
   */
  async approveInTxForApproval(
    tx: Tx,
    emit: Parameters<Parameters<EventService['transact']>[0]>[1],
    input: { projectId: string; specVersionId: string; approverUserId: string },
  ): Promise<void> {
    const { rows } = await tx.execute<{ spec_id: string; status: string; spec_type: string }>(sql`
      SELECT sv.spec_id, sv.status::text AS status, s.type::text AS spec_type
        FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
       WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
       FOR UPDATE OF sv
    `);
    const version = rows[0];
    // **이미 옮겨진 것은 오류가 아니다.** 결재는 남기고 전이만 건너뛴다 — 예전 데이터가
    // 손으로 복구된 경우가 그 자리다.
    if (version === undefined || version.status !== 'in_review') return;

    await this.approveInTx(tx, emit, {
      projectId: input.projectId,
      specVersionId: input.specVersionId,
      specId: version.spec_id,
      approverUserId: input.approverUserId,
      gate: await this.assessGate(tx, version.spec_id, version.spec_type, input.specVersionId),
    });
  }

  /** 같은 이유로 여는 거절 판 — in_review → draft */
  async rejectInTxForApproval(
    tx: Tx,
    emit: Parameters<Parameters<EventService['transact']>[0]>[1],
    input: {
      projectId: string;
      specVersionId: string;
      reviewerUserId: string;
      comment: string;
    },
  ): Promise<void> {
    const { rows } = await tx.execute<{ id: string }>(sql`
      UPDATE spec_version sv SET status = 'draft', submitted_at = NULL
        FROM spec s
       WHERE sv.spec_id = s.id AND sv.id = ${input.specVersionId}
         AND s.project_id = ${input.projectId} AND sv.status = 'in_review'
      RETURNING sv.id
    `);
    if (rows.length === 0) return;
    await emit({
      type: NERV_EVENT.SPEC_REJECTED,
      projectId: input.projectId,
      subjectType: 'spec_version',
      subjectId: input.specVersionId,
      subjectKey: await this.keyOfVersion(tx, input.specVersionId),
      actorUserId: input.reviewerUserId,
      fromState: 'in_review',
      toState: 'draft',
      payload: { comment: input.comment },
    });
  }

  /** 거절 — in_review → draft. 리스는 다시 열린다. */
  async reject(input: {
    projectId: string;
    specVersionId: string;
    reviewerUserId: string;
    comment: string;
  }): Promise<{ status: string }> {
    return this.events.transact(async (tx, emit) => {
      // **프로젝트가 경계다.** 예전에는 이 UPDATE 만 `spec` 조인이 없어, 다른 프로젝트의
      // in_review 버전 id 를 실으면 그 문서가 draft 로 되돌아갔다(같은 파일의
      // `approve`·`submitReview`·`rejectInTxForApproval` 은 전부 조인하고 있었다).
      const { rows } = await tx.execute<{ id: string }>(sql`
        UPDATE spec_version sv SET status = 'draft', submitted_at = NULL
          FROM spec s
         WHERE sv.id = ${input.specVersionId} AND sv.status = 'in_review'
           AND s.id = sv.spec_id AND s.project_id = ${input.projectId}
        RETURNING sv.id
      `);
      if (rows.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_in_review'), {
          kind: 'not_in_review',
        });
      }
      await emit({
        type: NERV_EVENT.SPEC_REJECTED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: input.specVersionId,
        subjectKey: await this.keyOfVersion(tx, input.specVersionId),
        actorUserId: input.reviewerUserId,
        fromState: 'in_review',
        toState: 'draft',
        payload: { comment: input.comment },
      });
      return { status: 'draft' };
    });
  }

  /**
   * nerv_spec_check · EP-SPEC-09 — 사전 검토 5검사기.
   * 제출 게이트이면서 **셀프서비스**다: 초안 저장 후·제출 전 아무 때나 부를 수 있다(§2.1).
   */
  check(input: { projectId: string; specVersionId: string }): Promise<CheckResult> {
    return this.checks.check(input);
  }

  /**
   * EP-SPEC-15 — 메타 편집(제목·부모 이동·정렬·owner_role). E09-S08.
   *
   * **이동은 버전·관계·코멘트를 하나도 건드리지 않는다**(FR-01). 트리 위치는 표시 축이고
   * 내용의 정체성은 spec_id 에 있다 — 그 둘을 섞으면 문서를 옮길 때마다 이력이 끊긴다.
   * 자기 자신·자기 하위로의 이동은 트리를 사이클로 만들므로 409 다.
   */
  async updateMeta(input: {
    projectId: string;
    specKey: string;
    title?: string | null;
    parentKey?: string | null;
    /** 부모를 루트로 올리는 명시적 의사 표시 — parentKey 미지정(undefined)과 구분한다 */
    detachParent?: boolean;
    sortKey?: string | null;
    ownerRole?: string | null;
    userId: string;
  }): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      const spec = await this.requireSpec(tx, input.projectId, input.specKey);

      const changed: string[] = [];
      if (input.title != null && input.title !== spec.title) {
        await tx.execute(sql`UPDATE spec SET title = ${input.title} WHERE id = ${spec.id}`);
        changed.push('title');
      }
      if (input.sortKey != null) {
        await tx.execute(sql`UPDATE spec SET sort_key = ${input.sortKey} WHERE id = ${spec.id}`);
        changed.push('sort_key');
      }
      if (input.ownerRole != null) {
        await tx.execute(
          sql`UPDATE spec SET owner_role = ${input.ownerRole}::membership_role WHERE id = ${spec.id}`,
        );
        changed.push('owner_role');
      }

      if (input.detachParent === true) {
        await tx.execute(sql`UPDATE spec SET parent_id = NULL WHERE id = ${spec.id}`);
        changed.push('parent_id');
      } else if (input.parentKey != null) {
        const parent = await this.requireSpec(tx, input.projectId, input.parentKey);
        await this.requireLiveParent(tx, parent.id);
        if (await this.isDescendant(tx, spec.id, parent.id)) {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.cycle'), {
            kind: 'tree_cycle',
            spec: input.specKey,
            parent: input.parentKey,
          });
        }
        await tx.execute(sql`UPDATE spec SET parent_id = ${parent.id} WHERE id = ${spec.id}`);
        changed.push('parent_id');
      }

      if (changed.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.no_changes'), {
          kind: 'no_fields',
        });
      }

      await emit({
        type: NERV_EVENT.SPEC_META_UPDATED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: spec.id,
        subjectKey: await this.keyOfSpec(tx, spec.id),
        actorUserId: input.userId,
        isAgent: false,
        payload: { fields: changed },
      });

      return { spec_id: spec.id, key: input.specKey, changed };
    });
  }

  /**
   * EP-SPEC-16 — 아카이브. **삭제가 아니다**: 링크·이력은 그대로 남고 기본 조회에서만 빠진다.
   *
   * 두 가지가 있으면 막는다 — ① 살아 있는 하위 노드(부모만 감추면 자식이 고아가 된다)
   * ② 활성 클레임이 걸린 파생 Task(누군가 지금 그 스펙을 근거로 일하고 있다).
   * 둘 다 "차단 사유 목록"으로 돌려준다. 무엇을 정리해야 하는지 모르는 거부는 벽일 뿐이다.
   */
  async archive(input: {
    projectId: string;
    specKey: string;
    userId: string;
  }): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      const spec = await this.requireSpec(tx, input.projectId, input.specKey);

      const { rows: children } = await tx.execute<{ key: string }>(sql`
        SELECT key FROM spec WHERE parent_id = ${spec.id} AND archived_at IS NULL
      `);
      const { rows: claimed } = await tx.execute<{ key: string }>(sql`
        SELECT t.key FROM task t
          JOIN spec_version sv ON sv.id = t.source_spec_version_id
          JOIN claim c ON c.task_id = t.id AND c.released_at IS NULL
         WHERE sv.spec_id = ${spec.id}
      `);

      const blockers = [
        ...children.map((c) => ({ kind: 'child_spec', key: c.key })),
        ...claimed.map((t) => ({ kind: 'active_claim', key: t.key })),
      ];
      if (blockers.length > 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.archive_blocked'), {
          kind: 'archive_blocked',
          blockers,
        });
      }

      await tx.execute(sql`UPDATE spec SET archived_at = now() WHERE id = ${spec.id}`);
      await emit({
        type: NERV_EVENT.SPEC_ARCHIVED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: spec.id,
        subjectKey: await this.keyOfSpec(tx, spec.id),
        actorUserId: input.userId,
        isAgent: false,
      });
      return { spec_id: spec.id, key: input.specKey, archived: true };
    });
  }

  /** EP-SPEC-17 — 복원. 부모가 아카이브 상태면 거부한다(복원해도 보이지 않는다). */
  async restore(input: {
    projectId: string;
    specKey: string;
    userId: string;
  }): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      const spec = await this.requireSpec(tx, input.projectId, input.specKey);
      if (spec.parent_id !== null) {
        const { rows } = await tx.execute<{ archived_at: unknown; key: string }>(
          sql`SELECT archived_at, key FROM spec WHERE id = ${spec.parent_id}`,
        );
        if (rows[0]?.archived_at != null) {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.parent_archived'), {
            kind: 'parent_archived',
            parent: rows[0].key,
          });
        }
      }

      await tx.execute(sql`UPDATE spec SET archived_at = NULL WHERE id = ${spec.id}`);
      await emit({
        type: NERV_EVENT.SPEC_RESTORED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: spec.id,
        subjectKey: await this.keyOfSpec(tx, spec.id),
        actorUserId: input.userId,
        isAgent: false,
      });
      return { spec_id: spec.id, key: input.specKey, archived: false };
    });
  }

  /** EP-SPEC-04 — 버전 목록. 불변 스냅샷의 목록이므로 캐시해도 안전하다. */
  async versions(input: {
    projectId: string;
    specKey: string;
  }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT sv.id, sv.version_no, sv.status::text AS status, sv.change_summary_md, sv.updated_at,
             sv.author_user_id, sv.approved_by_user_id, sv.submitted_at, sv.approved_at,
             sv.created_at
        FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
       WHERE s.project_id = ${input.projectId} AND s.key = ${input.specKey}
       ORDER BY sv.version_no DESC
    `);
    return rows;
  }

  /**
   * EP-SPEC-06 — 버전 간 델타.
   *
   * **요구사항 델타가 본문 diff 보다 앞에 온다.** 사람이 리뷰에서 실제로 묻는 것은
   * "문구가 어떻게 바뀌었나"가 아니라 "약속이 늘었나 줄었나 달라졌나"이기 때문이다.
   * requirement_version 이 그 답을 이미 들고 있으므로 계산이 아니라 조회다.
   */
  async diff(input: {
    projectId: string;
    specKey: string;
    fromVersionNo?: number | null;
    toVersionNo?: number | null;
  }): Promise<Record<string, unknown>> {
    const versions = await this.versions(input);
    if (versions.length === 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: input.specKey,
      });
    }
    const pick = (
      no: number | null | undefined,
      fallbackIndex: number,
    ): Record<string, unknown> => {
      const found =
        no == null ? versions[fallbackIndex] : versions.find((v) => v['version_no'] === no);
      if (found === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.version_missing'), {
          kind: 'not_found',
          version: no,
        });
      }
      return found;
    };
    const to = pick(input.toVersionNo, 0);
    const from = pick(input.fromVersionNo, Math.min(1, versions.length - 1));

    const { rows: requirements } = await this.db.execute<Record<string, unknown>>(sql`
      WITH from_v AS (
        SELECT requirement_id, statement_md FROM requirement_version
         WHERE spec_version_id = ${from['id'] as string}
      ), to_v AS (
        SELECT requirement_id, statement_md, change_kind::text AS change_kind
          FROM requirement_version WHERE spec_version_id = ${to['id'] as string}
      )
      SELECT r.ref,
             coalesce(t.statement_md, f.statement_md) AS statement_md,
             CASE
               WHEN f.requirement_id IS NULL AND t.requirement_id IS NOT NULL THEN 'added'
               WHEN t.requirement_id IS NULL AND f.requirement_id IS NOT NULL THEN 'removed'
               WHEN f.statement_md IS DISTINCT FROM t.statement_md THEN 'modified'
               ELSE 'unchanged'
             END AS delta
        FROM requirement r
   LEFT JOIN from_v f ON f.requirement_id = r.id
   LEFT JOIN to_v t ON t.requirement_id = r.id
       WHERE (f.requirement_id IS NOT NULL OR t.requirement_id IS NOT NULL)
       ORDER BY r.ref
    `);

    const { rows: bodies } = await this.db.execute<{ id: string; body_md: string }>(sql`
      SELECT id, body_md FROM spec_version
       WHERE id IN (${from['id'] as string}, ${to['id'] as string})
    `);
    const bodyOf = (id: string): string => bodies.find((b) => b.id === id)?.body_md ?? '';

    return {
      from: { version_no: from['version_no'], status: from['status'] },
      to: { version_no: to['version_no'], status: to['status'] },
      // **행이 없으면 본문에서 읽는다**(2026-09-01 — 사람 요청으로 화면을 붙이며 드러났다).
      //
      // `requirement_version` 을 채우는 것은 **임포터뿐**이다. 에이전트가 쓴 스펙에는 그
      // 행이 없어서, 조회로만 만든 이 델타는 언제나 빈 배열이었다 — 리뷰가 실제로 묻는
      // 축(약속이 늘었나 줄었나)이 그 문서들에서 통째로 죽어 있었다는 뜻이다.
      // 저장 응답의 델타(`specDelta`)가 이미 같은 규칙으로 본문을 읽으므로 그것을 쓴다.
      requirements:
        requirements.length > 0
          ? requirements
          : requirementDeltaFromBody(bodyOf(from['id'] as string), bodyOf(to['id'] as string)),
      body_diff: lineDiff(bodyOf(from['id'] as string), bodyOf(to['id'] as string)),
    };
  }

  /**
   * EP-COV-01 — 커버리지. **문서 안의 ✅ 가 아니라 관계 그래프 집계다**(spec-workflow §5.5).
   *
   * 마지막 두 줄이 이 질의의 존재 이유다:
   *   증적 결손 = implemented 라고 선언됐지만 Evidence 가 없는 요구사항
   *   빈 약속   = 아무 Task 도 책임지지 않는 미구현 요구사항 (clemvion R-5 의 자동 검출)
   * clemvion 은 이것을 NLP 휴리스틱으로 근사해야 했다. 관계가 있으면 휴리스틱이 필요 없다.
   */
  async coverage(input: {
    projectId: string;
    specKey?: string | null;
  }): Promise<Record<string, unknown>> {
    const specFilter = input.specKey == null ? sql`` : sql` AND s.key = ${input.specKey}`;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT s.id AS spec_id, s.key, s.title,
             count(r.id)::int AS total,
             count(*) FILTER (WHERE r.impl_status IN ('implemented', 'verified'))::int AS implemented,
             count(*) FILTER (WHERE r.impl_status = 'verified')::int AS verified,
             count(*) FILTER (WHERE r.impl_status = 'in_progress')::int AS in_progress,
             count(*) FILTER (
               WHERE r.impl_status = 'implemented'
                 AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = r.id)
             )::int AS evidence_missing,
             count(*) FILTER (
               WHERE r.impl_status = 'unimplemented'
                 AND NOT EXISTS (SELECT 1 FROM task t WHERE t.source_requirement_id = r.id)
             )::int AS empty_promises
        FROM spec s
   LEFT JOIN requirement r ON r.spec_id = s.id AND r.removed_in_version_id IS NULL
       WHERE s.project_id = ${input.projectId} AND s.archived_at IS NULL${specFilter}
       GROUP BY s.id, s.key, s.title
       ORDER BY s.key
    `);

    interface CoverageTotals {
      total: number;
      implemented: number;
      verified: number;
      in_progress: number;
      evidence_missing: number;
      empty_promises: number;
    }
    const totals = rows.reduce<CoverageTotals>(
      (acc, row) => ({
        total: acc.total + Number(row['total'] ?? 0),
        implemented: acc.implemented + Number(row['implemented'] ?? 0),
        verified: acc.verified + Number(row['verified'] ?? 0),
        in_progress: acc.in_progress + Number(row['in_progress'] ?? 0),
        evidence_missing: acc.evidence_missing + Number(row['evidence_missing'] ?? 0),
        empty_promises: acc.empty_promises + Number(row['empty_promises'] ?? 0),
      }),
      {
        total: 0,
        implemented: 0,
        verified: 0,
        in_progress: 0,
        evidence_missing: 0,
        empty_promises: 0,
      },
    );

    return {
      totals: {
        ...totals,
        unimplemented: totals.total - totals.implemented - totals.in_progress,
        impl_ratio: totals.total === 0 ? null : totals.implemented / totals.total,
        verified_ratio: totals.total === 0 ? null : totals.verified / totals.total,
      },
      specs: rows,
    };
  }

  /** EP-REQ-01 */
  async requirements(input: {
    projectId: string;
    specKey?: string | null;
    implStatus?: string | null;
  }): Promise<Record<string, unknown>[]> {
    const specFilter = input.specKey == null ? sql`` : sql` AND s.key = ${input.specKey}`;
    const statusFilter =
      input.implStatus == null ? sql`` : sql` AND r.impl_status = ${input.implStatus}::impl_status`;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.ref, r.statement_md, r.priority::text AS priority,
             r.impl_status::text AS impl_status, r.verified_at,
             s.key AS spec_key, s.title AS spec_title,
             (SELECT count(*) FROM task t WHERE t.source_requirement_id = r.id)::int AS task_count,
             (SELECT count(*) FROM evidence e WHERE e.requirement_id = r.id)::int AS evidence_count
        FROM requirement r JOIN spec s ON s.id = r.spec_id
       WHERE r.project_id = ${input.projectId}
         AND r.removed_in_version_id IS NULL${specFilter}${statusFilter}
       ORDER BY r.ref
    `);
    return rows;
  }

  /** EP-REQ-02 — 버전 이력 + 파생 Task + Evidence */
  async requirement(input: { projectId: string; ref: string }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.ref, r.statement_md, r.acceptance_md, r.priority::text AS priority,
             r.impl_status::text AS impl_status, r.verified_at, s.key AS spec_key
        FROM requirement r JOIN spec s ON s.id = r.spec_id
       WHERE r.project_id = ${input.projectId} AND r.ref = ${input.ref}
         AND r.removed_in_version_id IS NULL
    `);
    const requirement = rows[0];
    if (requirement === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.requirement.not_found'), {
        kind: 'not_found',
        ref: input.ref,
      });
    }
    const id = requirement['id'] as string;
    const { rows: history } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT rv.spec_version_id, sv.version_no, rv.change_kind::text AS change_kind,
             rv.statement_md, rv.created_at
        FROM requirement_version rv JOIN spec_version sv ON sv.id = rv.spec_version_id
       WHERE rv.requirement_id = ${id} ORDER BY sv.version_no
    `);
    const { rows: tasks } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT id, key, title, status::text AS status FROM task WHERE source_requirement_id = ${id}
    `);
    const { rows: evidence } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT id, kind::text AS kind, locator, source::text AS source, created_at
        FROM evidence WHERE requirement_id = ${id} ORDER BY created_at
    `);
    return { ...requirement, history, tasks, evidence };
  }

  /**
   * EP-REQ-03 — 증적 등록. CI 가 PAT 로 부르는 경로이기도 하다.
   * 증적이 붙으면 impl_status 를 자동으로 올리지 **않는다** — 무엇이 구현됐다는 판단은
   * 사람·게이트의 몫이고, 증적은 그 판단의 재료다(§5.5 "증적 결손"이 그래서 의미를 갖는다).
   */
  async addEvidence(input: {
    projectId: string;
    ref: string;
    kind: string;
    locator: string;
    repo?: string | null;
    userId: string;
    sessionId?: string | null;
  }): Promise<Record<string, unknown>> {
    const requirement = await this.requirement({ projectId: input.projectId, ref: input.ref });
    const evidenceId = newId();
    await this.db.execute(sql`
      INSERT INTO evidence (id, project_id, requirement_id, kind, locator, repo, source)
      VALUES (${evidenceId}, ${input.projectId}, ${requirement['id'] as string},
              ${input.kind}::evidence_kind, ${input.locator}, ${input.repo ?? null},
              ${input.sessionId == null ? 'human' : 'agent'}::evidence_source)
    `);
    return { evidence_id: evidenceId, ref: input.ref, kind: input.kind, locator: input.locator };
  }

  /**
   * EP-MIR-01 — md 미러. **DB 가 진실이고 md 는 그 표현이다**(D-09).
   *
   * 이 표면이 있는 이유는 에이전트·CI·사람이 "그냥 문서를 읽고 싶을 때" REST 봉투를 벗기지
   * 않아도 되게 하기 위해서다. frontmatter 에 안정 ID·버전·상태·승인자를 실어, 파일로
   * 저장해도 출처를 잃지 않게 한다.
   */
  async mirrorMarkdown(input: {
    projectId: string;
    specKey: string;
    versionNo?: number | null;
  }): Promise<string> {
    const spec = await this.get(input);
    const requirements = (spec['requirements'] ?? []) as Record<string, unknown>[];
    const frontmatter = [
      '---',
      `id: ${String(spec['key'])}`,
      `title: ${String(spec['title'])}`,
      `type: ${String(spec['type'])}`,
      `version: ${String(spec['version_no'])}`,
      `status: ${String(spec['doc_status'])}`,
      `requirements: [${requirements.map((r) => String(r['ref'])).join(', ')}]`,
      // 이 파일이 어느 시점의 스냅샷인지 — 버전 지정 조회의 근거가 된다
      `basis_superseded: ${String(spec['basis_superseded'] === true)}`,
      '---',
      '',
    ].join('\n');
    return `${frontmatter}${String(spec['body_md'] ?? '')}`;
  }

  /**
   * EP-MIR-02 — `llms.txt`. 스펙 트리의 색인이다(llms.txt v2 형식).
   *
   * 에이전트가 처음 붙었을 때 "이 프로젝트에 무엇이 있나"를 한 파일로 answer 한다 —
   * 트리 API 를 부르지 못하는 소비자(웹 크롤러·다른 도구)도 같은 지도를 본다.
   */
  async llmsTxt(input: { projectId: string; projectName: string }): Promise<string> {
    const nodes = await this.tree({ projectId: input.projectId });
    const lines = [
      `# ${input.projectName}`,
      '',
      text('export.index_lead'),
      '',
      text('export.index_specs'),
      '',
    ];
    for (const node of nodes) {
      const status = node.doc_status === null ? 'draft' : node.doc_status;
      lines.push(`- [${node.title}](./specs/${node.key}.md): ${node.type} · ${status}`);
    }
    return `${lines.join('\n')}\n`;
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  /**
   * 웹 딥링크 — E10-S04.
   *
   * 에이전트가 초안을 저장하고 "확인해주세요"라고만 말하면 사람은 그 문서를 찾아 들어가야
   * 한다. 링크 하나가 그 왕복을 없앤다 — 터미널과 웹이 같은 초안을 오가는 D-09 의 실물이다.
   * 절대 URL 은 `NERV_PUBLIC_URL` 이 있을 때만 만든다(환경마다 호스트가 다르다).
   */
  private async webUrl(tx: Tx, projectId: string, specId: string): Promise<string> {
    const { rows } = await tx.execute<{ slug: string; key: string }>(sql`
      SELECT p.slug, s.key FROM spec s JOIN project p ON p.id = s.project_id
       WHERE s.id = ${specId} AND p.id = ${projectId}
    `);
    const row = rows[0];
    const path = row === undefined ? '/' : `/p/${row.slug}/specs/${row.key}`;
    const base = process.env['NERV_PUBLIC_URL'];
    return base === undefined || base === '' ? path : `${base.replace(/\/$/, '')}${path}`;
  }

  /**
   * 선언 관계 — **주지 않았으면 건드리지 않는다.** 그 구분이 이 래퍼의 전부다:
   * 본문만 고치는 저장이 매번 선언 관계를 쓸어버리면 아무도 관계를 선언하지 않게 된다.
   */
  private async syncDeclared(
    tx: Tx,
    projectId: string,
    specId: string,
    declared: readonly { to: string; kind: string }[] | undefined,
  ): Promise<string[] | null> {
    if (declared === undefined) return null;
    return this.relationService.syncDeclared(tx, { projectId, specId, declared });
  }

  /**
   * REQ-API-024 — 저장 커밋과 **같은 트랜잭션**에서 참조 관계를 동기화한다(E09-S09).
   *
   * 같은 트랜잭션이어야 하는 이유: 본문과 관계가 갈라지면 역참조 조회가 거짓말을 하고,
   * 거짓말하는 역참조는 없느니만 못하다(수정 전 영향 확인의 근거이기 때문이다).
   */
  private async syncRelations(
    tx: Tx,
    projectId: string,
    specId: string,
    bodyMd: string,
  ): Promise<RelationSyncResult> {
    const { rows } = await tx.execute<{ key: string }>(
      sql`SELECT key FROM spec WHERE id = ${specId}`,
    );
    return this.relationService.syncFromBody(tx, {
      projectId,
      specId,
      specKey: rows[0]?.key ?? '',
      bodyMd,
    });
  }

  private async requireSpec(
    tx: Tx,
    projectId: string,
    key: string,
  ): Promise<{ id: string; title: string; parent_id: string | null }> {
    const { rows } = await tx.execute<{ id: string; title: string; parent_id: string | null }>(
      sql`SELECT id, title, parent_id FROM spec WHERE project_id = ${projectId} AND key = ${key}`,
    );
    const spec = rows[0];
    if (spec === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: key,
      });
    }
    return spec;
  }

  /** candidate 가 root 의 자손이거나 root 자신인가 — 트리 사이클 판정(EP-SPEC-15). */
  private async isDescendant(tx: Tx, rootId: string, candidateId: string): Promise<boolean> {
    if (rootId === candidateId) return true;
    const { rows } = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE down AS (
        SELECT id FROM spec WHERE id = ${rootId}
        UNION
        SELECT c.id FROM spec c JOIN down ON c.parent_id = down.id
      )
      SELECT id FROM down WHERE id = ${candidateId}
    `);
    return rows.length > 0;
  }

  /**
   * 지금 열려 있는 초안 — **행을 잠그고** 읽는다(§1.4g).
   *
   * 잠그지 않으면 두 트랜잭션이 같은 해시를 읽고 둘 다 비교-교환을 통과한다. 제출·승인은
   * 이미 `FOR UPDATE` 로 직렬화하고 있었는데 정작 본문 저장만 비어 있었다(실측 2026-08-30:
   * 세 세션 동시 저장 → 3건 다 성공, 남은 본문은 하나).
   */
  private async currentDraft(
    tx: Tx,
    specId: string,
  ): Promise<{
    id: string;
    version_no: number;
    content_hash: string;
    edit_lease_user_id: string | null;
    edit_lease_session_id: string | null;
    edit_lease_expires_at: unknown;
  } | null> {
    const { rows } = await tx.execute<{
      id: string;
      version_no: number;
      content_hash: string;
      edit_lease_user_id: string | null;
      edit_lease_session_id: string | null;
      edit_lease_expires_at: unknown;
    }>(sql`
      SELECT id, version_no, encode(content_hash, 'hex') AS content_hash,
             edit_lease_user_id, edit_lease_session_id, edit_lease_expires_at
        FROM spec_version WHERE spec_id = ${specId} AND status = 'draft'
       ORDER BY version_no DESC LIMIT 1
         FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  /**
   * 초안 편집 리스 — **보유자는 세션이다**(2026-08-30 개정 — 사람 결정).
   *
   * 예전 규칙은 "같은 사용자면 자동 인계"였다. 그런데 실제 배치는 **PAT 하나 = 사용자 하나 =
   * 세션 여럿**이다 — 같은 사람 이름으로 도는 병렬 에이전트 셋과 웹 탭 하나가 서로를 전혀
   * 막지 않았다. 리스는 있는데 아무것도 잠그지 않는 상태였다(실측 2026-08-30).
   *
   * 이제는 `(user, session)` 이 같아야 자기 리스다. 남의 리스 위에 쓰려면 `takeover: true` 를
   * **명시해야** 한다 — 죽은 세션이 30분짜리 리스를 쥔 채 사라지는 것이 가장 흔한 상황이라
   * 뺏는 경로가 없으면 사람이 갇힌다. 뺏은 사실은 이벤트에 남는다.
   */
  private async assertDraftLease(
    tx: Tx,
    draft: {
      edit_lease_user_id: string | null;
      edit_lease_session_id: string | null;
      edit_lease_expires_at: unknown;
    },
    actor: { userId: string; sessionId: string | null; takeover: boolean },
  ): Promise<boolean> {
    const holder = draft.edit_lease_user_id;
    if (holder === null) return false;
    const expires =
      draft.edit_lease_expires_at === null ? null : toDate(draft.edit_lease_expires_at);
    if (expires !== null && expires.getTime() <= Date.now()) return false; // 만료 — 비어 있다
    // **쥔 세션이 죽었으면 비어 있는 것과 같다**(2026-08-30 사람 결정). 하트비트는 60초마다
    // 오고 있었는데 리스가 그 신호를 안 봤다 — 크래시한 에이전트의 리스가 30분을 버텼다.
    if (await this.leaseSessionDead(tx, draft.edit_lease_session_id)) return false;
    // 같은 세션이 이어 쓰는 것 — 웹 탭(세션 없음)끼리도 같은 사람이면 한 자리로 본다
    if (holder === actor.userId && (draft.edit_lease_session_id ?? null) === actor.sessionId) {
      return false;
    }
    if (actor.takeover) return true; // 명시적으로 뺏었다 — 이벤트에 남긴다

    throw new NervError(NERV_ERROR.DRAFT_LEASED, msg('error.spec.draft_leased'), {
      kind: 'draft_leased',
      holder_user_id: holder,
      holder_session_id: draft.edit_lease_session_id,
      holder: await this.leaseHolderLabel(tx, draft),
      expires_at: expires?.toISOString() ?? null,
      // 막다른 길이 아니라는 것을 오류가 스스로 말한다 — 안 그러면 사람은 만료를 기다린다
      takeover: true,
    });
  }

  /**
   * 리스를 쥔 세션이 죽었나 — 하트비트 3주기(180초) 침묵이면 죽은 것으로 본다.
   *
   * 세션이 없는 표면(웹 탭)에는 적용하지 않는다: 하트비트가 없으니 판정할 근거도 없고,
   * 적용하면 사람이 20분 쓰는 동안 남이 그 자리를 가져간다.
   */
  private async leaseSessionDead(tx: Tx, sessionId: string | null): Promise<boolean> {
    if (sessionId === null) return false;
    const { rows } = await tx.execute<{ dead: boolean }>(sql`
      SELECT (state NOT IN ('pending', 'active', 'awaiting_input')
              OR coalesce(last_heartbeat_at, started_at)
                 < now() - ${sqlSeconds(LEASE_HEARTBEAT_GRACE_SECONDS)}
             ) AS dead
        FROM agent_session WHERE id = ${sessionId}
    `);
    // 세션 행이 없으면(지워졌다) 그 리스를 지킬 이유도 없다
    return rows[0]?.dead ?? true;
  }

  /** 누가 쥐고 있나 — 사람이 읽을 이름. 세션이면 에이전트·호스트, 아니면 사용자 표시 이름 */
  private async leaseHolderLabel(
    tx: Tx,
    draft: { edit_lease_user_id: string | null; edit_lease_session_id: string | null },
  ): Promise<string | null> {
    if (draft.edit_lease_session_id !== null) {
      const { rows } = await tx.execute<{ agent_type: string; hostname: string }>(sql`
        SELECT agent_type, hostname FROM agent_session WHERE id = ${draft.edit_lease_session_id}
      `);
      const row = rows[0];
      if (row !== undefined) return `${row.agent_type} · ${row.hostname}`;
    }
    if (draft.edit_lease_user_id === null) return null;
    const { rows } = await tx.execute<{ display_name: string }>(sql`
      SELECT display_name FROM "user" WHERE id = ${draft.edit_lease_user_id}
    `);
    return rows[0]?.display_name ?? null;
  }

  /**
   * 게이트 4축 추정 — 참조 수·파생 Task 수를 세고, **요구사항 델타를 본문에서 읽는다**.
   *
   * 예전에는 추가·삭제를 상수 0 으로 넘기고 '수정' 은 `requirement` 행의 **존재 여부**로
   * 근사했다. 그런데 그 표를 채우는 것은 임포터뿐이라(같은 파일 §diff 주석) 에이전트가 쓴
   * 스펙에는 행이 하나도 없다 — feature 타입이 부작용 0 + 민감도 1 = 1점으로 **T0** 이 되어
   * 사람 승인 없이 approved 로 갔다. 사람 승인 게이트(FR-06·D-06)가 새 문서에서 통째로
   * 열려 있었다는 뜻이다.
   *
   * 본문에서 요구사항을 읽는 함수는 이미 있었고(`specDelta` — 저장 응답이 쓴다) 게이트만
   * 그것을 쓰지 않았다. 기준은 **현재 approved 본문**이다: 새 문서면 이전이 없으므로 본문의
   * 요구사항 전부가 추가다.
   */
  private async assessGate(
    tx: Tx,
    specId: string,
    specType: string,
    specVersionId: string,
  ): Promise<GateDecision> {
    const { rows } = await tx.execute<{
      referencing: number;
      tasks: number;
      requirements: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM spec_relation WHERE to_spec_id = ${specId}) AS referencing,
        (SELECT count(*)::int FROM task t JOIN spec_version sv ON sv.id = t.source_spec_version_id
          WHERE sv.spec_id = ${specId}) AS tasks,
        (SELECT count(*)::int FROM requirement WHERE spec_id = ${specId}) AS requirements
    `);
    const counts = rows[0] ?? { referencing: 0, tasks: 0, requirements: 0 };

    const { rows: bodies } = await tx.execute<{ body_md: string; base_md: string | null }>(sql`
      SELECT sv.body_md,
             (SELECT prev.body_md FROM spec_version prev
               WHERE prev.spec_id = sv.spec_id AND prev.status = 'approved' AND prev.id <> sv.id
               ORDER BY prev.version_no DESC LIMIT 1) AS base_md
        FROM spec_version sv WHERE sv.id = ${specVersionId}
    `);
    const delta = specDelta(bodies[0]?.base_md ?? null, bodies[0]?.body_md ?? '');

    return decideGate(
      inferAxes({
        specType,
        requirementsAdded: delta.requirements.added.length,
        requirementsRemoved: delta.requirements.removed.length,
        // 본문에서 읽은 수정이 우선이고, 행이 있는 문서(임포트본)는 그 존재도 신호로 쓴다
        requirementsModified:
          delta.requirements.modified.length > 0
            ? delta.requirements.modified.length
            : counts.requirements > 0
              ? 1
              : 0,
        bodyChanged: true,
        referencingSpecs: counts.referencing,
        derivedTasks: counts.tasks,
        // 승인된 약속이 사라지는 것은 되돌리기 어려운 변경이다(gate-tier 의 축)
        approvedRequirementsRemoved:
          bodies[0]?.base_md != null && delta.requirements.removed.length > 0,
      }),
    );
  }

  /** 승인 확정 — 이전 approved 를 superseded 로 밀고 참조 전파 신호를 낸다. */
  private async approveInTx(
    tx: Tx,
    emit: (
      input: Parameters<Parameters<EventService['transact']>[0]>[1] extends (i: infer I) => unknown
        ? I
        : never,
    ) => Promise<unknown>,
    input: {
      projectId: string;
      specVersionId: string;
      specId: string;
      approverUserId: string | null;
      gate: GateDecision;
    },
  ): Promise<void> {
    // 같은 Spec 의 이전 approved 를 superseded 로 (서버 자동 전이 — §1.2)
    const { rows: superseded } = await tx.execute<{ id: string }>(sql`
      UPDATE spec_version
         SET status = 'superseded', superseded_by_version_id = ${input.specVersionId}
       WHERE spec_id = ${input.specId} AND status = 'approved' AND id <> ${input.specVersionId}
      RETURNING id
    `);

    await tx.execute(sql`
      UPDATE spec_version
         SET status = 'approved', approved_at = now(), approved_by_user_id = ${input.approverUserId}
       WHERE id = ${input.specVersionId}
    `);
    await tx.execute(
      sql`UPDATE spec SET current_version_id = ${input.specVersionId} WHERE id = ${input.specId}`,
    );

    await emit({
      type: NERV_EVENT.SPEC_APPROVED,
      projectId: input.projectId,
      subjectType: 'spec_version',
      subjectId: input.specVersionId,
      subjectKey: await this.keyOfVersion(tx, input.specVersionId),
      actorUserId: input.approverUserId,
      isAgent: false,
      fromState: 'in_review',
      toState: 'approved',
      payload: { gate_tier: input.gate.tier, auto_passed: input.gate.autoPass },
    });

    for (const old of superseded) {
      await emit({
        type: NERV_EVENT.SPEC_SUPERSEDED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: old.id,
        actorUserId: input.approverUserId,
        isAgent: false,
        fromState: 'approved',
        toState: 'superseded',
      });

      // 기준 버전이 지나간 Task 에 재브리핑 플래그를 세운다(spec-workflow §3.3)
      const { rows: rebriefed } = await tx.execute<{ id: string }>(sql`
        UPDATE task SET rebrief_required_at = now()
         WHERE source_spec_version_id = ${old.id} AND status NOT IN ('done', 'blocked')
        RETURNING id
      `);
      for (const task of rebriefed) {
        await emit({
          type: NERV_EVENT.TASK_REBRIEF_REQUIRED,
          projectId: input.projectId,
          subjectType: 'task',
          subjectId: task.id,
          isAgent: false,
        });
      }
    }

    // 참조 전파 — 이 스펙을 참조하는 문서에 재검토 신호(§3.3)
    const { rows: referencing } = await tx.execute<{ from_spec_id: string }>(
      sql`SELECT from_spec_id FROM spec_relation WHERE to_spec_id = ${input.specId}`,
    );
    for (const ref of referencing) {
      await emit({
        type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: ref.from_spec_id,
        isAgent: false,
        payload: { because_of: input.specId },
      });
    }
  }

  /**
   * 지시자≠승인자 (D-06 · §2.3).
   * **CHECK 로 내리지 않은 이유**가 여기 있다 — 소규모 완화가 있어서다: 멤버가 2인 미만이면
   * 차단 대신 통과시키고 감사 이벤트를 남긴다. 하드 제약이면 1인 팀이 아무것도 승인할 수 없다.
   */
  private async assertDifferentApprover(
    tx: Tx,
    input: { projectId: string; approverUserId: string },
    authorUserId: string,
  ): Promise<void> {
    if (input.approverUserId !== authorUserId) return;

    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT user_id)::int AS n FROM membership
       WHERE project_id = ${input.projectId} OR project_id IS NULL
    `);
    const members = rows[0]?.n ?? 1;
    if (members < 2) {
      this.logger.warn(`소규모 완화 — 멤버 ${members}인이라 자기 승인을 허용한다(감사 기록됨)`);
      return;
    }
    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.self_approve_spec'), {
      kind: 'self_approval',
      author_user_id: authorUserId,
    });
  }

  /** pending Approval 재사용 — 같은 초안을 다시 제출해도 카드가 늘지 않는다(§2.5). */
  private async ensurePendingApproval(
    tx: Tx,
    input: {
      projectId: string;
      specVersionId: string;
      requestedByUserId: string;
      requestedBySessionId: string | null;
    },
  ): Promise<string> {
    const { rows: existing } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM approval
       WHERE project_id = ${input.projectId} AND subject_type = 'spec_version'
         AND subject_id = ${input.specVersionId} AND decision IS NULL
    `);
    const found = existing[0]?.id;
    if (found !== undefined) return found;

    const approvalId = newId();
    await tx.execute(sql`
      INSERT INTO approval (id, project_id, subject_type, subject_id,
                            requested_by_user_id, requested_by_session_id)
      VALUES (${approvalId}, ${input.projectId}, 'spec_version', ${input.specVersionId},
              ${input.requestedByUserId}, ${input.requestedBySessionId})
    `);
    return approvalId;
  }

  /**
   * 기존 스펙에 온 메타가 현재 값과 다른지 본다(REQ-API-021). 같으면 통과 — 멱등
   * 재호출은 같은 본문·같은 메타로 다시 오기 때문이다.
   */
  private async assertMetaUnchanged(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    specId: string,
    input: DraftUpsertInput,
  ): Promise<void> {
    const { rows } = await tx.execute<{ parent_id: string | null; type: string; title: string }>(
      sql`SELECT parent_id, type::text AS type, title FROM spec WHERE id = ${specId}`,
    );
    const current = rows[0];
    if (current === undefined) return;
    const changed: string[] = [];
    if (input.parentId !== undefined && (input.parentId ?? null) !== current.parent_id) {
      changed.push('parent_id');
    }
    if (input.type !== undefined && input.type !== current.type) changed.push('type');
    if (input.title !== undefined && input.title !== current.title) changed.push('title');
    if (changed.length === 0) return;
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.meta_change_not_allowed'), {
      kind: 'meta_change_not_allowed',
      fields: changed,
      endpoint: 'EP-SPEC-15',
    });
  }
}

/**
 * 줄 단위 diff — LCS 기반. 라이브러리를 넣지 않는 이유는 본문 diff 가 이 파일에서
 * **부차적**이기 때문이다(리뷰의 주 신호는 요구사항 델타다). 필요가 커지면 그때 교체한다.
 */
/**
 * 요구사항 행이 없는 문서의 델타 — 본문에서 읽어 같은 모양으로 만든다.
 *
 * 조회(`requirement_version`)와 **같은 필드 이름**을 낸다: 화면이 두 경로를 구분할 이유가
 * 없고, 구분하게 두면 한쪽만 고치는 날이 온다.
 */
function requirementDeltaFromBody(before: string, after: string): Record<string, unknown>[] {
  const from = requirementsOf(before);
  const to = requirementsOf(after);
  const refs = [...new Set([...from.keys(), ...to.keys()])].sort();
  return refs.map((ref) => {
    const a = from.get(ref);
    const b = to.get(ref);
    const delta =
      a === undefined ? 'added' : b === undefined ? 'removed' : a === b ? 'unchanged' : 'modified';
    return { ref, statement_md: b ?? a ?? '', delta };
  });
}

function lineDiff(before: string, after: string): { op: string; text: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i];
      const next = lcs[i + 1];
      if (row === undefined || next === undefined) continue;
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: { op: string; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ op: 'del', text: a[i] ?? '' });
      i += 1;
    } else {
      out.push({ op: 'add', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < a.length) out.push({ op: 'del', text: a[(i += 1) - 1] ?? '' });
  while (j < b.length) out.push({ op: 'add', text: b[(j += 1) - 1] ?? '' });
  return out;
}
