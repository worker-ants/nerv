// E09-S06·S08·S09·S10·S11·S12 · E10-S03 — 스펙 도메인 나머지 표면
//
// 이 파일이 지키는 것은 하나다: **문서가 살아 움직여도 참조·기준선·이력이 거짓말하지 않는 것**.
// clemvion 에서 실패한 지점이 정확히 여기였다 — 문서를 옮기면 링크가 끊기고, 폐기된 결정이
// 다른 문서에서 계속 살아 있고(R-3), "이때의 스펙"을 되짚을 방법이 없었다.

// **임베딩 제공자를 죽은 주소로 고정한다.** 아래 두 테스트("제공자가 없으면"·"죽어 있으면")는
// 원래 기본 URL(localhost:8090)에 아무도 없다는 **주변 상황**에 기대고 있었다. 로컬 임베딩
// 프로필(ollama)을 켜 둔 기계에서는 그 가정이 깨져 두 건이 실패한다 — 코드가 아니라 개발자의
// 기계 상태를 검사하고 있었던 것이다(실측). 조건은 가정하지 않고 만든다.
// 포트 1 은 특권 포트라 누구도 듣지 않는다 — 즉시 ECONNREFUSED 다.
process.env['NERV_EMBED_URL'] = 'http://127.0.0.1:1/v1';

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaselineService } from '../../src/modules/spec/baseline.service.js';
import { EmbeddingService, slugify } from '../../src/modules/spec/embedding.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { SearchService } from '../../src/modules/spec/search.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let relations: SpecRelationService;
let baselines: BaselineService;
let comments: SpecCommentService;
let search: SearchService;
let embeddings: EmbeddingService;
let projectId: string;
let planner: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_specdom');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  relations = new SpecRelationService(drizzleDb);
  const attachments = new AttachmentService(null as never, drizzleDb);
  specs = new SpecService(
    events,
    new SpecCheckService(drizzleDb),
    relations,
    new SpecCommentService(events, drizzleDb),
    attachments,
    drizzleDb,
  );
  baselines = new BaselineService(events, drizzleDb);
  comments = new SpecCommentService(events, drizzleDb);
  search = new SearchService(drizzleDb);
  embeddings = new EmbeddingService(drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  // 작업이 먼저다 — 작업이 기준선을 가리킬 수 있다(REQ-API-203 의 테스트가 그렇게 만든다)
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task');
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM spec_baseline_item');
  await pool.query('DELETE FROM spec_baseline');
  await pool.query('DELETE FROM spec_comment');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM requirement_version');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM attachment');
  await pool.query('DELETE FROM spec_chunk_embedding');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
});

async function draft(
  key: string,
  body: string,
  title = key,
): Promise<{ specId: string; versionId: string }> {
  const r = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title,
    type: 'feature',
    bodyMd: body,
    userId: planner,
  });
  return { specId: r['spec_id'] as string, versionId: r['spec_version_id'] as string };
}

async function approve(versionId: string): Promise<void> {
  await pool.query(
    `UPDATE spec_version
        SET status = 'approved', approved_at = now(), approved_by_user_id = $2,
            edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
      WHERE id = $1`,
    [versionId, planner],
  );
  await pool.query(
    `UPDATE spec SET current_version_id = $1 WHERE id = (SELECT spec_id FROM spec_version WHERE id = $1)`,
    [versionId],
  );
}

// ── E09-S09 · S12 관계 ───────────────────────────────────────────────────────

/**
 * 지금 본문의 지문 — 편집 저장의 `base_hash` 다(api.md §1.4g).
 *
 * 테스트의 주제는 비교-교환이 아니라 그 위의 동작이므로, "읽고 그 지문으로 쓴다"를
 * 여기 한 줄로 감춘다. 동시성 자체는 spec-concurrency.spec.ts 가 본다.
 */
async function hashOf(specId: string): Promise<string> {
  // 키로도 UUID 로도 부른다 — 도구가 둘 다 받으므로 테스트도 그렇다(§1.4b)
  const { rows } = await pool.query<{ h: string }>(
    `SELECT encode(v.content_hash, 'hex') AS h
       FROM spec_version v JOIN spec s ON s.id = v.spec_id
      WHERE (s.id::text = $1 OR s.key = $1)
      ORDER BY v.version_no DESC LIMIT 1`,
    [specId],
  );
  return rows[0]?.h ?? '';
}

/**
 * EP-SPEC-15 `owner_role` — **존재하지 않는 타입으로 캐스팅하고 있었다.**
 *
 * `membership_role` 은 이 스키마에 없는 이름이라(실물은 `member_role`) 이 경로는 100% 500
 * 이었고, 42704 는 db-error 의 변환표 밖이라 같은 요청의 다른 필드까지 롤백시켰다 —
 * 라이브 실측(2026-09-03)에서 title 과 함께 보낸 요청이 title 도 잃었다. 실데이터의 스펙
 * 158개 전부 owner_role 이 NULL 인 것이 "안 쓴다" 가 아니라 "쓸 수 없다" 였던 이유다.
 */
describe('EP-SPEC-15 owner_role (2026-09-03)', () => {
  it('소유 역할을 저장한다 — 그리고 같은 요청의 다른 필드를 잃지 않는다', async () => {
    const { specId } = await draft('SPC-OWNER', '# 소유');
    const updated = await specs.updateMeta({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-OWNER',
      userId: planner,
      title: '소유자가 있는 문서',
      ownerRole: 'designer',
    });
    expect(updated).toBeTruthy();

    const { rows } = await pool.query<{ owner_role: string; title: string }>(
      `SELECT owner_role::text AS owner_role, title FROM spec WHERE id = $1`,
      [specId],
    );
    expect(rows[0]).toMatchObject({ owner_role: 'designer', title: '소유자가 있는 문서' });
  });

  it('상세가 메타의 지금 값을 준다 — 메타 다이얼로그가 그것을 보인다 (REQ-WEB-267)', async () => {
    await draft('SPC-META-P', '# 부모');
    await draft('SPC-META-C', '# 자식');
    await specs.updateMeta({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-META-C',
      userId: planner,
      parentKey: 'SPC-META-P',
      sortKey: '030',
      ownerRole: 'qa',
    });
    const got = await specs.get({ projectId, specKey: 'SPC-META-C', basis: 'latest' });
    expect(got).toMatchObject({ parent_key: 'SPC-META-P', sort_key: '030', owner_role: 'qa' });

    // 맨 위의 문서는 부모가 없다 · 주인 역할을 정하지 않았으면 없다
    const top = await specs.get({ projectId, specKey: 'SPC-META-P', basis: 'latest' });
    expect(top).toMatchObject({ parent_key: null, owner_role: null });
  });

  it('어휘 밖의 역할은 400 이다 — 500 이 아니다', async () => {
    await draft('SPC-OWNER-BAD', '# 소유');
    await expect(
      specs.updateMeta({
        actor: { userId: planner, isAgent: false },
        projectId,
        specKey: 'SPC-OWNER-BAD',
        userId: planner,
        ownerRole: 'wizard',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });
});

describe('E09-S09 본문에서 참조 관계를 뽑는다', () => {
  it('실존하는 스펙만 관계가 되고 나머지는 경고다 — 아직 안 쓴 문서를 참조하는 건 정상이다', async () => {
    await draft('SPC-A', '# A');
    const b = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-B',
      title: 'B',
      type: 'feature',
      // **링크만 센다**(2026-08-30) — 산문에 적힌 키는 관계가 아니다
      bodyMd:
        '# B\n\n[A](SPC-A) 를 따르고 [없는 문서](SPC-NOPE) 도 링크한다. SPC-C 는 산문이라 세지 않는다',
      userId: planner,
    });
    const sync = b['relations'] as { added: string[]; unknown: string[] };
    expect(sync.added).toEqual(['SPC-A']);
    expect(sync.unknown).toEqual(['SPC-NOPE']);
  });

  it('본문에서 사라진 참조는 관계에서도 사라진다 — 한 방향으로만 자라면 그래프는 신뢰를 잃는다', async () => {
    await draft('SPC-A', '# A');
    await draft('SPC-C', '# C');
    const b = await draft('SPC-B', '# B\n\n[A](SPC-A) · [C](/p/x/specs/SPC-C)');
    expect(
      (await relations.list({ projectId, specKey: 'SPC-B', direction: 'out' })).items,
    ).toHaveLength(2);

    const again = await specs.draftUpsert({
      baseHash: await hashOf(b.specId),
      roles: ['planner'],
      projectId,
      specId: b.specId,
      bodyMd: '# B\n\n[A](SPC-A) 만 남긴다',
      userId: planner,
    });
    expect((again['relations'] as { removed: string[] }).removed).toEqual(['SPC-C']);
    const after = await relations.list({ projectId, specKey: 'SPC-B', direction: 'out' });
    expect(after.items.map((i) => i['key'])).toEqual(['SPC-A']);
  });

  /**
   * **관계 목록에는 상한이 없다**(2026-09-07 · REQ-API-155).
   *
   * 예전에는 `LIMIT 51` 뒤 `rows.length` 라 `total = min(총계, 51)` 이었고, 정렬이
   * `direction` 먼저라 'in' 이 'out' 을 통째로 밀어냈다 — 관계가 50건을 넘는 문서에서
   * 웹은 **"역참조 50 · 레퍼런스 0"** 을 그렸다(실측 data-model: in 50 · out 43).
   * "이걸 고치면 무엇이 흔들리나" 에 답하려고 만든 화면이 흔들리는 것 절반을 숨겼다.
   */
  it('역참조 60건도 전부 나온다 — 상한이 방향 하나를 통째로 밀어내지 않는다', async () => {
    const target = await draft('SPC-HUB', '# 허브');
    for (let i = 0; i < 60; i += 1) {
      await draft(`SPC-REF-${String(i).padStart(2, '0')}`, `# 참조 ${i}\n\n[허브](SPC-HUB)`);
    }
    // 허브도 하나를 가리킨다 — 'out' 이 밀려나는지 보려면 양방향이 있어야 한다
    await draft('SPC-DOWN', '# 하류');
    await specs.draftUpsert({
      baseHash: await hashOf(target.specId),
      roles: ['planner'],
      projectId,
      specId: target.specId,
      bodyMd: '# 허브\n\n[하류](SPC-DOWN) 로 이어진다',
      userId: planner,
    });

    const both = await relations.list({ projectId, specKey: 'SPC-HUB', direction: 'both' });
    expect(both.total).toBe(61);
    expect(both.items).toHaveLength(61);
    expect(both.items.filter((r) => r['direction'] === 'in')).toHaveLength(60);
    // 상한이 있으면 이 줄이 0 이 된다 — 'in' 이 정렬에서 앞이기 때문이다
    expect(both.items.filter((r) => r['direction'] === 'out')).toHaveLength(1);

    // 요약(EP-SPEC-03 include=relations)의 수도 자른 수가 아니라 총계다
    const summary = await relations.summary({ projectId, specKey: 'SPC-HUB' });
    expect(summary.in_count).toBe(60);
    expect(summary.out_count).toBe(1);
    expect(summary.items).toHaveLength(20);
  });

  // ── 이력 (2026-08-30 — draft 는 덮어써지므로 저장하는 그 순간이 유일한 기록이다) ──
  it('무엇을 왜 바꿨나가 버전에 남는다 — 주지 않으면 앞의 것을 지우지 않는다', async () => {
    const made = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-SUMMARY',
      title: '요약',
      type: 'feature',
      bodyMd: '# 첫 버전',
      changeSummary: '첫 초안을 쓴다',
      userId: planner,
    });
    const specId = made['spec_id'] as string;
    const summaryOf = async (): Promise<string | null> => {
      const { rows } = await pool.query<{ change_summary_md: string | null }>(
        `SELECT change_summary_md FROM spec_version WHERE spec_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [specId],
      );
      return rows[0]?.change_summary_md ?? null;
    };
    expect(await summaryOf()).toBe('첫 초안을 쓴다');

    // 요약 없는 저장이 앞의 요약을 지우면, 마지막 자동 저장 하나가 이력을 비운다
    await specs.draftUpsert({
      baseHash: await hashOf(specId),
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 둘째 버전',
      userId: planner,
    });
    expect(await summaryOf()).toBe('첫 초안을 쓴다');

    await specs.draftUpsert({
      baseHash: await hashOf(specId),
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 셋째 버전',
      changeSummary: '문장을 고쳤다',
      userId: planner,
    });
    expect(await summaryOf()).toBe('문장을 고쳤다');
  });

  it('바뀐 시각은 본문이 바뀔 때만 움직인다 — 저장한 시각이 아니다', async () => {
    const made = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-TOUCHED',
      title: '시각',
      type: 'feature',
      bodyMd: '# 처음',
      userId: planner,
    });
    const specId = made['spec_id'] as string;
    const stamps = async (): Promise<{ created: string; updated: string }> => {
      const { rows } = await pool.query<{ created_at: string; updated_at: string }>(
        `SELECT created_at::text, updated_at::text FROM spec_version WHERE spec_id = $1`,
        [specId],
      );
      return { created: rows[0]?.created_at ?? '', updated: rows[0]?.updated_at ?? '' };
    };
    const first = await stamps();

    // 요약만 바꾸는 저장은 문서를 바꾸지 않는다 — 시계가 움직이면 "언제 바뀌었나"가 거짓이 된다
    await specs.draftUpsert({
      baseHash: await hashOf(specId),
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 처음',
      changeSummary: '요약만 고친다',
      userId: planner,
    });
    expect((await stamps()).updated).toBe(first.updated);

    await specs.draftUpsert({
      baseHash: await hashOf(specId),
      roles: ['planner'],
      projectId,
      specId,
      bodyMd: '# 고쳤다',
      userId: planner,
    });
    const after = await stamps();
    expect(after.updated > first.updated).toBe(true);
    // 만든 시각은 그대로다 — 그것이 두 값을 따로 두는 이유다
    expect(after.created).toBe(first.created);
  });

  it('저장이 무엇이 바뀌었는지 함께 돌려준다 — 되짚을 diff 가 없는 자리다', async () => {
    const made = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-DELTA',
      title: '델타',
      type: 'feature',
      bodyMd:
        '# 문서\n\n- REQ-SUD-001 WHEN a THE SYSTEM SHALL b\n- REQ-SUD-002 WHEN c THE SYSTEM SHALL d',
      userId: planner,
    });
    expect(made['delta']).toMatchObject({
      requirements: { added: ['REQ-SUD-001', 'REQ-SUD-002'], modified: [], removed: [] },
    });

    const again = await specs.draftUpsert({
      baseHash: await hashOf(made['spec_id'] as string),
      roles: ['planner'],
      projectId,
      specId: made['spec_id'] as string,
      bodyMd:
        '# 문서\n\n- REQ-SUD-001 WHEN a THE SYSTEM SHALL 바뀐 결과\n- REQ-SUD-003 WHEN e THE SYSTEM SHALL f',
      userId: planner,
    });
    expect(again['delta']).toMatchObject({
      requirements: {
        added: ['REQ-SUD-003'],
        modified: ['REQ-SUD-001'],
        removed: ['REQ-SUD-002'],
      },
    });
    const delta = again['delta'] as { lines: { added: number; removed: number } };
    expect(delta.lines.added).toBeGreaterThan(0);
  });

  // ── 선언 관계 (2026-08-30 — 저장 한 번에 확정한다) ──────────────────────────
  it('저장이 선언 관계까지 확정한다 — 본문에 적히지 않는 판단이라 명시해야 남는다', async () => {
    await draft('SPC-BASE', '# base');
    const child = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-REFINE',
      title: 'refine',
      type: 'feature',
      bodyMd: '# refine',
      relations: [{ to: 'SPC-BASE', kind: 'refines', baseHash: await hashOf('SPC-BASE') }],
      userId: planner,
    });
    expect((child['relations'] as { declared: string[] }).declared).toEqual(['refines:SPC-BASE']);

    const out = await relations.list({ projectId, specKey: 'SPC-REFINE', direction: 'out' });
    expect(out.items.map((i) => [i['kind'], i['key']])).toEqual([['refines', 'SPC-BASE']]);
  });

  it('주지 않으면 건드리지 않는다 — 본문만 고치는 저장이 관계를 쓸어버리면 아무도 안 쓴다', async () => {
    await draft('SPC-BASE2', '# base');
    const child = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-KEEP',
      title: 'keep',
      type: 'feature',
      bodyMd: '# keep',
      relations: [{ to: 'SPC-BASE2', kind: 'depends_on', baseHash: await hashOf('SPC-BASE2') }],
      userId: planner,
    });

    await specs.draftUpsert({
      baseHash: await hashOf(child['spec_id'] as string),
      roles: ['planner'],
      projectId,
      specId: child['spec_id'] as string,
      bodyMd: '# keep — 본문만 고친다',
      userId: planner,
    });
    const kept = await relations.list({ projectId, specKey: 'SPC-KEEP', direction: 'out' });
    expect(kept.items.map((i) => i['key'])).toEqual(['SPC-BASE2']);

    // 빈 배열은 "전부 지워라"다 — 되돌릴 길이 없으면 아무도 넣지 않는다
    await specs.draftUpsert({
      baseHash: await hashOf(child['spec_id'] as string),
      roles: ['planner'],
      projectId,
      specId: child['spec_id'] as string,
      bodyMd: '# keep — 관계를 비운다',
      relations: [],
      userId: planner,
    });
    expect(
      (await relations.list({ projectId, specKey: 'SPC-KEEP', direction: 'out' })).items,
    ).toHaveLength(0);
  });

  it('references 는 선언으로 받지 않는다 — 본문이 그것의 주인이다', async () => {
    await draft('SPC-BASE3', '# base');
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        key: 'SPC-BADKIND',
        title: 'bad',
        type: 'feature',
        bodyMd: '# bad',
        relations: [{ to: 'SPC-BASE3', kind: 'references' }],
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'auto_managed' } });
  });

  it('없는 문서를 선언하면 어느 항목인지 말한다', async () => {
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        key: 'SPC-BADREF',
        title: 'bad',
        type: 'feature',
        bodyMd: '# bad',
        relations: [{ to: 'SPC-NOWHERE', kind: 'refines' }],
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_found', field: 'relations.to' } });
  });

  it('자기 자신은 참조가 아니다', async () => {
    const r = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-SELF',
      title: 'self',
      type: 'feature',
      bodyMd: '# SPC-SELF\n\n이 문서는 [자기 자신](SPC-SELF) 이다',
      userId: planner,
    });
    expect((r['relations'] as { added: string[] }).added).toEqual([]);
  });
});

describe('E09-S12 역참조가 1급이다', () => {
  it('both 는 나가는 관계와 역참조를 방향 표시와 함께 준다', async () => {
    await draft('SPC-CORE', '# core');
    await draft('SPC-USER1', '# u1\n\n[core](SPC-CORE) 참조');
    await draft('SPC-USER2', '# u2\n\n[core](/p/x/specs/SPC-CORE) 참조');

    const backlinks = await relations.list({ projectId, specKey: 'SPC-CORE', direction: 'in' });
    expect(backlinks.items.map((i) => i['key']).sort()).toEqual(['SPC-USER1', 'SPC-USER2']);
    expect(backlinks.items.every((i) => i['direction'] === 'in')).toBe(true);

    const summary = await relations.summary({ projectId, specKey: 'SPC-CORE' });
    expect(summary.in_count).toBe(2);
    expect(summary.out_count).toBe(0);
  });
});

// ── E09-S08 메타 편집·아카이브 ───────────────────────────────────────────────

describe('E09-S08 메타 편집은 이력을 보존한다', () => {
  it('이동·개명해도 버전·관계·코멘트가 그대로다 (FR-01)', async () => {
    const parent = await draft('SPC-P', '# 부모');
    const child = await draft('SPC-CH', '# 자식\n\n[부모](SPC-P) 참조');
    const comment = await comments.add({
      projectId,
      specVersionId: child.versionId,
      anchor: '자식',
      bodyMd: '여기 이상',
      userId: planner,
    });

    await specs.updateMeta({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-CH',
      title: '새 제목',
      parentKey: 'SPC-P',
      userId: planner,
    });

    const versions = await specs.versions({ projectId, specKey: 'SPC-CH' });
    expect(versions).toHaveLength(1);
    expect(
      (await relations.list({ projectId, specKey: 'SPC-CH', direction: 'out' })).items,
    ).toHaveLength(1);
    expect((await comments.list({ projectId, specKey: 'SPC-CH' }))[0]?.['id']).toBe(
      comment.comment_id,
    );
    const { rows } = await pool.query<{ title: string; parent_id: string }>(
      `SELECT title, parent_id FROM spec WHERE id = $1`,
      [child.specId],
    );
    expect(rows[0]?.title).toBe('새 제목');
    expect(rows[0]?.parent_id).toBe(parent.specId);
  });

  it('자기 하위로의 이동은 409 — 트리가 사이클이 되면 렌더도 순회도 멈추지 않는다', async () => {
    const root = await draft('SPC-R', '# r');
    await draft('SPC-KID', '# k');
    await specs.updateMeta({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-KID',
      parentKey: 'SPC-R',
      userId: planner,
    });

    await expect(
      specs.updateMeta({
        actor: { userId: planner, isAgent: false },
        projectId,
        specKey: 'SPC-R',
        parentKey: 'SPC-KID',
        userId: planner,
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION, details: { kind: 'tree_cycle' } });
    expect(root.specId).toBeDefined();
  });

  it('살아 있는 하위 노드·활성 클레임이 있으면 아카이브를 막고 사유를 열거한다', async () => {
    await draft('SPC-BOX', '# box');
    await draft('SPC-IN', '# in');
    await specs.updateMeta({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-IN',
      parentKey: 'SPC-BOX',
      userId: planner,
    });

    const error = (await specs
      .archive({
        actor: { userId: planner, isAgent: false },
        projectId,
        specKey: 'SPC-BOX',
        userId: planner,
      })
      .catch((e: unknown) => e)) as { details: Record<string, unknown> };
    expect(error.details['kind']).toBe('archive_blocked');
    expect(error.details['blockers']).toEqual([{ kind: 'child_spec', key: 'SPC-IN' }]);
  });

  it('아카이브는 삭제가 아니다 — 기본 트리에서만 빠진다', async () => {
    await draft('SPC-OLD', '# old');
    await draft('SPC-LIVE', '# live');
    await specs.archive({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-OLD',
      userId: planner,
    });

    expect((await specs.tree({ projectId })).map((n) => n.key)).not.toContain('SPC-OLD');
    const withArchived = await specs.tree({ projectId, includeArchived: true });
    expect(withArchived.map((n) => n.key)).toContain('SPC-OLD');

    // 섞여 온 목록에서 **어느 것이 보관된 것인지** 화면이 갈라야 한다(REQ-WEB-105).
    // 이 값이 없으면 보관 보기를 켠 목록은 살아 있는 문서와 보관된 문서를 같은 무게로 그린다.
    expect(withArchived.find((n) => n.key === 'SPC-OLD')?.archived_at).not.toBeNull();
    expect(withArchived.find((n) => n.key === 'SPC-LIVE')?.archived_at).toBeNull();

    await specs.restore({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-OLD',
      userId: planner,
    });
    expect((await specs.tree({ projectId })).map((n) => n.key)).toContain('SPC-OLD');
  });

  // 복원에는 있던 규칙이 **생성·이동에는 없었다**: 보관된 부모 아래에 문서를 만들 수 있었고
  // (실측 2026-08-29 — 201), 그 문서는 기본 트리에서 부모를 못 찾아 화면에서 사라졌다.
  // 목록에 없으면 열람도 없다([4.5](screens.md) §2.4b) — 만들 수 없어야 한다.
  it('보관된 부모 아래에는 만들 수 없다 — 어느 목록에도 없는 문서가 된다', async () => {
    await draft('SPC-DEADBOX', '# box');
    await specs.archive({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-DEADBOX',
      userId: planner,
    });

    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        key: 'SPC-UNDER',
        title: '아래',
        type: 'feature',
        parentId: 'SPC-DEADBOX',
        bodyMd: '# under',
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'parent_archived', parent: 'SPC-DEADBOX' } });
  });

  it('보관된 부모로 옮길 수도 없다 — 옮기는 것은 만드는 것과 같은 결과다', async () => {
    await draft('SPC-DEADBOX2', '# box');
    await draft('SPC-MOVER', '# mover');
    await specs.archive({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-DEADBOX2',
      userId: planner,
    });

    await expect(
      specs.updateMeta({
        actor: { userId: planner, isAgent: false },
        projectId,
        specKey: 'SPC-MOVER',
        parentKey: 'SPC-DEADBOX2',
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'parent_archived', parent: 'SPC-DEADBOX2' } });
  });

  it('부모가 아카이브 상태면 복원해도 보이지 않으므로 거부한다', async () => {
    await draft('SPC-PBOX', '# p');
    await draft('SPC-PKID', '# k');
    await specs.updateMeta({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-PKID',
      parentKey: 'SPC-PBOX',
      userId: planner,
    });
    await specs.archive({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-PKID',
      userId: planner,
    });
    await specs.archive({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-PBOX',
      userId: planner,
    });

    await expect(
      specs.restore({
        actor: { userId: planner, isAgent: false },
        projectId,
        specKey: 'SPC-PKID',
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'parent_archived' } });
  });

  // ── 2026-10-04 보관 정리(REQ-API-255~257) ──────────────────────────────────

  const human = { userId: '', isAgent: false };
  const archiveAs = (key: string, actor = { ...human, userId: planner }) =>
    specs.archive({ actor, projectId, specKey: key, userId: planner });

  it('이미 보관된 문서를 다시 보관해도 처음 보관한 시각은 그대로다 (REQ-API-256)', async () => {
    const { specId } = await draft('SPC-TWICE', '# 두 번');
    await archiveAs('SPC-TWICE');
    await pool.query(`UPDATE spec SET archived_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [
      specId,
    ]);
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM event WHERE type = 'spec.archived'`,
    );

    const again = await archiveAs('SPC-TWICE');
    expect(again).toMatchObject({ archived: true, unchanged: true });
    const { rows } = await pool.query<{ at: string }>(
      `SELECT archived_at::text AS at FROM spec WHERE id = $1`,
      [specId],
    );
    expect(rows[0]?.at.startsWith('2026-01-01')).toBe(true);
    // 바뀐 것이 없으면 알릴 것도 없다
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM event WHERE type = 'spec.archived'`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    // 복구도 같은 규칙이다
    await specs.restore({
      actor: { ...human, userId: planner },
      projectId,
      specKey: 'SPC-TWICE',
      userId: planner,
    });
    const twice = await specs.restore({
      actor: { ...human, userId: planner },
      projectId,
      specKey: 'SPC-TWICE',
      userId: planner,
    });
    expect(twice).toMatchObject({ archived: false, unchanged: true });
  });

  it('끝나지 않은 작업을 알려 준다 — 보관은 그 작업을 큐에서 빼므로 (REQ-API-255)', async () => {
    const { versionId } = await draft('SPC-OPENTASK', '# 작업이 남은 문서');
    await approve(versionId);
    for (const [key, status] of [
      ['CLV-T-OPEN01', 'ready'],
      ['CLV-T-DONE01', 'done'],
    ] as const) {
      await pool.query(
        `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id, spec_impact, done_at,
                           goal_md, output_format_md, tools_sources_md, boundaries_md)
         VALUES ($1,$2,$3,$3,$4,$5,
                 ${status === 'done' ? `'{"none": true}'::jsonb, now()` : 'NULL, NULL'},
                 '목표','PR','저장소','경계')`,
        [newId(), projectId, key, status, versionId],
      );
    }
    const out = await archiveAs('SPC-OPENTASK');
    expect(out['open_tasks']).toEqual(['CLV-T-OPEN01']);
  });

  it('요구사항으로만 이어진 작업의 활성 클레임도 보관을 막는다 (REQ-API-255)', async () => {
    const { specId, versionId } = await draft('SPC-REQCLAIM', '# 요구사항');
    await approve(versionId);
    const requirementId = newId();
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-RCL-001','WHEN 조건이면 THE SYSTEM SHALL 동작한다','must',$4,$4)`,
      [requirementId, projectId, specId, versionId],
    );
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_requirement_id,
                         goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'CLV-T-RCLM01','임포트 작업','claimed',$3,'목표','PR','저장소','경계')`,
      [taskId, projectId, requirementId],
    );
    const sessionId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','mac-01','active')`,
      [sessionId, projectId, planner],
    );
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status,
                          scope_spec_ids, scope_file_globs, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active','{}','{}', now() + interval '10 minutes')`,
      [newId(), projectId, taskId, sessionId, planner],
    );

    await expect(archiveAs('SPC-REQCLAIM')).rejects.toMatchObject({
      details: {
        kind: 'archive_blocked',
        blockers: [{ kind: 'active_claim', key: 'CLV-T-RCLM01' }],
      },
    });
    await pool.query(`DELETE FROM claim WHERE task_id = $1`, [taskId]);
    await pool.query(`DELETE FROM task WHERE id = $1`, [taskId]);
    await pool.query(`DELETE FROM agent_session WHERE id = $1`, [sessionId]);
  });

  it('보관된 문서에는 초안을 쓰지도, 검토를 요청하지도 못한다 (REQ-API-257)', async () => {
    const { specId, versionId } = await draft('SPC-SHELVED', '# 보관 전 초안');
    await archiveAs('SPC-SHELVED');

    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: 'SPC-SHELVED',
        baseHash: await hashOf(specId),
        bodyMd: '# 보관 뒤에 고친 본문',
        userId: planner,
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'spec_archived', spec: 'SPC-SHELVED' },
    });
    await expect(
      specs.submitReview({ projectId, specVersionId: versionId, userId: planner }),
    ).rejects.toMatchObject({ details: { kind: 'spec_archived', spec: 'SPC-SHELVED' } });
    // 본문은 보관할 때 그대로다
    const { rows } = await pool.query<{ body_md: string; status: string }>(
      `SELECT body_md, status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]).toEqual({ body_md: '# 보관 전 초안', status: 'draft' });
  });

  it('에이전트가 막히면 프로젝트 설정이 아니라 그 문서로 안내한다 (REQ-API-256)', async () => {
    await draft('SPC-AGENTMETA', '# 메타');
    const error = (await specs
      .updateMeta({
        actor: { userId: planner, isAgent: true },
        projectId,
        specKey: 'SPC-AGENTMETA',
        title: '에이전트가 바꾸려 한 제목',
        userId: planner,
      })
      .catch((e: unknown) => e)) as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe(NERV_ERROR.HUMAN_ONLY);
    expect(error.details).toMatchObject({ kind: 'human_only', action: 'spec_meta' });
    expect(String(error.details['web_url'])).toMatch(/\/p\/clemvion\/specs\/SPC-AGENTMETA$/);
  });
});

// ── E09-S06 기준선 ───────────────────────────────────────────────────────

describe('E09-S06 기준선은 영원히 같은 답을 낸다', () => {
  it('approved 가 아닌 항목이 섞이면 전체를 거부한다 — 부분 성공은 기준선이 아니다', async () => {
    const a = await draft('SPC-BA', '# a');
    await approve(a.versionId);
    const b = await draft('SPC-BB', '# b'); // draft 그대로

    await expect(
      baselines.create({
        actor: { userId: planner, isAgent: false },
        projectId,
        name: 'r1',
        specVersionIds: [a.versionId, b.versionId],
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_approved' } });

    expect(await baselines.list(projectId)).toHaveLength(0);
  });

  it('핀된 버전이 superseded 가 되어도 조회 결과는 그대로다', async () => {
    const v1 = await draft('SPC-PIN', '# v1');
    await approve(v1.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'r1',
      userId: planner,
    });

    // v2 승인 — v1 은 superseded 가 된다
    const v2 = await specs.draftUpsert({
      baseHash: await hashOf(v1.specId),
      roles: ['planner'],
      projectId,
      specId: v1.specId,
      bodyMd: '# v2',
      userId: planner,
    });
    await approve(v2['spec_version_id'] as string);
    await pool.query(
      `UPDATE spec_version SET status = 'superseded', superseded_by_version_id = $2 WHERE id = $1`,
      [v1.versionId, v2['spec_version_id']],
    );

    const detail = await baselines.get({ projectId, name: 'r1' });
    const items = detail['items'] as Record<string, unknown>[];
    expect(items[0]?.['pinned_version_no']).toBe(1);
    expect(items[0]?.['latest_approved_version_no']).toBe(2);
    expect(items[0]?.['drifted']).toBe(true);
  });

  /**
   * 소비 축(REQ-API-087) — **기준선은 읽힐 때 값이 생긴다.**
   *
   * 생성·불변은 2026-08 부터 있었지만 그 세트로 문서를 읽는 길이 없었고, 그래서 실사용
   * 기준선이 **0개**였다(실측 2026-09-04). 여기가 그 길이다.
   */
  it('그 세트가 묶어 둔 버전을 읽는다 — 뒤에 새 버전이 승인돼도 그대로다', async () => {
    const v1 = await draft('SPC-READ', '# v1');
    await approve(v1.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'r1',
      userId: planner,
    });

    const v2 = await specs.draftUpsert({
      baseHash: await hashOf(v1.specId),
      roles: ['planner'],
      projectId,
      specId: v1.specId,
      bodyMd: '# v2',
      userId: planner,
    });
    await approve(v2['spec_version_id'] as string);

    // 기본은 최신 approved 다
    const latest = await specs.get({ projectId, specKey: 'SPC-READ' });
    expect(latest['version_no']).toBe(2);
    expect(latest['body_md']).toBe('# v2');

    // 기준선으로 읽으면 그때 그 버전이다
    const pinned = await specs.get({ projectId, specKey: 'SPC-READ', baseline: 'r1' });
    expect(pinned['version_no']).toBe(1);
    expect(pinned['body_md']).toBe('# v1');
    expect(pinned['baseline_pinned']).toBe(true);
    expect(pinned['baseline']).toBe('r1');
  });

  /**
   * 이름이 맞는데 그 세트에 이 문서가 없는 것은 **오류가 아니다** — 나중에 만들어진
   * 문서가 그렇다. 다만 읽는 쪽이 "기준선을 읽었다" 고 믿으면 안 되므로 말해 준다.
   */
  it('그 세트에 없는 문서는 기본으로 떨어지되 그 사실을 말한다', async () => {
    const older = await draft('SPC-OLD', '# old');
    await approve(older.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'r1',
      userId: planner,
    });

    // 기준선 이후에 생긴 문서
    const newer = await draft('SPC-NEW', '# new');
    await approve(newer.versionId);

    const read = await specs.get({ projectId, specKey: 'SPC-NEW', baseline: 'r1' });
    expect(read['version_no']).toBe(1);
    expect(read['baseline_pinned']).toBe(false);
  });

  /**
   * **오타는 조용히 기본값이 되지 않는다.** 이 저장소가 이미 판정한 규칙이다
   * (REQ-API-082 — "조용한 무시가 500 보다 나쁘다": 사람은 걸러진 화면이라고 믿는다).
   */
  it('없는 기준선 이름은 거부한다 — 조용히 최신을 주지 않는다', async () => {
    const v = await draft('SPC-TYPO', '# x');
    await approve(v.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'r1',
      userId: planner,
    });

    await expect(
      specs.get({ projectId, specKey: 'SPC-TYPO', baseline: 'r2' }),
    ).rejects.toMatchObject({
      details: { kind: 'invalid_input', field: 'baseline', unknown: ['r2'] },
    });
  });

  /**
   * 실사용 보고(2026-09-04): 에이전트가 `nerv_spec_attach` 로 파일을 올린 뒤 **되읽을
   * 길이 없어** "이 배포에는 첨부를 확인할 경로가 없다" 고 결론지었다. `include` 에
   * `["attachments"]` 를 실으면 `ok:true` 가 오는데 응답에 첨부 필드가 없었다.
   *
   * 있는데 못 쓴 것과 없는 것을 구별할 수 없으면 사람은 **없는 쪽을 믿는다.**
   */
  it('include 에 attachments 를 실으면 첨부가 함께 온다', async () => {
    const v = await draft('SPC-ATT-INC', '# a');
    await approve(v.versionId);
    // 확정된 첨부를 직접 심는다 — 여기서 보려는 것은 업로드가 아니라 **되읽는 길**이다
    const attachmentId = newId();
    await pool.query(
      `INSERT INTO attachment (id, project_id, spec_id, storage_key, filename, content_type,
                               bytes, checksum, uploaded_by_user_id, committed_at)
       VALUES ($1,$2,$3,$4,'리포트.html','text/html',13,'x',$5, now())`,
      [attachmentId, projectId, v.specId, `k/${attachmentId}`, planner],
    );

    const got = await specs.get({
      projectId,
      specKey: 'SPC-ATT-INC',
      include: ['attachments'],
    });
    const list = got['attachments'] as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]?.['filename']).toBe('리포트.html');
    expect(list[0]?.['id']).toBe(attachmentId);
  });

  it('요청하지 않으면 첨부는 오지 않는다 — 응답이 조용히 두꺼워지지 않는다', async () => {
    await draft('SPC-ATT-OFF', '# a');
    const got = await specs.get({ projectId, specKey: 'SPC-ATT-OFF' });
    expect(got['attachments']).toBeUndefined();
  });

  /** **모르는 값은 조용히 버리지 않는다**(REQ-API-082 와 같은 규율). */
  it('include 의 모르는 값은 거부한다 — 허용 목록을 함께 말한다', async () => {
    await draft('SPC-ATT-BAD', '# a');
    await expect(
      specs.get({ projectId, specKey: 'SPC-ATT-BAD', include: ['nope'] }),
    ).rejects.toMatchObject({
      details: { kind: 'invalid_input', field: 'include', unknown: ['nope'] },
    });
  });

  it('manifest 는 baseline 이름 또는 as_of 중 하나로만 본다', async () => {
    const v = await draft('SPC-MAN', '# m');
    await approve(v.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'r1',
      userId: planner,
    });

    const byName = await baselines.manifest({ projectId, baselineName: 'r1' });
    expect(byName['source']).toBe('baseline');
    expect((byName['specs'] as Record<string, unknown>)['SPC-MAN']).toMatchObject({
      version_no: 1,
    });

    const now = await baselines.manifest({ projectId });
    expect(now['source']).toBe('current');

    await expect(
      baselines.manifest({ projectId, baselineName: 'r1', asOf: '2026-01-01T00:00:00Z' }),
    ).rejects.toMatchObject({ details: { kind: 'exclusive_params' } });
  });

  it('같은 이름의 기준선을 두 번 만들 수 없다 — 이름이 곧 참조 수단이다', async () => {
    const v = await draft('SPC-DUP', '# d');
    await approve(v.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'r1',
      userId: planner,
    });
    await expect(
      baselines.create({
        actor: { userId: planner, isAgent: false },
        projectId,
        name: 'r1',
        userId: planner,
      }),
    ).rejects.toMatchObject({
      details: { kind: 'duplicate_name' },
    });
  });
});

// ── E10-S03 코멘트 ───────────────────────────────────────────────────────────

describe('E10-S03 코멘트는 앵커를 가진다', () => {
  it('앵커 없는 코멘트는 만들 수 없다 — 위치 없는 지적은 고칠 수 없다', async () => {
    const s = await draft('SPC-CM', '# 문서');
    await expect(
      comments.add({
        projectId,
        specVersionId: s.versionId,
        anchor: '  ',
        bodyMd: '음',
        userId: planner,
      }),
    ).rejects.toMatchObject({ details: { kind: 'missing_anchor' } });
  });

  it('해소하면 남은 open 수를 돌려준다 — 에이전트가 스스로 마무리를 판단한다', async () => {
    const s = await draft('SPC-CM2', '# 문서');
    const first = await comments.add({
      projectId,
      specVersionId: s.versionId,
      anchor: '문서',
      bodyMd: 'A',
      userId: planner,
    });
    await comments.add({
      projectId,
      specVersionId: s.versionId,
      anchor: 'REQ-CWC-031',
      bodyMd: 'B',
      userId: planner,
    });
    expect(first.open_count).toBe(1);

    const resolved = await comments.resolve({
      projectId,
      commentId: first.comment_id,
      resolutionNote: '반영함',
      userId: planner,
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.open_count).toBe(1);

    // 재호출은 성공이다 — 재시도가 실패로 보이면 안 된다
    const again = await comments.resolve({
      projectId,
      commentId: first.comment_id,
      userId: planner,
    });
    expect(again.status).toBe('resolved');
    expect(await comments.openCountFor(s.specId)).toBe(1);
  });
});

/**
 * **누가 지적했고, 목록의 행이 무엇을 손봐야 하는지 말한다**(2026-09-24 — UI/UX 검토 SPEC-04·13 ·
 * REQ-API-183). 코멘트 줄에는 앵커와 본문뿐이었고, 목록의 행에는 최근 갱신과 열린 코멘트 수가 없었다.
 */
describe('코멘트의 작성자 · 목록 행의 갱신 시각과 열린 코멘트 (REQ-API-183)', () => {
  it('코멘트 목록이 작성자 이름과 해소한 사람을 싣는다', async () => {
    const s = await draft('SPC-CM-WHO', '# 문서');
    const made = await comments.add({
      projectId,
      specVersionId: s.versionId,
      anchor: '문서',
      bodyMd: '누가 썼나',
      userId: planner,
    });
    await comments.resolve({ projectId, commentId: made.comment_id, userId: planner });
    const [row] = await comments.list({ projectId, specKey: 'SPC-CM-WHO' });
    const { rows } = await pool.query<{ name: string }>(
      `SELECT display_name AS name FROM "user" WHERE id = $1`,
      [planner],
    );
    expect(row).toMatchObject({
      author_name: rows[0]?.name,
      resolved_by_name: rows[0]?.name,
      version_no: 1,
    });
  });

  it('트리의 행이 최근 갱신 시각과 열린 코멘트 수를 싣는다', async () => {
    const s = await draft('SPC-CM-ROW', '# 문서');
    for (const body of ['하나', '둘']) {
      await comments.add({
        projectId,
        specVersionId: s.versionId,
        anchor: '문서',
        bodyMd: body,
        userId: planner,
      });
    }
    const nodes = await specs.tree({ projectId });
    const row = nodes.find((n) => n.key === 'SPC-CM-ROW');
    expect(row?.open_comments).toBe(2);
    expect(row?.updated_at).not.toBeNull();
  });
});

// ── E09-S10 검색 ─────────────────────────────────────────────────────────────

describe('E09-S10 하이브리드 검색', () => {
  it('고정 ID 는 전문 검색을 거치지 않고 직행한다', async () => {
    const s = await draft('SPC-CWC-007', '# 웹챗 위젯 임베드\n\n본문', '웹챗 위젯 임베드');
    await approve(s.versionId);
    const result = await search.search({ projectId, query: 'SPC-CWC-007' });
    expect(result.items[0]?.key).toBe('SPC-CWC-007');
    expect(result.items[0]?.matched_by).toContain('id');
  });

  /**
   * **접두가 아니라 키다**(2026-09-07). 예전에는 `SPC-`·`REQ-`·`TSK-` 접두를 ID 직행의
   * 규칙으로 삼았는데, 표시 키 형식은 2026-08-23 에 `<PRJ>-<타입>-<base32 6>` 로 바뀌었다 —
   * 실데이터에서 그 접두를 가진 Task 는 **한 건도 없었다**(0/487). 사람이 커밋 메시지에서
   * 본 키를 그대로 치는 것이 이 경로의 가장 흔한 쓰임인데 그때 아무것도 걸리지 않았다.
   */
  it('접두 없는 키도 직행한다 — Task 키까지 같은 경로다', async () => {
    const s = await draft('SUD-DSN-UI', '# 화면\n\n본문', '화면 설계');
    await approve(s.versionId);
    const bySpec = await search.search({ projectId, query: 'SUD-DSN-UI' });
    expect(bySpec.items[0]?.key).toBe('SUD-DSN-UI');
    expect(bySpec.items[0]?.matched_by).toContain('id');
    expect(bySpec.items[0]?.['kind']).toBe('spec');

    const taskKey = 'CLV-T-ZWHNB0';
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status) VALUES ($1,$2,$3,'위젯 렌더링','backlog')`,
      [newId(), projectId, taskKey],
    );
    const byTask = await search.search({ projectId, query: taskKey });
    expect(byTask.items[0]?.key).toBe(taskKey);
    expect(byTask.items[0]?.['kind']).toBe('task');
  });

  // ── 2026-10-04 문서 번호(REQ-API-258 · 259) ───────────────────────────────

  it('소문자 · 한 단어 · 숫자로 시작하는 키도 번호로 맞고, 대소문자를 가리지 않는다 (REQ-API-258)', async () => {
    for (const key of ['channel-web-chat', 'README', '03-proposal-vision']) {
      const s = await draft(key, `# ${key}\n\n본문`, `문서 ${key}`);
      await approve(s.versionId);
    }
    for (const [query, key] of [
      ['channel-web-chat', 'channel-web-chat'],
      ['CHANNEL-WEB-CHAT', 'channel-web-chat'],
      ['readme', 'README'],
      ['03-proposal-vision', '03-proposal-vision'],
    ] as const) {
      const result = await search.search({ projectId, query });
      expect(result.items[0]?.key, query).toBe(key);
      expect(result.items[0]?.matched_by, query).toContain('id');
    }
  });

  it('번호가 맞으면 맨 위다 — 승인 문서의 본문 일치가 초안을 밀어내지 않는다 (REQ-API-258)', async () => {
    // 초안은 상태 가산점이 없다. 순위 합산에 섞이던 때는 번호를 본문에 적은 승인 문서가 위로 갔다
    await draft('SPC-PIN-001', '# 초안\n\n아직 초안이다', '초안 문서');
    const other = await draft(
      'SPC-PIN-002',
      '# SPC-PIN-001 을 이어받는 문서\n\nSPC-PIN-001 SPC-PIN-001',
      'SPC-PIN-001 이어받기',
    );
    await approve(other.versionId);

    const result = await search.search({ projectId, query: 'spc-pin-001' });
    expect(result.items[0]?.key).toBe('SPC-PIN-001');
    expect(result.items.map((i) => i.key)).toContain('SPC-PIN-002');
  });

  it('UUID 로도 맞는다 (REQ-API-258 · S3)', async () => {
    const s = await draft('SPC-UUID-001', '# 문서\n\n본문', 'UUID 로 찾는 문서');
    const result = await search.search({ projectId, query: s.specId });
    expect(result.items[0]?.key).toBe('SPC-UUID-001');
    expect(result.items[0]?.matched_by).toContain('id');
  });

  it('보관된 문서도 번호로는 찾고, 보관됐다는 사실을 함께 준다 (REQ-API-258)', async () => {
    await draft('SPC-SHELF-001', '# 문서\n\n본문', '보관할 문서');
    await specs.archive({
      actor: { userId: planner, isAgent: false },
      projectId,
      specKey: 'SPC-SHELF-001',
      userId: planner,
    });
    const result = await search.search({ projectId, query: 'SPC-SHELF-001' });
    expect(result.items[0]?.key).toBe('SPC-SHELF-001');
    expect(result.items[0]?.archived_at).not.toBeNull();
    // 일부로 찾을 때는 보관 판정이 다른 단계와 같다 — 켜지 않으면 빠진다
    const partial = await search.search({ projectId, query: 'SHELF' });
    expect(partial.items.map((i) => i.key)).not.toContain('SPC-SHELF-001');
    const withArchived = await search.search({ projectId, query: 'SHELF', includeArchived: true });
    expect(withArchived.items.map((i) => i.key)).toContain('SPC-SHELF-001');
  });

  it('번호의 일부로 찾는다 — 끝이 맞는 것 · 짧은 것이 먼저다 (REQ-API-259)', async () => {
    for (const key of ['SPC-FRG-007', 'FRG-007-EXTRA', 'SPC-FRG-0070']) {
      const s = await draft(key, `# ${key}\n\n본문`, `일부 ${key}`);
      await approve(s.versionId);
    }
    const result = await search.search({ projectId, query: 'frg-007' });
    const keyed = result.items.filter((i) => i.matched_by.includes('key')).map((i) => i.key);
    // 끝이 맞는 SPC-FRG-007 → 앞이 맞는 FRG-007-EXTRA → 가운데의 SPC-FRG-0070
    expect(keyed).toEqual(['SPC-FRG-007', 'FRG-007-EXTRA', 'SPC-FRG-0070']);
    expect(result.items[0]?.key).toBe('SPC-FRG-007');
    // 두 글자는 일부 일치를 하지 않는다
    const short = await search.search({ projectId, query: 'FR' });
    expect(short.items.some((i) => i.matched_by.includes('key'))).toBe(false);
  });

  it('일부 일치는 맨 위에 다섯 건까지만 올린다 — 모든 키에 든 토막이 본문 일치를 밀어내지 않게 (REQ-API-259)', async () => {
    for (let i = 1; i <= 7; i += 1) {
      const key = `CAP-${String(i).padStart(3, '0')}`;
      const s = await draft(key, `# ${key}\n\n본문`, `상한 ${key}`);
      await approve(s.versionId);
    }
    const result = await search.search({ projectId, query: 'CAP', limit: 20 });
    const head = result.items.slice(0, 5);
    expect(head.every((i) => i.matched_by.includes('key'))).toBe(true);
    // 나머지 일부 일치도 사라지지 않는다 — 다른 결과와 함께 순위로 섞인다
    expect(result.items.filter((i) => i.matched_by.includes('key'))).toHaveLength(7);
  });

  it('한국어 조사 변형을 trgm 이 잡는다 — simple 토크나이저만으로는 "위젯"≠"위젯을" 이다', async () => {
    const s = await draft(
      'SPC-KR-001',
      '# 문서\n\n방문자가 위젯을 열면 대화를 복원한다',
      '위젯 임베드',
    );
    await approve(s.versionId);
    const result = await search.search({ projectId, query: '위젯' });
    expect(result.items.map((i) => i.key)).toContain('SPC-KR-001');
  });

  it('임베딩 제공자가 없으면 렉시컬만으로 200 + degraded 다 (REQ-API-026)', async () => {
    const s = await draft('SPC-DEG-001', '# 문서\n\n세션 복원 API 설계', '세션 복원');
    await approve(s.versionId);
    const result = await search.search({ projectId, query: '세션 복원' });
    // 제공자를 죽은 주소로 고정해 두었다(파일 선두) — 그래서 이 경로가 실제로 검증된다
    expect(result.degraded).toBe('lexical-only');
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('관계 확장은 별도 그룹이다 — 본 랭킹에 섞지 않는다', async () => {
    const core = await draft('SPC-GR-001', '# 세션 복원 API\n\n본문', '세션 복원 API');
    await approve(core.versionId);
    // 링크 **글자**에 질의어를 넣지 않는다 — 넣으면 이 문서가 본 결과로 올라와
    // 관계 그룹에서 빠진다(related 는 본 결과와 겹치지 않는다). 그건 이 검사의 주제가 아니다
    const dep = await draft('SPC-GR-002', '# 위젯\n\n[그 문서](SPC-GR-001) 에 의존한다', '위젯');
    await approve(dep.versionId);

    const result = await search.search({ projectId, query: '세션 복원' });
    expect(result.items.map((i) => i.key)).toContain('SPC-GR-001');
    expect(result.related.map((r) => r['key'])).toContain('SPC-GR-002');
  });

  it('references 필터는 그 스펙을 참조하는 문서만 남긴다', async () => {
    const core = await draft('SPC-RF-001', '# 공통 규약\n\n본문', '공통 규약');
    await approve(core.versionId);
    const user = await draft(
      'SPC-RF-002',
      '# 공통 규약 사용\n\n[공통 규약](SPC-RF-001) 참조',
      '공통 규약 사용',
    );
    await approve(user.versionId);

    const filtered = await search.search({
      projectId,
      query: '공통 규약',
      references: 'SPC-RF-001',
    });
    expect(filtered.items.map((i) => i.key)).toEqual(['SPC-RF-002']);
  });

  /**
   * **자르기 전에 거른다**(2026-09-07 · REQ-API-154). 필터 넷 중 종류·상태·요구사항은
   * `limit` 앞에서 걸리는데 `references` 만 뒤에서 걸렸다 — 참조하는 문서가 상위 `limit`
   * 밖이면 **있는데도 빈 결과**다. "이걸 고치면 무엇이 흔들리나" 에 답하려고 만든 필터가
   * 조용히 "아무것도 안 흔들린다" 고 답하던 셈이다.
   */
  it('references 는 자르기 전에 걸린다 — 상위 limit 밖의 참조도 나온다', async () => {
    const core = await draft('SPC-RL-001', '# 잘림 규약\n\n본문', '잘림 규약');
    await approve(core.versionId);
    // 질의어를 그대로 담은 잡음 문서 셋 — 참조 문서보다 위에 온다
    for (const n of [1, 2, 3]) {
      const noise = await draft(`SPC-RL-N0${n}`, `# 잘림 규약 잡음 ${n}\n\n잘림 규약`, '잘림 규약');
      await approve(noise.versionId);
    }
    const user = await draft(
      'SPC-RL-002',
      '# 사용처\n\n[잘림 규약](SPC-RL-001) 을 따른다',
      '사용처',
    );
    await approve(user.versionId);

    // limit 2 — 후보 풀(limit*3)에는 들어오지만 상위 2 안에는 없다. 자른 뒤에 걸면 빈 목록이다.
    const filtered = await search.search({
      projectId,
      query: '잘림 규약',
      references: 'SPC-RL-001',
      limit: 2,
    });
    expect(filtered.items.map((i) => i.key)).toEqual(['SPC-RL-002']);
  });
});

// ── E09-S11 임베딩 파이프라인 ────────────────────────────────────────────────

describe('E09-S11 임베딩 파이프라인', () => {
  it('청크는 헤딩 단위이고 도입부도 버리지 않는다', () => {
    const chunks = embeddings.chunk('도입 문장\n\n# 첫 절\n내용 A\n\n## 둘째 절\n내용 B');
    expect(chunks.map((c) => c.anchor)).toEqual(['_intro', '첫-절', '둘째-절']);
    expect(chunks[1]?.text).toContain('내용 A');
  });

  it('같은 제목이 두 번 나와도 앵커가 충돌하지 않는다', () => {
    const chunks = embeddings.chunk('## 배경\nA\n\n## 배경\nB');
    expect(chunks.map((c) => c.anchor)).toEqual(['배경', '배경-2']);
  });

  it('앵커 slug 는 코멘트 앵커와 같은 규약이다 (D-09)', () => {
    expect(slugify('## `nerv_spec_get` 도구')).toBe('nerv_spec_get-도구');
    expect(slugify('A B  C')).toBe('a-b-c');
  });

  it('인덱싱 대상은 최신 approved + 현재 draft 뿐이다 — 과거 버전은 렉시컬로 충분하다', async () => {
    const v1 = await draft('SPC-IX', '# v1');
    await approve(v1.versionId);
    const v2 = await specs.draftUpsert({
      baseHash: await hashOf(v1.specId),
      roles: ['planner'],
      projectId,
      specId: v1.specId,
      bodyMd: '# v2',
      userId: planner,
    });
    await pool.query(`UPDATE spec_version SET status = 'superseded' WHERE id = $1`, [v1.versionId]);
    await approve(v2['spec_version_id'] as string);

    const targets = await embeddings.indexableVersions(projectId);
    expect(targets.map((t) => t.id)).toEqual([v2['spec_version_id']]);
  });

  it('제공자가 죽어 있으면 아무것도 적재하지 않고 오류로 보고한다', async () => {
    const s = await draft('SPC-EMB', '# 문서\n\n본문');
    await approve(s.versionId);
    const report = await embeddings.runOnce({ projectId });
    expect(report.error).not.toBeNull();
    expect(report.chunks_embedded).toBe(0);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM spec_chunk_embedding`);
    expect(rows[0]?.n).toBe(0);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'jimin@example.com','지민','active')`,
    [planner],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, planner],
  );
}

// 2026-09-01 사람 요청 — 버전 간 차이를 화면에서 보고 싶다.
// **서버는 처음부터 줄 수 있었다**(EP-SPEC-06, 2026-08-22). 그런데 부르는 쪽이 없어서
// **테스트도 0건**이었다 — 아무도 안 쓰는 계약은 언젠가 조용히 깨진다.
describe('EP-SPEC-06 버전 diff', () => {
  async function twoVersions(): Promise<{ specId: string }> {
    const first = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-DIFF',
      title: 'diff',
      type: 'feature',
      bodyMd: '# 제목\n\n첫 문단\n\n공통 문단',
      userId: planner,
    });
    const specId = first['spec_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: first['spec_version_id'] as string,
      userId: planner,
    });
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      baseHash: await hashOf(specId),
      bodyMd: '# 제목\n\n고친 문단\n\n공통 문단\n\n새 문단',
      userId: planner,
    });
    return { specId };
  }

  async function latestVersionId(specId: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM spec_version WHERE spec_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [specId],
    );
    return rows[0]!.id;
  }

  it('기본은 최신과 그 직전이다 — 가장 흔한 물음이 인자 없이 답해진다', async () => {
    await twoVersions();
    const out = await specs.diff({ projectId, specKey: 'SPC-DIFF' });
    expect(out['from']).toMatchObject({ version_no: 1 });
    expect(out['to']).toMatchObject({ version_no: 2 });
  });

  it('본문 diff 는 바뀐 줄만 op 로 가른다 — 같은 줄은 same 이다', async () => {
    await twoVersions();
    const out = await specs.diff({ projectId, specKey: 'SPC-DIFF' });
    const body = out['body_diff'] as { op: string; text: string }[];
    expect(body.filter((l) => l.op === 'del').map((l) => l.text)).toContain('첫 문단');
    expect(body.filter((l) => l.op === 'add').map((l) => l.text)).toContain('고친 문단');
    expect(body.filter((l) => l.op === 'add').map((l) => l.text)).toContain('새 문단');
    // 안 바뀐 줄은 남아 있어야 한다 — 화면이 그것으로 맥락을 만든다
    expect(body.filter((l) => l.op === 'same').map((l) => l.text)).toContain('공통 문단');
  });

  it('요구사항 델타는 계산이 아니라 조회다 — added·modified·removed 를 가른다', async () => {
    const first = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-DIFF-REQ',
      title: 'req',
      type: 'feature',
      bodyMd:
        '# 제목\n\nREQ-DIF-001 WHEN 가 오면 THE SYSTEM SHALL 나 한다\n\nREQ-DIF-002 WHEN 다 오면 THE SYSTEM SHALL 라 한다',
      userId: planner,
    });
    const specId = first['spec_id'] as string;
    await specs.submitReview({
      projectId,
      specVersionId: first['spec_version_id'] as string,
      userId: planner,
    });
    // 검토 중인 버전 위에는 새 초안을 만들 수 없다(M4 · REQ-API-200) — 승인된 뒤 다음 버전을 쓴다
    await approve(first['spec_version_id'] as string);
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      baseHash: await hashOf(specId),
      bodyMd:
        '# 제목\n\nREQ-DIF-001 WHEN 가 오면 THE SYSTEM SHALL **다르게** 한다\n\nREQ-DIF-003 WHEN 마 오면 THE SYSTEM SHALL 바 한다',
      userId: planner,
    });

    const out = await specs.diff({ projectId, specKey: 'SPC-DIFF-REQ' });
    const byRef = Object.fromEntries(
      (out['requirements'] as Record<string, unknown>[]).map((r) => [r['ref'], r['delta']]),
    );
    expect(byRef['REQ-DIF-001']).toBe('modified');
    expect(byRef['REQ-DIF-002']).toBe('removed');
    expect(byRef['REQ-DIF-003']).toBe('added');
  });

  it('임의의 두 버전을 견준다 — 인접하지 않아도 된다', async () => {
    const { specId } = await twoVersions();
    await specs.submitReview({
      projectId,
      specVersionId: (await latestVersionId(specId)) as string,
      userId: planner,
    });
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId,
      baseHash: await hashOf(specId),
      bodyMd: '# 제목\n\n세 번째 버전',
      userId: planner,
    });

    const out = await specs.diff({
      projectId,
      specKey: 'SPC-DIFF',
      fromVersionNo: 1,
      toVersionNo: 3,
    });
    expect(out['from']).toMatchObject({ version_no: 1 });
    expect(out['to']).toMatchObject({ version_no: 3 });
    const body = out['body_diff'] as { op: string; text: string }[];
    expect(body.filter((l) => l.op === 'add').map((l) => l.text)).toContain('세 번째 버전');
  });

  it('없는 버전을 가리키면 못 찾았다고 말한다 — 조용히 최신을 주지 않는다', async () => {
    await twoVersions();
    await expect(
      specs.diff({ projectId, specKey: 'SPC-DIFF', fromVersionNo: 99, toVersionNo: 2 }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION, details: { kind: 'not_found' } });
  });
});

/**
 * **기준선을 고르면 목록도 그 세트다**(REQ-API-098 · 2026-09-05 사람 지적).
 *
 * 4.5 §2.4 (4)는 처음부터 "목록이 그 세트에 핀된 버전 기준으로 렌더된다" 고 적었는데
 * 목록 질의는 기준선을 아예 받지 않았다. 그래서 기준선을 골라도 **그 뒤에 만들어진 문서가
 * 함께 보였고**, 보는 사람은 그 세트가 그 문서를 담고 있다고 읽었다.
 */
describe('E04 기준선 — 목록은 그 세트가 담은 것만', () => {
  it('세트 밖의 문서는 목록에 없다 — 기준선 뒤에 만든 것이 섞이지 않는다', async () => {
    const before = await draft('SPC-BL-BEFORE', '# 먼저 만든 문서');
    await approve(before.versionId);
    const set = await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-LIST-1',
      userId: planner,
      specVersionIds: [before.versionId],
    });
    expect(set['name']).toBe('R-LIST-1');

    // 기준선을 만든 **뒤에** 문서를 하나 더 만든다
    const after = await draft('SPC-BL-AFTER', '# 나중에 만든 문서');
    await approve(after.versionId);

    const all = await specs.tree({ projectId });
    expect(all.map((n) => n.key)).toEqual(
      expect.arrayContaining(['SPC-BL-BEFORE', 'SPC-BL-AFTER']),
    );

    const pinned = await specs.tree({ projectId, baseline: 'R-LIST-1' });
    expect(pinned.map((n) => n.key)).toEqual(['SPC-BL-BEFORE']);
  });

  it('버전도 그 세트의 것이다 — 나중 버전이 아니라 담을 때의 버전을 보인다', async () => {
    const first = await draft('SPC-BL-VER', '# 첫 버전');
    await approve(first.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-LIST-2',
      userId: planner,
      specVersionIds: [first.versionId],
    });

    // 같은 문서의 다음 버전을 승인한다 — 기준선은 그 전 버전을 붙들고 있어야 한다
    const current = await specs.get({ projectId, specKey: 'SPC-BL-VER' });
    const next = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: first.specId,
      bodyMd: '# 둘째 버전',
      baseHash: String(current['content_hash']),
      userId: planner,
    });
    await approve(String(next['spec_version_id']));

    const now = await specs.tree({ projectId, root: 'SPC-BL-VER' });
    expect(now[0]?.version_no).toBe(2);

    const pinned = await specs.tree({ projectId, root: 'SPC-BL-VER', baseline: 'R-LIST-2' });
    expect(pinned[0]?.version_no).toBe(1);
  });

  it('없는 기준선은 거절한다 — 조용히 전체로 떨어지면 그 세트를 읽었다고 믿는다', async () => {
    await expect(specs.tree({ projectId, baseline: 'R-NOPE' })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { field: 'baseline', unknown: ['R-NOPE'] },
    });
  });
});

/**
 * **보기 기준 — 승인본 · 최신 · 기준선**(2026-09-27 사람 결정 · REQ-API-193~196).
 *
 * 목록이 `current_version_id`(최신 승인본)만 읽어서, 승인된 문서 위에 에이전트가 쓴 v2 초안은
 * 목록 · 트리 · 그래프 어디에도 나오지 않았고 상태 필터 "초안" 에도 걸리지 않았다(사람 보고).
 */
describe('REQ-API-193~196 보기 기준', () => {
  /** 승인된 v1 위에 v2 초안이 있는 문서 하나 */
  async function approvedWithDraft(
    key: string,
  ): Promise<{ specId: string; v1: string; v2: string }> {
    const first = await draft(key, '# 규칙\n\n스도쿠 기본 규칙');
    await approve(first.versionId);
    const next = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: first.specId,
      bodyMd: '# 규칙\n\n변형 규칙 킬러케이지 합계',
      baseHash: await hashOf(first.specId),
      userId: planner,
    });
    return { specId: first.specId, v1: first.versionId, v2: String(next['spec_version_id']) };
  }

  it('기본(승인본)은 지금과 같고, 줄마다 가장 새 버전과 최신 승인본 번호가 함께 온다 (REQ-API-194)', async () => {
    await approvedWithDraft('SPC-VB-1');
    const [row] = await specs.tree({ projectId, root: 'SPC-VB-1' });
    expect(row).toMatchObject({
      version_no: 1,
      doc_status: 'approved',
      latest_version_no: 2,
      latest_status: 'draft',
      approved_version_no: 1,
    });
  });

  it('최신 기준이면 승인본 위의 초안이 줄의 버전과 상태가 되고, 상태 필터 "초안" 에 걸린다 (REQ-API-193)', async () => {
    await approvedWithDraft('SPC-VB-2');
    const [row] = await specs.tree({ projectId, root: 'SPC-VB-2', basis: 'latest' });
    expect(row).toMatchObject({ version_no: 2, doc_status: 'draft', approved_version_no: 1 });

    const draftsNow = await specs.tree({ projectId, statuses: ['draft'] });
    expect(draftsNow.filter((n) => n.matched !== false).map((n) => n.key)).not.toContain(
      'SPC-VB-2',
    );
    const draftsLatest = await specs.tree({ projectId, statuses: ['draft'], basis: 'latest' });
    expect(draftsLatest.map((n) => n.key)).toContain('SPC-VB-2');

    // 그래프 · 표도 같은 버전을 읽는다
    const graph = await specs.graph({ projectId, basis: 'latest' });
    expect(graph.nodes.find((n) => n.key === 'SPC-VB-2')?.version_no).toBe(2);
  });

  it('승인된 적 없는 문서는 두 기준이 같고, 최신 승인본 번호는 null 이다', async () => {
    await draft('SPC-VB-NEW', '# 새 문서');
    const [plain] = await specs.tree({ projectId, root: 'SPC-VB-NEW' });
    const [latest] = await specs.tree({ projectId, root: 'SPC-VB-NEW', basis: 'latest' });
    expect(plain).toMatchObject({ version_no: 1, doc_status: 'draft', approved_version_no: null });
    expect(latest).toMatchObject({ version_no: 1, doc_status: 'draft' });
  });

  it('문서 한 건도 최신 기준으로 읽고, 승인본 번호와 기준을 함께 돌려준다', async () => {
    await approvedWithDraft('SPC-VB-GET');
    const plain = await specs.get({ projectId, specKey: 'SPC-VB-GET' });
    expect(plain).toMatchObject({ version_no: 1, doc_status: 'approved', latest_version_no: 2 });
    expect(plain['basis']).toBeUndefined();

    const latest = await specs.get({ projectId, specKey: 'SPC-VB-GET', basis: 'latest' });
    expect(latest).toMatchObject({
      version_no: 2,
      doc_status: 'draft',
      approved_version_no: 1,
      latest_version_no: 2,
      basis: 'latest',
    });
    expect(String(latest['body_md'])).toContain('킬러케이지');
  });

  it('보기 기준은 기준선 · 버전 번호와 함께 받지 않고, 어휘 밖 값은 거절한다 (REQ-API-196)', async () => {
    const one = await approvedWithDraft('SPC-VB-X');
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-VB-X',
      userId: planner,
      specVersionIds: [one.v1],
    });
    const exclusive = { code: NERV_ERROR.PRECONDITION, details: { field: 'basis' } };
    await expect(
      specs.tree({ projectId, basis: 'latest', baseline: 'R-VB-X' }),
    ).rejects.toMatchObject(exclusive);
    await expect(
      specs.get({ projectId, specKey: 'SPC-VB-X', basis: 'latest', versionNo: 1 }),
    ).rejects.toMatchObject(exclusive);
    await expect(
      search.search({ projectId, query: '규칙', basis: 'approved', baseline: 'R-VB-X' }),
    ).rejects.toMatchObject(exclusive);
    await expect(specs.tree({ projectId, basis: 'newest' })).rejects.toMatchObject({
      details: { kind: 'invalid_input', field: 'basis', unknown: ['newest'] },
    });
  });

  it('검색은 고른 기준의 본문에서 찾고, 무엇으로 찾았는지 돌려준다 (REQ-API-195)', async () => {
    await approvedWithDraft('SPC-VB-S');
    const plain = await search.search({ projectId, query: '킬러케이지' });
    expect(plain.basis).toBe('approved');
    expect(plain.items.map((i) => i.key)).not.toContain('SPC-VB-S');

    const latest = await search.search({ projectId, query: '킬러케이지', basis: 'latest' });
    expect(latest.basis).toBe('latest');
    const hit = latest.items.find((i) => i.key === 'SPC-VB-S');
    expect(hit?.doc_status).toBe('draft');
    expect(hit?.snippet).toContain('킬러케이지');
  });

  it('기준선 검색은 그 세트의 문서와 버전에서만 찾는다 — 뒤에 생긴 요구사항도 빠진다', async () => {
    const inSet = await approvedWithDraft('SPC-VB-BL');
    const outside = await draft('SPC-VB-OUT', '# 규칙\n\n세트 밖 문서의 규칙');
    await approve(outside.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-VB-S',
      userId: planner,
      specVersionIds: [inSet.v1],
    });
    // 기준선 뒤에 v2 를 승인하고, 그 버전에서 요구사항이 새로 생겼다고 친다
    await pool.query(`UPDATE spec_version SET status = 'superseded' WHERE id = $1`, [inSet.v1]);
    await approve(inSet.v2);
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, introduced_in_version_id, current_version_id)
       VALUES ($1, $2, $3, 'REQ-VB-OLD', '규칙 검사는 행마다 한다', $4, $5),
              ($6, $2, $3, 'REQ-VB-NEW', '규칙 검사는 케이지마다 한다', $5, $5)`,
      [newId(), projectId, inSet.specId, inSet.v1, inSet.v2, newId()],
    );

    const pinned = await search.search({ projectId, query: '규칙', baseline: 'R-VB-S' });
    expect(pinned).toMatchObject({ basis: 'baseline', baseline: 'R-VB-S' });
    expect(pinned.items.map((i) => i.key)).not.toContain('SPC-VB-OUT');
    const doc = pinned.items.find((i) => i.key === 'SPC-VB-BL' && i.anchor === null);
    expect(doc?.snippet).toContain('스도쿠 기본 규칙');
    const refs = pinned.items.map((i) => i.anchor).filter((a) => a !== null);
    expect(refs).toContain('REQ-VB-OLD');
    expect(refs).not.toContain('REQ-VB-NEW');

    const now = await search.search({ projectId, query: '규칙' });
    expect(now.items.map((i) => i.anchor)).toEqual(
      expect.arrayContaining(['REQ-VB-OLD', 'REQ-VB-NEW']),
    );
  });

  it('검토 중인 버전도 임베딩 대상이다 — 검토 요청으로 청크가 지워지지 않는다 (REQ-DB-017)', async () => {
    const one = await approvedWithDraft('SPC-VB-IR');
    await pool.query(
      `UPDATE spec_version
          SET status = 'in_review', edit_lease_user_id = NULL, edit_lease_session_id = NULL,
              edit_lease_expires_at = NULL
        WHERE id = $1`,
      [one.v2],
    );
    const targets = await embeddings.indexableVersions(projectId);
    expect(targets.map((t) => t.id)).toEqual(expect.arrayContaining([one.v1, one.v2]));
  });
});

/**
 * **MCP 의 두 쓰임 — 기준선 기준 개발 · 기준선 이후 문서 수정**(2026-09-27 사람 결정 · M1~M15 ·
 * REQ-API-197~209). 도구는 같은 서비스를 부르므로 판정은 여기서 본다(D-05).
 */
describe('REQ-API-197~209 읽는 기준과 편집 기준', () => {
  /** 승인된 v1 위에 v2 초안 */
  async function withDraft(key: string, v1Body: string, v2Body: string) {
    const first = await draft(key, v1Body);
    await approve(first.versionId);
    const next = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: first.specId,
      bodyMd: v2Body,
      baseHash: await hashOf(first.specId),
      userId: planner,
    });
    return { specId: first.specId, v1: first.versionId, v2: String(next['spec_version_id']) };
  }
  async function toInReview(versionId: string): Promise<void> {
    await pool.query(
      `UPDATE spec_version
          SET status = 'in_review', edit_lease_user_id = NULL, edit_lease_session_id = NULL,
              edit_lease_expires_at = NULL
        WHERE id = $1`,
      [versionId],
    );
  }

  it('무엇으로 읽었는지(read_as)와 초안 저장이 견줄 버전을 늘 준다 (M2)', async () => {
    await withDraft('SPC-RA-1', '# v1', '# v2');
    const plain = await specs.get({ projectId, specKey: 'SPC-RA-1' });
    expect(plain).toMatchObject({
      read_as: 'approved',
      version_no: 1,
      edit_base_version_no: 2,
      edit_base_status: 'draft',
    });
    expect(plain['edit_base_hash']).toBeUndefined();
    expect((await specs.get({ projectId, specKey: 'SPC-RA-1', versionNo: 1 }))['read_as']).toBe(
      'version',
    );
    expect((await specs.get({ projectId, specKey: 'SPC-RA-1', basis: 'latest' }))['read_as']).toBe(
      'latest',
    );
  });

  it('검토 중인 개정판이 있으면 편집 기준 대신 그 결재를 알리고, 새 초안은 거절한다 (M4)', async () => {
    const one = await withDraft('SPC-IR-1', '# v1', '# v2');
    await toInReview(one.v2);
    const read = await specs.get({ projectId, specKey: 'SPC-IR-1' });
    expect(read).toMatchObject({ edit_base_version_no: null, edit_blocked_by: { version_no: 2 } });
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: one.specId,
        bodyMd: '# v3',
        baseHash: String(read['content_hash']),
        userId: planner,
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'in_review_pending', version_no: 2 },
    });
  });

  it('stale_body 는 지금 버전 번호와 그 버전을 다시 읽는 호출을 준다 (M3)', async () => {
    const one = await withDraft('SPC-SB-1', '# v1', '# v2');
    const approvedHash = String(
      (await specs.get({ projectId, specKey: 'SPC-SB-1' }))['content_hash'],
    );
    await expect(
      specs.draftUpsert({
        roles: ['planner'],
        projectId,
        specId: one.specId,
        bodyMd: '# 고친 v2',
        baseHash: approvedHash,
        userId: planner,
      }),
    ).rejects.toMatchObject({
      details: {
        kind: 'stale_body',
        current_version_no: 2,
        current_status: 'draft',
        reread: { tool: 'nerv_spec_get', args: { spec_id: 'SPC-SB-1', version: 2 } },
      },
    });
  });

  it('요구사항은 읽은 버전의 것이다 — 최신 승인본이면 행, 그 밖에는 그 버전 본문 (M5)', async () => {
    const one = await withDraft(
      'SPC-RQ-1',
      '# v1\n\nREQ-RQ-001 WHEN 가 THE SYSTEM SHALL 나 한다',
      '# v2\n\nREQ-RQ-001 WHEN 가 THE SYSTEM SHALL 다르게 한다\n\nREQ-RQ-002 WHEN 다 THE SYSTEM SHALL 라 한다',
    );
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, introduced_in_version_id,
                                current_version_id, impl_status)
       VALUES ($1,$2,$3,'REQ-RQ-001','WHEN 가 THE SYSTEM SHALL 나 한다',$4,$4,'implemented')`,
      [newId(), projectId, one.specId, one.v1],
    );
    const plain = await specs.get({ projectId, specKey: 'SPC-RQ-1' });
    expect(plain['requirements_source']).toBe('current_rows');
    expect((plain['requirements'] as { ref: string }[]).map((r) => r.ref)).toEqual(['REQ-RQ-001']);

    const latest = await specs.get({ projectId, specKey: 'SPC-RQ-1', basis: 'latest' });
    expect(latest['requirements_source']).toBe('version_body');
    expect(latest['requirements']).toEqual([
      {
        ref: 'REQ-RQ-001',
        statement_md: 'WHEN 가 THE SYSTEM SHALL 다르게 한다',
        priority: null,
        impl_status: 'implemented',
        in_current: true,
      },
      {
        ref: 'REQ-RQ-002',
        statement_md: 'WHEN 다 THE SYSTEM SHALL 라 한다',
        priority: null,
        impl_status: null,
        in_current: false,
      },
    ]);
  });

  it('없는 버전 번호는 빈 본문이 아니라 거절이다 (M6)', async () => {
    await withDraft('SPC-VM-1', '# v1', '# v2');
    await expect(specs.get({ projectId, specKey: 'SPC-VM-1', versionNo: 9 })).rejects.toMatchObject(
      {
        details: { kind: 'not_found', field: 'version', version: 9, latest_version_no: 2 },
      },
    );
  });

  it('작업의 기준으로 읽는다 — 출처 문서는 기준 버전, 주변은 기준선, 세트 밖은 최신 승인본 (M7)', async () => {
    const a = await draft('SPC-TK-A', '# A v1');
    await approve(a.versionId);
    const b = await draft('SPC-TK-B', '# B v1');
    await approve(b.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-TK',
      userId: planner,
      specVersionIds: [a.versionId, b.versionId],
    });
    // 기준선 뒤에 B 의 v2 가 승인되고, 세트 밖의 C 가 생겼다
    const b2 = await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      specId: b.specId,
      bodyMd: '# B v2',
      baseHash: await hashOf(b.specId),
      userId: planner,
    });
    await pool.query(`UPDATE spec_version SET status = 'superseded' WHERE id = $1`, [b.versionId]);
    await approve(String(b2['spec_version_id']));
    const c = await draft('SPC-TK-C', '# C v1');
    await approve(c.versionId);
    const taskKey = 'CLV-T-TKBAS1';
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id, baseline_id)
       VALUES ($1,$2,$3,'기준선 작업','backlog',$4,(SELECT id FROM spec_baseline WHERE name = 'R-TK'))`,
      [newId(), projectId, taskKey, a.versionId],
    );

    expect(await specs.get({ projectId, specKey: 'SPC-TK-A', task: taskKey })).toMatchObject({
      read_as: 'task_basis',
      version_no: 1,
      task: taskKey,
    });
    expect(await specs.get({ projectId, specKey: 'SPC-TK-B', task: taskKey })).toMatchObject({
      read_as: 'task_baseline',
      version_no: 1,
      baseline: 'R-TK',
      baseline_pinned: true,
    });
    expect(await specs.get({ projectId, specKey: 'SPC-TK-C', task: taskKey })).toMatchObject({
      read_as: 'approved_fallback',
      baseline_pinned: false,
    });
    // 트리 · 검색도 작업의 기준선으로 본다
    const tree = await specs.tree({ projectId, task: taskKey });
    expect(tree.map((n) => n.key).sort()).toEqual(['SPC-TK-A', 'SPC-TK-B']);
    expect(tree.find((n) => n.key === 'SPC-TK-B')?.version_no).toBe(1);
    expect(await search.search({ projectId, query: 'B', task: taskKey })).toMatchObject({
      basis: 'baseline',
      baseline: 'R-TK',
    });
    // 선택자는 하나만
    await expect(
      specs.get({ projectId, specKey: 'SPC-TK-A', task: taskKey, basis: 'latest' }),
    ).rejects.toMatchObject({ details: { field: 'basis', conflict: ['basis', 'task'] } });
  });

  it('기준선과 상태 필터는 함께 받지 않는다 — 트리와 검색 둘 다 (M12)', async () => {
    const one = await draft('SPC-ST-1', '# v1');
    await approve(one.versionId);
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-ST',
      userId: planner,
      specVersionIds: [one.versionId],
    });
    const rejected = { details: { kind: 'invalid_input', field: 'status' } };
    await expect(
      specs.tree({ projectId, baseline: 'R-ST', statuses: ['approved'] }),
    ).rejects.toMatchObject(rejected);
    await expect(
      search.search({ projectId, query: 'v1', baseline: 'R-ST', statuses: ['approved'] }),
    ).rejects.toMatchObject(rejected);
    // 결과마다 읽은 버전의 번호가 있다
    const found = await search.search({ projectId, query: 'SPC-ST-1' });
    expect(found.items[0]).toMatchObject({ key: 'SPC-ST-1', version_no: 1 });
  });

  it('링크 · 버전 목록 · 담은 기준선 · 비교를 한 번에 받는다 (M10 · M11 · M15)', async () => {
    const target = await draft('SPC-LK-T', '# 대상');
    await approve(target.versionId);
    const one = await withDraft(
      'SPC-LK-1',
      '# v1\n\n[대상](SPC-LK-T)',
      '# v2\n\n[대상](SPC-LK-T) · [없는 문서](SPC-LK-NONE)\n\n새 문단',
    );
    await baselines.create({
      actor: { userId: planner, isAgent: false },
      projectId,
      name: 'R-LK',
      userId: planner,
      specVersionIds: [one.v1, target.versionId],
    });
    const read = await specs.get({
      projectId,
      specKey: 'SPC-LK-1',
      basis: 'latest',
      include: ['links', 'versions', 'baselines'],
      diffFrom: { basis: 'approved' },
    });
    // 키 순서다(extractLinkedKeys 가 정렬해 준다)
    expect(read['links']).toEqual([
      { key: 'SPC-LK-NONE', missing: true },
      { key: 'SPC-LK-T', title: 'SPC-LK-T', version_no: 1, doc_status: 'approved' },
    ]);
    expect((read['versions'] as { version_no: number }[]).map((v) => v.version_no)).toEqual([2, 1]);
    expect(read['baselines']).toEqual([{ name: 'R-LK', version_no: 1, status: 'approved' }]);
    expect(read['diff']).toMatchObject({ from: { version_no: 1 }, to: { version_no: 2 } });

    // 기준선으로 읽으면 링크도 그 세트의 버전이고, 세트에 있는지 함께 온다
    const pinned = await specs.get({
      projectId,
      specKey: 'SPC-LK-1',
      baseline: 'R-LK',
      include: ['links'],
    });
    expect(pinned['links']).toEqual([
      {
        key: 'SPC-LK-T',
        title: 'SPC-LK-T',
        version_no: 1,
        doc_status: 'approved',
        in_baseline: true,
      },
    ]);
    await expect(
      specs.get({ projectId, specKey: 'SPC-LK-1', diffFrom: { basis: 'approved', version: 1 } }),
    ).rejects.toMatchObject({ details: { field: 'diff_from' } });
  });

  it('관계는 대상의 최신 버전 지문으로도 선언된다 (M13)', async () => {
    const target = await withDraft('SPC-RL-T', '# 대상 v1', '# 대상 v2');
    await draft('SPC-RL-S', '# 쪽');
    const latestHash = String(
      (await specs.get({ projectId, specKey: 'SPC-RL-T', basis: 'latest' }))['content_hash'],
    );
    const declared = await relations.declare({
      projectId,
      fromKey: 'SPC-RL-S',
      toKey: 'SPC-RL-T',
      kind: 'refines',
      remove: false,
      baseHash: latestHash,
    });
    expect(declared).toBeDefined();
    void target;
    await expect(
      relations.declare({
        projectId,
        fromKey: 'SPC-RL-S',
        toKey: 'SPC-RL-T',
        kind: 'depends_on',
        remove: false,
        baseHash: 'deadbeef',
      }),
    ).rejects.toMatchObject({ details: { kind: 'stale_relation_target' } });
  });
});
