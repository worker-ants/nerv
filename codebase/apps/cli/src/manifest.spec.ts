// 임포트 매니페스트 — 정본: docs/04-mvp/importer.md §3.3
//
// **잃어도 되는 캐시**라는 것이 이 물건의 설계다. 그런데 2026-09-06 까지 그 캐시를 쓰거나
// 만드는 코드가 저장소에 0곳이었고, `--map` 은 파싱만 됐다. 여기서 보는 것은 그 캐시가
// **`map-conflict` 의 축으로 쓸 만한가** 다 — 우리가 넣은 것과 남이 넣은 것을 가르는 일.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runImport } from './run.js';
import {
  emptyManifest,
  knows,
  manifestFromServerMap,
  readManifest,
  writeManifest,
} from './manifest.js';

const dir = (): string => mkdtempSync(join(tmpdir(), 'nerv-manifest-'));

describe('매니페스트 (§3.3)', () => {
  it('없으면 null 이다 — 첫 실행에 파일이 없는 것은 실패가 아니다', () => {
    expect(readManifest(join(dir(), 'nope.json'))).toBeNull();
  });

  it('**깨진 파일은 조용히 넘기지 않는다** — 빈 것으로 떨어지면 map-conflict 가 오발한다', () => {
    const path = join(dir(), 'broken.json');
    writeFileSync(path, '{"profile": 1}', 'utf8');
    expect(() => readManifest(path)).toThrow(/매니페스트 형식/);
  });

  it('쓰고 다시 읽으면 같은 것이다', () => {
    const path = join(dir(), 'map.json');
    const m = emptyManifest('clemvion', 'clv');
    m.items.push({ source_path: 'spec/a.md', kind: 'spec', natural_key: 'SPC-A', spec_id: 'u1' });
    writeManifest(path, m);
    const back = readManifest(path);
    expect(back?.profile).toBe('clemvion');
    expect(back?.items[0]?.natural_key).toBe('SPC-A');
    // 쓴 시각은 **쓸 때** 정해진다 — 만든 시각을 그대로 물려주면 언제 것인지 답이 틀린다
    expect(back?.written_at).not.toBe('');
  });

  it('사람이 읽는 JSON 이다 — 매니페스트는 사람이 들여다보는 물건이기도 하다', () => {
    const path = join(dir(), 'pretty.json');
    writeManifest(path, emptyManifest('clemvion', 'clv'));
    expect(readFileSync(path, 'utf8')).toContain('\n  "profile"');
  });

  it('`knows` 가 map-conflict 의 축이다 — 매니페스트가 없으면 아무것도 모른다', () => {
    const m = emptyManifest('clemvion', 'clv');
    m.items.push({ source_path: 'spec/a.md', kind: 'spec', natural_key: 'SPC-A' });
    expect(knows(m, 'SPC-A')).toBe(true);
    expect(knows(m, 'SPC-B')).toBe(false);
    // 캐시가 없으면 **우리가 넣은 것이 하나도 없다**는 뜻이고, 그것이 정확히 그 게이트의 전제다
    expect(knows(null, 'SPC-A')).toBe(false);
  });

  it('서버 대조표에서 되짓는다 — **서버가 아는 것만** 적는다(REQ-IMP-05)', () => {
    const m = manifestFromServerMap('clemvion', 'clv', [
      { kind: 'spec', natural_key: 'SPC-A', id: 'u1', content_hash: 'ab' },
      { kind: 'task', natural_key: 'CLV-T-1', id: 'u2' },
    ]);
    expect(m.items).toHaveLength(2);
    expect(m.items[0]).toMatchObject({ kind: 'spec', spec_id: 'u1', content_hash: 'ab' });
    expect(m.items[1]).toMatchObject({ kind: 'plan', task_id: 'u2' });
    // `source_path` 는 서버에 없다 — 지어내면 "서버가 진실" 이라는 자기 정의를 어긴다
    expect(m.items[0]?.source_path).toBe('');
  });

  it('자연 키가 없는 행은 버린다 — 키 없는 항목은 무엇도 가리키지 못한다', () => {
    expect(manifestFromServerMap('p', 'x', [{ kind: 'spec', id: 'u1' }]).items).toEqual([]);
  });
});

/**
 * **원문 해시는 둘이다**(2026-09-07 · REQ-IMP-030).
 *
 * 목표 2("원문 해시를 매니페스트에")가 본문에 대해서만 참이었다 — `updated:` 하나 고친
 * 재실행이 무변경으로 읽히고, 매니페스트가 적어 둔 보존 값은 옛것으로 남는다.
 */
describe('매니페스트가 frontmatter 를 기억한다 (REQ-IMP-030)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nerv-manifest-'));
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'a.md'),
      '---\nid: SPC-A\nstatus: approved\nupdated: 2026-09-07\nowner_hint: 지민\n---\n\n# A\n\n본문\n',
    );
  });

  it('본문 해시와 frontmatter 해시를 따로 적고, 보존 키와 버린 키를 가른다', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('preflight')
          ? { items: [] }
          : { items: [{ source_path: 'docs/a.md', status: 'ok', spec_id: 's-1' }] },
    }));
    const mapPath = join(root, 'map.json');
    await runImport({
      command: 'spec',
      root,
      project: 'p',
      apply: true,
      batchSize: 50,
      reportDir: join(root, 'report'),
      mapPath,
      profile: 'nerv-docs',
      server: 'http://stub',
      token: 'nerv_x',
    });
    vi.unstubAllGlobals();

    const manifest = JSON.parse(readFileSync(mapPath, 'utf8')) as {
      items: Record<string, unknown>[];
    };
    const item = manifest.items.find((i) => i['source_path'] === 'docs/a.md');
    expect(item?.['content_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(item?.['frontmatter_hash']).toMatch(/^[0-9a-f]{64}$/);
    // 둘은 다른 값이다 — 같으면 한쪽이 다른 쪽을 베낀 것이다
    expect(item?.['frontmatter_hash']).not.toBe(item?.['content_hash']);
    // 되돌릴 때 필요한 값은 남기고
    expect(item?.['frontmatter']).toEqual({ updated: '2026-09-07' });
    // 옮기지도 남기지도 않은 키는 **무엇이었는지** 적어 둔다
    expect(item?.['unmapped_keys']).toEqual(['owner_hint']);
  });
});
