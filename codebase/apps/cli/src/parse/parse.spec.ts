// 파싱 규칙 — 정본: docs/04-mvp/importer.md §2
//
// 임포터의 값은 "≥95% 자동 변환 + 실패 전건 목록화"(성공 기준 0-6)에 있다. 그 둘 다
// 파싱의 정확성에 달려 있고, 특히 **실패를 조용히 삼키지 않는 것**이 핵심이다.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runImport } from '../run.js';
import { parseFrontmatter, splitStatus } from './frontmatter.js';
import { extractRequirements } from './requirements.js';
import { globToRegExp, matchesAny, RepoIndex } from './scan.js';

describe('frontmatter (§2.3)', () => {
  it('본문은 원문 그대로 남긴다 — 원문 보존이 제1규칙이다(§2.4)', () => {
    const raw = '---\nid: SPC-CWC-007\nstatus: implemented\n---\n# 제목\n\n본문 그대로\n';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter['id']).toBe('SPC-CWC-007');
    expect(body).toBe('# 제목\n\n본문 그대로\n');
  });

  it('목록 값을 배열로 읽는다', () => {
    const raw = '---\npending_plans:\n  - plan/a.md\n  - plan/b.md\n---\n본문';
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['pending_plans']).toEqual(['plan/a.md', 'plan/b.md']);
  });

  it('한 줄 목록도 목록이다 — `code: []` 가 문자열 "[]" 로 읽혀 없는 경로 하나가 됐다', () => {
    const { frontmatter } = parseFrontmatter(
      '---\ncode: []\npending_plans: [plan/a.md, "plan/b.md"]\n---\n본문',
    );
    expect(frontmatter['code']).toEqual([]);
    expect(frontmatter['pending_plans']).toEqual(['plan/a.md', 'plan/b.md']);
  });

  it('frontmatter 가 없으면 전체가 본문이다', () => {
    const { frontmatter, body } = parseFrontmatter('# 제목만');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# 제목만');
  });
});

describe('status 2축 분해 (§2.3)', () => {
  const map = {
    implemented: { doc: 'approved', impl: 'implemented' },
    partial: { doc: 'approved', impl: 'in_progress' },
    backlog: { doc: 'draft', impl: 'unimplemented' },
  };

  it('원본 1축을 문서 축 × 구현 축으로 나눈다', () => {
    expect(splitStatus('implemented', map)).toEqual({ doc: 'approved', impl: 'implemented' });
    expect(splitStatus('partial', map)).toEqual({ doc: 'approved', impl: 'in_progress' });
  });

  it('매핑에 없는 값은 **null 이다** — 기본값으로 조용히 넘기지 않는다', () => {
    // 넘기면 117/17/1 집계가 조용히 틀어지고, 그 순간 임포트의 신뢰가 사라진다
    expect(splitStatus('알-수-없는-값', map)).toBeNull();
  });
});

describe('요구사항 추출 — 표의 행이 정의다 (§2.5)', () => {
  const pattern = '[A-Z]+-[A-Z]+-\\d+';
  const table = (...rows: string[]): string =>
    ['| ID | 설명 | 우선순위 |', '| --- | --- | --- |', ...rows].join('\n');

  it('표의 행에서 ref·설명·우선순위를 떼어낸다', () => {
    const body = table(
      '| **REQ-CWC-031** | WHEN 방문자가 위젯을 처음 열면 THE SYSTEM SHALL 이전 대화를 복원한다 | 필수 |',
    );
    const [requirement] = extractRequirements(body, pattern).requirements;
    expect(requirement?.ref).toBe('REQ-CWC-031');
    expect(requirement?.text).toContain('WHEN 방문자가');
    expect(requirement?.priority).toBe('must');
    expect(requirement?.ordinal).toBe(0);
    expect(requirement?.line).toBe(3);
  });

  it('**산문의 등장은 참조일 뿐이다** — 행을 만들지 않는다(규칙 1)', () => {
    // 이 구분이 없으면 참조가 전부 요구사항으로 승격되고 요구사항 수 자체가 부풀어 오른다
    const body = ['본문에서 REQ-CWC-031 을 지킨다고 적어 두었다.', '', table()].join('\n');
    expect(extractRequirements(body, pattern).requirements).toEqual([]);
  });

  it('**미표기 우선순위는 null 이다** — must 로 지어내지 않는다(규칙 4)', () => {
    const body = table('| REQ-A-1 | 설명 | |');
    expect(extractRequirements(body, pattern).requirements[0]?.priority).toBeNull();
  });

  it('권장은 should 로 옮긴다(데이터 모델 §2.2 매핑)', () => {
    const body = table('| REQ-A-1 | 설명 | 권장 |');
    expect(extractRequirements(body, pattern).requirements[0]?.priority).toBe('should');
  });

  it('수용 기준 열이 따로 있으면 그 셀을 나눠 담는다(규칙 2)', () => {
    const body = [
      '| ID | 설명 | 수용 기준 |',
      '| --- | --- | --- |',
      '| REQ-A-1 | 대화 복원 | WHEN 위젯을 열면 THE SYSTEM SHALL … |',
    ].join('\n');
    const [requirement] = extractRequirements(body, pattern).requirements;
    expect(requirement?.text).toBe('대화 복원');
    expect(requirement?.acceptance).toContain('THE SYSTEM SHALL');
  });

  it('설명 셀이 따로 없는 두 칸 표는 그 한 셀이 설명이다 — 같은 문장을 두 열에 앉히지 않는다', () => {
    const body = [
      '| ID | 수용 기준 (EARS) |',
      '| --- | --- |',
      '| **REQ-IMP-001** | WHEN … THE SYSTEM SHALL … |',
    ].join('\n');
    const [requirement] = extractRequirements(body, pattern).requirements;
    expect(requirement?.text).toContain('THE SYSTEM SHALL');
    expect(requirement?.acceptance).toBeNull();
  });

  it('같은 ref 의 두 번째 행은 적재하지 않고 수동 확인 큐로 올린다(규칙 6)', () => {
    const body = table('| REQ-A-1 | 첫 정의 | 필수 |', '| REQ-A-1 | 둘째 정의 | 권장 |');
    const { requirements, duplicates } = extractRequirements(body, pattern);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.text).toBe('첫 정의');
    expect(duplicates).toEqual([{ ref: 'REQ-A-1', line: 4 }]);
  });

  it('이스케이프한 파이프는 셀을 가르지 않는다 — 갈리면 열 역할이 밀린다', () => {
    const body = table('| REQ-A-1 | `spec\\|plan` 을 받는다 | 필수 |');
    const [requirement] = extractRequirements(body, pattern).requirements;
    expect(requirement?.text).toContain('spec|plan');
    expect(requirement?.priority).toBe('must');
  });

  it('ID 가 없으면 빈 배열 — 없는 것을 지어내지 않는다', () => {
    expect(extractRequirements('요구사항 ID 가 없는 문서', pattern).requirements).toEqual([]);
  });
});

describe('glob 매칭 (§2.1 스캔)', () => {
  it.each([
    ['spec/**/*.md', 'spec/a/b.md', true],
    ['spec/**/*.md', 'spec/a.md', true],
    ['spec/**/*.md', 'plan/a.md', false],
    ['plan/{in-progress,complete}/**/*.md', 'plan/complete/x.md', true],
    ['plan/{in-progress,complete}/**/*.md', 'plan/research/x.md', false],
    ['spec/**/api-catalog/**', 'spec/x/api-catalog/y.md', true],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(globToRegExp(pattern).test(path)).toBe(expected);
  });

  it('제외가 포함을 이긴다 — 재생성 가능한 산출물은 옮기지 않는다(D-07)', () => {
    const include = ['spec/**/*.md'];
    const exclude = ['spec/**/api-catalog/**'];
    const path = 'spec/channel/api-catalog/gen.md';
    expect(matchesAny(path, include)).toBe(true);
    expect(matchesAny(path, exclude)).toBe(true);
  });
});

/**
 * **`code:` glob 은 증적이고, 가리키는 것이 없으면 낡았다**(§2.3 · REQ-IMP-032 · 2026-09-26).
 *
 * 이 키는 "아는 키" 로 표시돼 미매핑 경고도 나지 않으면서 적재되지도 않았다 — clemvion 의
 * glob 691개가 아무 말 없이 사라졌다. 저장소는 한 번만 걷고, glob 문법은 스캔과 같다.
 */
describe('code: glob 의 실존 검사 (§2.3 · REQ-IMP-032)', () => {
  function repo(): string {
    const root = mkdtempSync(join(tmpdir(), 'nerv-code-'));
    for (const path of [
      'codebase/frontend/src/app/(main)/w/[slug]/triggers/page.tsx',
      'codebase/frontend/public/logo-dark.svg',
      'codebase/backend/src/auth/auth.service.ts',
      'node_modules/pkg/index.js',
    ]) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), '');
    }
    return root;
  }

  it('파일·디렉터리·glob 을 찾는다 — Next.js 경로의 대괄호는 글자 그대로다', () => {
    const index = new RepoIndex(repo());
    expect(index.exists('codebase/frontend/src/app/(main)/w/[slug]/triggers/page.tsx')).toBe(true);
    expect(index.exists('codebase/frontend/public/logo*.svg')).toBe(true);
    expect(index.exists('codebase/backend/src/**')).toBe(true);
    expect(index.exists('codebase/backend/src/auth/')).toBe(true);
    expect(index.exists('./codebase/backend/**/*.service.ts')).toBe(true);
  });

  it('아무것도 가리키지 않으면 없다 — node_modules 안은 보지 않는다', () => {
    const index = new RepoIndex(repo());
    expect(index.exists('codebase/frontend/src/app/(main)/w/[slug]/removed/page.tsx')).toBe(false);
    expect(index.exists('codebase/backend/src/**/*.controller.ts')).toBe(false);
    expect(index.exists('node_modules/pkg/*.js')).toBe(false);
  });

  describe('스펙 패스가 싣는다', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('glob 하나가 code_path 증적 하나이고, 미매치는 stale 로 싣고 수동 확인에 올린다', async () => {
      const root = repo();
      mkdirSync(join(root, 'spec'), { recursive: true });
      writeFileSync(
        join(root, 'spec', 'auth.md'),
        [
          '---',
          'id: auth',
          'status: implemented',
          'code:',
          '  - codebase/backend/src/auth/auth.service.ts',
          '  - codebase/backend/src/auth/auth.controller.ts',
          '---',
          '',
          '# 인증',
          '',
        ].join('\n'),
      );
      const profilePath = join(root, 'profile.json');
      writeFileSync(
        profilePath,
        JSON.stringify({
          profile: 'code-test',
          version: 1,
          scan: { spec: ['spec/**/*.md'], plan: [], exclude: [] },
          tree: { area_from_directory: false, leaf_type: 'feature', overrides: {} },
          frontmatter: {
            id: 'spec.key',
            status_map: { implemented: { doc: 'approved', impl: 'implemented' } },
            code: 'evidence.code_path',
            preserve: [],
          },
          requirement: { id_pattern: '[A-Z]+-[A-Z]+-\\d+' },
          task: { status_map: {}, unstarted_sentinel: '(unstarted)' },
        }),
      );
      const batches: { items: { evidence: unknown[] }[] }[] = [];
      vi.stubGlobal('fetch', async (url: string, init: { body?: string }) => {
        const body = JSON.parse(init.body ?? '{}') as { items?: { source_path: string }[] };
        if (url.endsWith('/import/preflight')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: (body.items ?? []).map((i) => ({
                source_path: i.source_path,
                natural_key: 'auth',
                state: 'new',
                spec_id: null,
                version_no: null,
              })),
            }),
          };
        }
        if (url.endsWith('/import/specs')) batches.push(body as never);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: (body.items ?? []).map((i) => ({ source_path: i.source_path, status: 'ok' })),
          }),
        };
      });
      const report = await runImport({
        command: 'spec',
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
      const missing = report.entries.filter((e) => e.rule === 'code-glob-no-match');
      expect(missing).toHaveLength(1);
      expect(missing[0]?.disposition).toBe('manual');
      expect(missing[0]?.reason).toContain('auth.controller.ts');
      // 골격 배치와 본문 배치가 같은 항목을 싣는다 — 본문 배치의 것을 본다
      const document = batches.filter((b) => (b as { kind?: string }).kind === 'document');
      expect(document.flatMap((b) => b.items.flatMap((i) => i.evidence))).toEqual([
        { kind: 'code_path', locator: 'codebase/backend/src/auth/auth.service.ts', stale: false },
        { kind: 'code_path', locator: 'codebase/backend/src/auth/auth.controller.ts', stale: true },
      ]);
    });

    it('user_guide: 도 같은 실존 검사를 받는다 — 경고로만 남고 버려지던 키다 (REQ-IMP-033)', async () => {
      const root = repo();
      mkdirSync(join(root, 'docs'), { recursive: true });
      writeFileSync(join(root, 'docs', 'slack.mdx'), '');
      mkdirSync(join(root, 'spec'), { recursive: true });
      writeFileSync(
        join(root, 'spec', 'slack.md'),
        [
          '---',
          'id: slack',
          'status: implemented',
          'user_guide:',
          '  - docs/slack.mdx',
          '  - docs/slack.en.mdx',
          '---',
          '',
          '# 슬랙',
          '',
        ].join('\n'),
      );
      const profilePath = join(root, 'profile.json');
      writeFileSync(
        profilePath,
        JSON.stringify({
          profile: 'guide-test',
          version: 1,
          scan: { spec: ['spec/**/*.md'], plan: [], exclude: [] },
          tree: { area_from_directory: false, leaf_type: 'feature', overrides: {} },
          frontmatter: {
            id: 'spec.key',
            status_map: { implemented: { doc: 'approved', impl: 'implemented' } },
            user_guide: 'evidence.user_guide',
            preserve: [],
          },
          requirement: { id_pattern: '[A-Z]+-[A-Z]+-\\d+' },
          task: { status_map: {}, unstarted_sentinel: '(unstarted)' },
        }),
      );
      const report = await runImport({
        command: 'spec',
        root,
        project: 'p',
        apply: false,
        batchSize: 50,
        reportDir: join(root, 'report'),
        mapPath: join(root, 'map.json'),
        profileFile: profilePath,
      });
      // 이제 아는 키다 — "적재되지도 보존되지도 않는다" 는 경고가 사라진다
      expect(report.entries.filter((e) => e.rule === 'frontmatter-unmapped')).toEqual([]);
      const missing = report.entries.filter((e) => e.rule === 'user-guide-no-match');
      expect(missing.map((e) => [e.disposition, e.reason.includes('docs/slack.en.mdx')])).toEqual([
        ['manual', true],
      ]);
    });
  });
});
