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
  specs = new SpecService(events, new SpecCheckService(drizzleDb), relations, drizzleDb);
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
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM spec_baseline_item');
  await pool.query('DELETE FROM spec_baseline');
  await pool.query('DELETE FROM spec_comment');
  await pool.query('DELETE FROM spec_relation');
  await pool.query('DELETE FROM requirement_version');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM spec_chunk_embedding');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM event');
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
    await specs.updateMeta({ projectId, specKey: 'SPC-KID', parentKey: 'SPC-R', userId: planner });

    await expect(
      specs.updateMeta({ projectId, specKey: 'SPC-R', parentKey: 'SPC-KID', userId: planner }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION, details: { kind: 'tree_cycle' } });
    expect(root.specId).toBeDefined();
  });

  it('살아 있는 하위 노드·활성 클레임이 있으면 아카이브를 막고 사유를 열거한다', async () => {
    await draft('SPC-BOX', '# box');
    await draft('SPC-IN', '# in');
    await specs.updateMeta({ projectId, specKey: 'SPC-IN', parentKey: 'SPC-BOX', userId: planner });

    const error = (await specs
      .archive({ projectId, specKey: 'SPC-BOX', userId: planner })
      .catch((e: unknown) => e)) as { details: Record<string, unknown> };
    expect(error.details['kind']).toBe('archive_blocked');
    expect(error.details['blockers']).toEqual([{ kind: 'child_spec', key: 'SPC-IN' }]);
  });

  it('아카이브는 삭제가 아니다 — 기본 트리에서만 빠진다', async () => {
    await draft('SPC-OLD', '# old');
    await draft('SPC-LIVE', '# live');
    await specs.archive({ projectId, specKey: 'SPC-OLD', userId: planner });

    expect((await specs.tree({ projectId })).map((n) => n.key)).not.toContain('SPC-OLD');
    const withArchived = await specs.tree({ projectId, includeArchived: true });
    expect(withArchived.map((n) => n.key)).toContain('SPC-OLD');

    // 섞여 온 목록에서 **어느 것이 보관된 것인지** 화면이 갈라야 한다(REQ-WEB-105).
    // 이 값이 없으면 보관 보기를 켠 목록은 살아 있는 문서와 보관된 문서를 같은 무게로 그린다.
    expect(withArchived.find((n) => n.key === 'SPC-OLD')?.archived_at).not.toBeNull();
    expect(withArchived.find((n) => n.key === 'SPC-LIVE')?.archived_at).toBeNull();

    await specs.restore({ projectId, specKey: 'SPC-OLD', userId: planner });
    expect((await specs.tree({ projectId })).map((n) => n.key)).toContain('SPC-OLD');
  });

  // 복원에는 있던 규칙이 **생성·이동에는 없었다**: 보관된 부모 아래에 문서를 만들 수 있었고
  // (실측 2026-08-29 — 201), 그 문서는 기본 트리에서 부모를 못 찾아 화면에서 사라졌다.
  // 목록에 없으면 열람도 없다([4.5](screens.md) §2.4b) — 만들 수 없어야 한다.
  it('보관된 부모 아래에는 만들 수 없다 — 어느 목록에도 없는 문서가 된다', async () => {
    await draft('SPC-DEADBOX', '# box');
    await specs.archive({ projectId, specKey: 'SPC-DEADBOX', userId: planner });

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
    await specs.archive({ projectId, specKey: 'SPC-DEADBOX2', userId: planner });

    await expect(
      specs.updateMeta({
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
      projectId,
      specKey: 'SPC-PKID',
      parentKey: 'SPC-PBOX',
      userId: planner,
    });
    await specs.archive({ projectId, specKey: 'SPC-PKID', userId: planner });
    await specs.archive({ projectId, specKey: 'SPC-PBOX', userId: planner });

    await expect(
      specs.restore({ projectId, specKey: 'SPC-PKID', userId: planner }),
    ).rejects.toMatchObject({ details: { kind: 'parent_archived' } });
  });
});

// ── E09-S06 베이스라인 ───────────────────────────────────────────────────────

describe('E09-S06 베이스라인은 영원히 같은 답을 낸다', () => {
  it('approved 가 아닌 항목이 섞이면 전체를 거부한다 — 부분 성공은 기준선이 아니다', async () => {
    const a = await draft('SPC-BA', '# a');
    await approve(a.versionId);
    const b = await draft('SPC-BB', '# b'); // draft 그대로

    await expect(
      baselines.create({
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
    await baselines.create({ projectId, name: 'r1', userId: planner });

    // v2 승인 — v1 은 superseded 가 된다
    const v2 = await specs.draftUpsert({
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

  it('manifest 는 baseline 이름 또는 as_of 중 하나로만 본다', async () => {
    const v = await draft('SPC-MAN', '# m');
    await approve(v.versionId);
    await baselines.create({ projectId, name: 'r1', userId: planner });

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

  it('같은 이름의 베이스라인을 두 번 만들 수 없다 — 이름이 곧 참조 수단이다', async () => {
    const v = await draft('SPC-DUP', '# d');
    await approve(v.versionId);
    await baselines.create({ projectId, name: 'r1', userId: planner });
    await expect(
      baselines.create({ projectId, name: 'r1', userId: planner }),
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

// ── E09-S10 검색 ─────────────────────────────────────────────────────────────

describe('E09-S10 하이브리드 검색', () => {
  it('안정 ID 는 전문 검색을 거치지 않고 직행한다', async () => {
    const s = await draft('SPC-CWC-007', '# 웹챗 위젯 임베드\n\n본문', '웹챗 위젯 임베드');
    await approve(s.versionId);
    const result = await search.search({ projectId, query: 'SPC-CWC-007' });
    expect(result.items[0]?.key).toBe('SPC-CWC-007');
    expect(result.items[0]?.matched_by).toContain('id');
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

  it('인덱싱 대상은 최신 approved + 현재 draft 뿐이다 — 과거 판은 렉시컬로 충분하다', async () => {
    const v1 = await draft('SPC-IX', '# v1');
    await approve(v1.versionId);
    const v2 = await specs.draftUpsert({
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
