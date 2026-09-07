// abort 게이트 — **세 패스 모두에서 문을 닫는가** (importer.md §3.1 · REQ-IMP-023)
//
// spec 패스만 게이트를 걸고 있었다. plan·review 는 `aborted` 항목을 리포트에 적은 뒤
// **그대로 전송**했다 — 중단이라 적어 놓고 중단하지 않으면 그 등급은 이름만 남는다.
// 그리고 이 CLI 에서 등급은 종료 코드를 정하므로, 그 어긋남은 게이트로 쓰는 쪽까지 번진다.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runImport } from '../run.js';
import { exitCode, withHints } from '../report/index.js';

const profile = {
  profile: 'gate-test',
  version: 1,
  scan: { spec: [], plan: ['plan/**/*.md'], exclude: [] },
  tree: { area_from_directory: false, leaf_type: 'feature', overrides: {} },
  frontmatter: { id: 'spec.key', status_map: {} },
  requirement: { id_pattern: '[A-Z]+-\\d+' },
  task: { status_map: {}, unstarted_sentinel: '(unstarted)' },
  // 기대 총수를 실물과 다르게 선언한다 — `count-mismatch`(abort)가 서는 자리다
  expect: { plan_total: 99 },
};

let root: string;
let profilePath: string;
let calls: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nerv-gate-'));
  mkdirSync(join(root, 'plan', 'complete'), { recursive: true });
  writeFileSync(
    join(root, 'plan', 'complete', 'a.md'),
    '---\nworktree: wt\nstarted: 2026-05-11\nowner: developer\n---\n\n# 작업\n\n본문\n',
  );
  profilePath = join(root, 'profile.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  calls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('abort 는 전송 전에 문을 닫는다 (REQ-IMP-023)', () => {
  it('plan 패스도 aborted 가 있으면 서버를 부르지 않는다', async () => {
    const report = await runImport({
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

    expect(report.entries.some((e) => e.disposition === 'aborted')).toBe(true);
    // **전송이 없었다** — 이것이 게이트의 전부다. 리포트에 적혔는지가 아니라.
    expect(calls.filter((u) => u.includes('/import/'))).toEqual([]);
    expect(exitCode(report)).toBe(2);
  });

  /**
   * **리포트가 무엇을 읽었는지 말한다**(REQ-IMP-026). `rootCommit` 은 세 리포트에서
   * `null` 로 고정돼 있었는데 렌더러는 그 필드를 그리고 있었다 — 사람은 **커밋 없는
   * 임포트 기록**을 읽었고, 매니페스트도 같은 값을 받아 되짚을 근거가 없었다.
   */
  it('git 저장소면 읽은 커밋을 리포트에 적는다', async () => {
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.email=a@b.c',
      '-c',
      'user.name=t',
      'commit',
      '-qm',
      'x',
    ]);

    const report = await runImport({
      command: 'plan',
      root,
      project: 'p',
      apply: false,
      batchSize: 50,
      reportDir: join(root, 'report3'),
      mapPath: join(root, 'map3.json'),
      profileFile: profilePath,
    });
    expect(report.rootCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('git 저장소가 아니면 null 이다 — 실패가 아니라 사실이다', async () => {
    const report = await runImport({
      command: 'plan',
      root,
      project: 'p',
      apply: false,
      batchSize: 50,
      reportDir: join(root, 'report4'),
      mapPath: join(root, 'map4.json'),
      profileFile: profilePath,
    });
    expect(report.rootCommit).toBeNull();
  });

  it('힌트는 끝에서 한 번 채운다 — 규칙마다 채우면 언젠가 한 곳이 빠진다', async () => {
    const report = withHints(
      await runImport({
        command: 'plan',
        root,
        project: 'p',
        apply: false,
        batchSize: 50,
        reportDir: join(root, 'report2'),
        mapPath: join(root, 'map2.json'),
        profileFile: profilePath,
      }),
    );
    const aborted = report.entries.find((e) => e.disposition === 'aborted');
    expect(aborted?.hint).toBeDefined();
    // 카탈로그 키가 그대로 새어 나오지 않는다 — 사람은 그것을 문구로 읽는다
    expect(aborted?.hint).not.toContain('cli.hint.');
  });
});
