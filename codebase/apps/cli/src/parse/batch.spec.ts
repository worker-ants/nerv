// 배치 분할 — 계약의 `max(200)` 은 두 패스에 똑같이 걸린다.
//
// spec 패스는 나눠 보내는데 **plan 패스만 이 처리가 빠져 있었다**. clemvion 481건이 한
// 요청으로 나갔고 서버가 스키마 위반으로 거절했다(실측 2026-08-23). dry-run 은 서버를
// 부르지 않아 끝까지 통과하므로, 이 벽은 `--apply` 에서만 드러난다.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayKeySuffix } from '@nerv/schema/keys';
import {
  runImport,
  withoutDuplicateKeysForTesting,
  withoutDuplicateTaskKeysForTesting,
} from '../run.js';

const PLAN_COUNT = 481; // clemvion 실측 규모

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'nerv-batch-'));
  mkdirSync(join(root, 'plan', 'complete'), { recursive: true });
  for (let i = 0; i < PLAN_COUNT; i += 1) {
    writeFileSync(
      join(root, 'plan', 'complete', `t${String(i).padStart(4, '0')}.md`),
      `---\nworktree: wt-${i}\nstarted: 2026-05-11\nowner: developer\n---\n\n# 작업 ${i}\n\n본문\n`,
    );
  }
  return root;
}

const profile = {
  profile: 'batch-test',
  version: 1,
  scan: { spec: [], plan: ['plan/{in-progress,complete,research}/**/*.md'], exclude: [] },
  tree: { area_from_directory: false, leaf_type: 'feature', overrides: {} },
  frontmatter: { id: 'spec.key', status_map: {} },
  requirement: { id_pattern: '[A-Z]+-\\d+' },
  task: { status_map: {}, unstarted_sentinel: '(unstarted)' },
};

let root: string;
let profilePath: string;
let sent: number[];

beforeEach(() => {
  root = fixture();
  profilePath = join(root, 'profile.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  sent = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { items?: unknown[] };
    sent.push(body.items?.length ?? 0);
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: (body.items ?? []).map(() => ({ status: 'ok' })) }),
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plan 패스 — 계약의 항목 상한을 넘지 않는다', () => {
  it('481건을 batch-size 단위로 나눠 보낸다', async () => {
    await runImport({
      command: 'plan',
      root,
      project: 'p',
      apply: true,
      batchSize: 50,
      reportDir: join(root, 'report'),
      mapPath: join(root, 'map.json'),
      profileFile: profilePath,
      server: 'http://stub',
      token: 'nerv_x',
    });
    expect(sent.length).toBeGreaterThan(1); // 한 방에 보내지 않는다
    expect(Math.max(...sent)).toBeLessThanOrEqual(200); // 계약의 벽
    expect(sent.reduce((a, b) => a + b, 0)).toBe(PLAN_COUNT); // 하나도 잃지 않는다
  });

  it('batch-size 를 200 보다 크게 줘도 계약을 넘기지 않는다', async () => {
    // 사람이 큰 값을 줄 수 있다. 그때 조용히 거절당하는 대신 상한이 지켜져야 한다.
    await runImport({
      command: 'plan',
      root,
      project: 'p',
      apply: true,
      batchSize: 500,
      reportDir: join(root, 'report2'),
      mapPath: join(root, 'map2.json'),
      profileFile: profilePath,
      server: 'http://stub',
      token: 'nerv_x',
    });
    expect(Math.max(...sent)).toBeLessThanOrEqual(200);
  });
});

describe('task 표시 ID — 충돌하면 조용히 덮어쓰지 않는다', () => {
  it('폭이 넉넉해 481건에서 충돌이 없다 — base32 6자(32^6)', async () => {
    // 16진 4자(65,536)일 때 481건의 충돌 기댓값은 1.76 이었고 실제로 1건을 잃었다.
    const keys = new Set<string>();
    for (let i = 0; i < PLAN_COUNT; i += 1) {
      keys.add(displayKeySuffix(`plan/complete/t${String(i).padStart(4, '0')}.md`));
    }
    expect(keys.size).toBe(PLAN_COUNT);
  });

  it('실측 충돌 쌍이 이제 갈린다', async () => {
    // 4자일 때 두 파일이 함께 `TSK-25b4` 를 받아 하나가 사라졌다(clemvion 실측 2026-08-23).
    const a = displayKeySuffix('plan/complete/swagger-double-wrap-fix.md');
    const b = displayKeySuffix('plan/in-progress/spec-draft-eia-notification-payload-contract.md');
    expect(a).not.toBe(b);
  });

  it('같은 키를 받는 두 파일은 적재에서 빠지고 리포트에 남는다', async () => {
    // 같은 경로 두 번 = 같은 키. 겹친 채로 보내면 서버는 정상 upsert 로 받는다.
    const entries: { disposition: string }[] = [];
    const dupe = {
      source_path: 'plan/complete/x.md',
      title: 'x',
      body_md: '',
      status: 'done' as const,
      assignee_user_id: null,
      depends_on: [],
    };
    const kept = withoutDuplicateTaskKeysForTesting(
      [dupe, { ...dupe }, { ...dupe, source_path: 'plan/complete/y.md' }],
      entries as never,
    );
    expect(kept.map((k) => k.source_path)).toEqual(['plan/complete/y.md']);
    expect(entries.filter((e) => e.disposition === 'aborted')).toHaveLength(2);
  });

  // 스펙 쪽 판(判)에는 테스트가 없었다 — 그런데 2026-08-30 부터 스펙 키는 **DB 가 강제하는
  // 유일 키**다(api.md §1.4i). 이 걸러내기가 빠지면 서버가 배치를 통째로 되돌린다.
  it('같은 spec.key 를 주장하는 두 파일은 적재에서 빠지고 리포트에 남는다', async () => {
    const entries: { disposition: string }[] = [];
    const dupe = {
      source_path: 'spec/a.md',
      key: 'SPC-DUP',
      parent_key: null,
      type: 'feature' as const,
      title: 'a',
      body_md: '# a',
      doc_status: 'approved' as const,
      requirements: [],
      sort_key: '',
    };
    const kept = withoutDuplicateKeysForTesting(
      [dupe, { ...dupe, source_path: 'spec/b.md' }, { ...dupe, key: 'SPC-ONLY' }] as never,
      entries as never,
    );
    expect(kept.map((k) => k.key)).toEqual(['SPC-ONLY']);
    // 둘 다 이름이 남는다 — 조용히 사라지는 것이 이 함수가 막는 것이다
    expect(entries.filter((e) => e.disposition === 'aborted')).toHaveLength(2);
  });
});
