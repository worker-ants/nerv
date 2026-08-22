// 임포트 실행 — 스캔 → 파싱 → 판정 → (선택) 적재 → 리포트.
//
// 실행 패스는 셋이다(importer.md §3.5). 순서가 규약이다:
//   ① structure  트리 골격 — 부모가 있어야 자식이 붙는다
//   ② document   본문·요구사항 — 파일 1건 = 트랜잭션 1건
//   ③ links      관계 해소 — 모든 노드가 존재한 뒤에야 참조가 풀린다
//
// dry-run 은 ①~③ 을 전부 계산하되 서버를 부르지 않는다. `--server` 가 있으면 preflight 까지
// 수행해 자연 키 충돌을 미리 본다(REQ-IMP-011).

import { basename, dirname } from 'node:path';
import type { ImportProfile, ImportSpecItem } from '@nerv/schema';
import { ImportClient } from './client/index.js';
import { parseFrontmatter, splitStatus } from './parse/frontmatter.js';
import { extractRequirements } from './parse/requirements.js';
import { scan } from './parse/scan.js';
import type { ScannedFile } from './parse/scan.js';
import { loadBuiltin, loadProfileFile } from './profiles/index.js';
import type { ImportReport, ReportEntry } from './report/index.js';
import type { CliOptions } from './index.js';

export async function runImport(options: CliOptions): Promise<ImportReport> {
  const profile =
    options.profileFile !== undefined
      ? loadProfileFile(options.profileFile)
      : loadBuiltin(options.profile ?? 'clemvion');

  const files = scan(options.root, profile.scan.spec, profile.scan.exclude);
  const entries: ReportEntry[] = [];
  const items: ImportSpecItem[] = [];
  const statusCounts: Record<string, number> = {};

  for (const file of files) {
    const converted = convert(file, profile, entries, statusCounts);
    if (converted !== null) items.push(converted);
  }

  const expectation = checkExpectations(profile, files.length, statusCounts, entries);
  const report: ImportReport = {
    profile: profile.profile,
    root: options.root,
    rootCommit: null,
    scanned: files.length,
    converted: items.length,
    entries,
    expectation,
  };

  // dry-run 은 여기서 끝난다 — 서버 없이 완주한다(REQ-IMP-011)
  if (options.server !== undefined && options.token !== undefined) {
    const client = new ImportClient({
      server: options.server,
      token: options.token,
      project: options.project,
    });

    // preflight — 서버 쓰기 0. 자연 키 충돌을 미리 본다
    await client.preflight({
      profile: profile.profile,
      kind: 'spec',
      items: files.map((f) => ({
        source_path: f.path,
        natural_key: naturalKey(f),
        content_hash: f.contentHash,
      })),
    });

    if (options.apply) {
      // ① 트리 골격 → ② 본문 순서. 부모가 먼저 있어야 자식이 붙는다
      await client.specs({ profile: profile.profile, kind: 'structure', items });
      const applied = await client.specs({ profile: profile.profile, kind: 'document', items });
      for (const item of applied.items) {
        if (item.status === 'error') {
          entries.push({
            file: item.source_path,
            line: null,
            reason: item.detail ?? '적재 실패',
            disposition: 'manual',
          });
        }
      }
    }
  }

  return report;
}

/** 한 파일을 스펙 항목으로. 실패는 조용히 버리지 않고 리포트에 올린다(§4.1). */
function convert(
  file: ScannedFile,
  profile: ImportProfile,
  entries: ReportEntry[],
  statusCounts: Record<string, number>,
): ImportSpecItem | null {
  const { frontmatter, body } = parseFrontmatter(file.content);
  const rawId = frontmatter['id'];
  const key = typeof rawId === 'string' && rawId !== '' ? rawId : basename(file.path, '.md');

  const rawStatus = typeof frontmatter['status'] === 'string' ? frontmatter['status'] : undefined;
  if (rawStatus !== undefined) statusCounts[rawStatus] = (statusCounts[rawStatus] ?? 0) + 1;

  const status = splitStatus(rawStatus, profile.frontmatter.status_map);
  if (rawStatus !== undefined && status === null) {
    // 매핑에 없는 값을 기본값으로 넘기지 않는다 — 그러면 117/17/1 집계가 조용히 틀어진다
    entries.push({
      file: file.path,
      line: null,
      reason: `status_map 에 없는 값: ${rawStatus}`,
      disposition: 'manual',
    });
    return null;
  }

  const title = extractTitle(body) ?? key;
  const parentKey = parentOf(file.path);
  const type = resolveType(file.path, profile);

  return {
    source_path: file.path,
    key,
    parent_key: parentKey,
    type: type as ImportSpecItem['type'],
    title,
    // 원문 보존이 제1규칙이다(§2.4)
    body_md: body,
    doc_status: (status?.doc ?? 'draft') as ImportSpecItem['doc_status'],
    requirements: extractRequirements(body, profile.requirement.id_pattern).map((r) => ({
      ref: r.ref,
      text: r.text,
      priority: 'must' as const,
      impl_status: (status?.impl ?? 'unimplemented') as 'unimplemented',
    })),
    evidence: [],
  };
}

function extractTitle(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim() ?? null;
}

/** 디렉터리 계층 → 스펙 트리(§2.2). 최상위 파일은 부모가 없다. */
function parentOf(path: string): string | null {
  const dir = dirname(path);
  if (dir === '.' || dir === '') return null;
  return dir.split('/').at(-1) ?? null;
}

function resolveType(path: string, profile: ImportProfile): string {
  for (const [pattern, type] of Object.entries(profile.tree.overrides)) {
    if (new RegExp(`^${pattern.replaceAll('**', '.*').replaceAll('*', '[^/]*')}$`).test(path)) {
      return type;
    }
  }
  return profile.tree.leaf_type;
}

function naturalKey(file: ScannedFile): string {
  const { frontmatter } = parseFrontmatter(file.content);
  const id = frontmatter['id'];
  // 멱등 키의 축은 (파일 경로 + frontmatter id) 다(§3.3)
  return typeof id === 'string' && id !== '' ? id : file.path;
}

/**
 * 기대 집계 대조 — **선언한 경우에만**(REQ-IMP-016).
 * spec_total 불일치는 abort 다: 스캔 대상이 달라졌다는 뜻이고, 그대로 적재하면
 * "측정 방법이 흔들리는 수치"(P4)를 서버에 그대로 옮기게 된다.
 */
function checkExpectations(
  profile: ImportProfile,
  scanned: number,
  statusCounts: Record<string, number>,
  entries: ReportEntry[],
): ImportReport['expectation'] {
  const results: ImportReport['expectation'] = [];
  const expect = profile.expect;
  if (expect === undefined) return results;

  if (expect.spec_total !== undefined) {
    const ok = expect.spec_total === scanned;
    results.push({ field: 'spec_total', expected: expect.spec_total, actual: scanned, ok });
    if (!ok) {
      entries.push({
        file: '(집계)',
        line: null,
        reason: `spec_total 불일치 — 기대 ${expect.spec_total} · 실제 ${scanned}`,
        disposition: 'aborted',
      });
    }
  }

  for (const [status, expected] of Object.entries(expect.status_distribution ?? {})) {
    const actual = statusCounts[status] ?? 0;
    const ok = expected === actual;
    results.push({ field: `status:${status}`, expected, actual, ok });
    if (!ok) {
      // 분포 불일치는 warn 이다 — 중단시키지 않는다
      entries.push({
        file: '(집계)',
        line: null,
        reason: `status 분포 불일치 — ${status} 기대 ${expected} · 실제 ${actual}`,
        disposition: 'skipped',
      });
    }
  }
  return results;
}
