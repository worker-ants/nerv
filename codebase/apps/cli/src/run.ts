// 임포트 실행 — 스캔 → 파싱 → 판정 → (선택) 적재 → 리포트.
//
// 실행 패스는 셋이다(importer.md §3.5). 순서가 규약이다:
//   ① structure  트리 골격 — 부모가 있어야 자식이 붙는다
//   ② document   본문·요구사항 — 파일 1건 = 트랜잭션 1건
//   ③ links      관계 해소 — 모든 노드가 존재한 뒤에야 참조가 풀린다
//
// dry-run 은 ①~③ 을 전부 계산하되 서버를 부르지 않는다. `--server` 가 있으면 preflight 까지
// 수행해 자연 키 충돌을 미리 본다(REQ-IMP-011).

import { t } from './i18n.js';
import { basename, dirname } from 'node:path';
import type {
  ImportBatchResult,
  ImportProfile,
  ImportSpecItem,
  ImportTaskItem,
} from '@nerv/schema';
import { ImportClient } from './client/index.js';
import { classifyPlan } from './parse/plan.js';
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

  // plan 패스는 스펙과 다른 트리를 읽고 다른 표면에 쓴다(EP-IMP-03) — 여기서 갈린다.
  if (options.command === 'plan') return runPlanImport(options, profile);

  const files = scan(options.root, profile.scan.spec, profile.scan.exclude);
  const entries: ReportEntry[] = [];
  const items: ImportSpecItem[] = [];
  const statusCounts: Record<string, number> = {};

  for (const file of files) {
    const converted = convert(file, profile, entries, statusCounts);
    if (converted !== null) items.push(converted);
  }

  const sourcePaths = new Set(files.map((f) => f.path));
  const withTree = buildAreaTree(items, profile, entries);
  const loadable = withoutDuplicateKeys(withTree, entries);

  const expectation = checkExpectations(profile, files.length, statusCounts, entries);
  const report: ImportReport = {
    profile: profile.profile,
    root: options.root,
    rootCommit: null,
    scanned: files.length,
    // 합성된 area 노드는 원본 파일이 아니다 — 변환율의 분자에 넣으면 100% 를 넘는다
    converted: loadable.filter((item) => sourcePaths.has(item.source_path)).length,
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
      //
      // **나눠 보낸다**(importer.md §3.1 `--batch-size`). 한 번에 보내면 본문이 몸집을
      // 키워 서버가 413 으로 끊는다 — clemvion 136건이 그랬다(실측 2026-08-23).
      for (const chunk of chunked(orderByParent(loadable), options.batchSize)) {
        await client.specs({ profile: profile.profile, kind: 'structure', items: chunk });
      }
      const applied: ImportBatchResult['items'] = [];
      for (const chunk of chunked(loadable, options.batchSize)) {
        // 문서는 **파일 1건 = 트랜잭션 1건**이라(§3.5) 순서가 결과를 바꾸지 않는다
        applied.push(
          ...(await client.specs({ profile: profile.profile, kind: 'document', items: chunk }))
            .items,
        );
      }
      for (const item of applied) {
        if (item.status === 'error') {
          entries.push({
            file: item.source_path,
            line: null,
            reason: item.detail ?? t()('cli.reason.load_failed'),
            disposition: 'manual',
          });
        }
      }
    }
  }

  return report;
}

/**
 * plan 임포트 — E11-S01·S02.
 *
 * 스펙 패스와 결정적으로 다른 점: **`ready` 가 없다.** 상태 매핑이 backlog·in_progress·done
 * 셋뿐이고, research/ 는 Task 를 만들지 않는다. 그 결과 임포트 직후의 ready 큐는 비어 있고,
 * 에이전트는 사람이 위임 명세를 채운 작업만 집어간다 — 그것이 FR-05 의 실물이다.
 */
async function runPlanImport(options: CliOptions, profile: ImportProfile): Promise<ImportReport> {
  const patterns = profile.scan.plan ?? [];
  const files = patterns.length === 0 ? [] : scan(options.root, patterns, profile.scan.exclude);
  const entries: ReportEntry[] = [];
  const items: ImportTaskItem[] = [];
  const statusCounts: Record<string, number> = {};
  const importedAt = new Date().toISOString();

  for (const file of files) {
    const { frontmatter, body } = parseFrontmatter(file.content);
    const classified = classifyPlan(
      { path: file.path, frontmatter, body },
      {
        unstartedSentinel: profile.task?.unstarted_sentinel ?? '(unstarted)',
        importedAt,
        ...(options.ownerMap === undefined ? {} : { ownerMap: options.ownerMap }),
      },
    );

    if (classified.kind === 'reference' || classified.task === null) {
      entries.push({
        file: file.path,
        line: null,
        reason: classified.note ?? t()('cli.reason.reference_doc'),
        disposition: 'skipped',
      });
      statusCounts['reference'] = (statusCounts['reference'] ?? 0) + 1;
      continue;
    }

    const task = classified.task;
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    for (const warning of task.warnings) {
      entries.push({ file: file.path, line: null, reason: warning, disposition: 'manual' });
    }
    if (task.assignee_user_id === null && task.owner_label !== null) {
      statusCounts['unassigned'] = (statusCounts['unassigned'] ?? 0) + 1;
    }

    items.push({
      source_path: task.source_path,
      title: task.title,
      body_md: task.body_md,
      status: task.status,
      assignee_user_id: task.assignee_user_id,
      depends_on: [],
    });
  }

  const report: ImportReport = {
    profile: profile.profile,
    root: options.root,
    rootCommit: null,
    scanned: files.length,
    converted: items.length,
    entries,
    expectation: checkPlanExpectations(profile, files.length, statusCounts, entries),
  };

  if (options.server !== undefined && options.token !== undefined && options.apply) {
    const client = new ImportClient({
      server: options.server,
      token: options.token,
      project: options.project,
    });
    const applied = await client.tasks({ profile: profile.profile, items });
    for (const item of applied.items) {
      if (item.status === 'error') {
        entries.push({
          file: item.source_path,
          line: null,
          reason: item.detail ?? t()('cli.reason.load_failed'),
          disposition: 'manual',
        });
      }
    }
  }

  return report;
}

/** plan 기대 집계 — 선언된 경우에만 대조한다(REQ-IMP-016). */
function checkPlanExpectations(
  profile: ImportProfile,
  scanned: number,
  statusCounts: Record<string, number>,
  entries: ReportEntry[],
): ImportReport['expectation'] {
  const results: ImportReport['expectation'] = [];
  const expect = profile.expect;
  if (expect?.plan_total !== undefined) {
    const ok = expect.plan_total === scanned;
    results.push({ field: 'plan_total', expected: expect.plan_total, actual: scanned, ok });
    if (!ok) {
      entries.push({
        file: t()('cli.report.aggregate'),
        line: null,
        reason: t()('cli.reason.plan_total', { expected: expect.plan_total, actual: scanned }),
        disposition: 'aborted',
      });
    }
  }
  for (const [status, expected] of Object.entries(expect?.plan_status_distribution ?? {})) {
    const actual = statusCounts[status] ?? 0;
    results.push({ field: `plan:${status}`, expected, actual, ok: expected === actual });
  }
  return results;
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
  // **폴백은 경로다.** 파일명만 쓰면 디렉터리가 다른 동명 파일이 같은 키를 갖고, upsert 가
  // 서로를 덮어쓴다 — clemvion 은 `_product-overview.md` 7건 · `0-common.md` 7건이라
  // 136건이 127노드로 줄고 9건이 조용히 사라졌다(실측 2026-08-23). 경로는 유일하다.
  const key =
    typeof rawId === 'string' && rawId !== ''
      ? rawId
      : keyFromPath(relativeToScanRoot(file.path, profile));

  const rawStatus = typeof frontmatter['status'] === 'string' ? frontmatter['status'] : undefined;
  if (rawStatus !== undefined) statusCounts[rawStatus] = (statusCounts[rawStatus] ?? 0) + 1;

  const status = splitStatus(rawStatus, profile.frontmatter.status_map);
  if (rawStatus !== undefined && status === null) {
    // 매핑에 없는 값을 기본값으로 넘기지 않는다 — 그러면 117/17/1 집계가 조용히 틀어진다
    entries.push({
      file: file.path,
      line: null,
      reason: t()('cli.reason.unknown_status', { value: rawStatus }),
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

/**
 * 타입 판정 — `tree.overrides` 는 **스캔 뿌리 기준 상대 경로**로 쓴다(importer.md §2.2).
 *
 * 저장소 기준 절대 경로로 대조하면 `conventions/**` 가 `spec/conventions/x.md` 를 놓친다 —
 * clemvion 의 convention 22편이 전부 feature 로 들어가 있었다(실측 2026-08-23).
 */
function resolveType(path: string, profile: ImportProfile): string {
  const rel = relativeToScanRoot(path, profile);
  for (const [pattern, type] of Object.entries(profile.tree.overrides)) {
    if (new RegExp(`^${pattern.replaceAll('**', '.*').replaceAll('*', '[^/]*')}$`).test(rel)) {
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
        file: t()('cli.report.aggregate'),
        line: null,
        reason: t()('cli.reason.spec_total', { expected: expect.spec_total, actual: scanned }),
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
        file: t()('cli.report.aggregate'),
        line: null,
        reason: t()('cli.reason.status_dist', { status, expected, actual }),
        disposition: 'skipped',
      });
    }
  }
  return results;
}

/** n 개씩 끊는다 — 배치는 전송 단위일 뿐이다(api.md §2.10) */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 부모 먼저 오도록 위상 정렬한다.
 *
 * 구조 패스는 `parent_key` 를 id 로 해소하므로 부모가 **먼저 적재돼 있어야** 한다.
 * 한 배치로 보낼 때는 배열 순서가 그것을 보장했지만, 나눠 보내면 경계가 부모와 자식을
 * 가를 수 있다 — 그때 자식은 부모 없이 트리에 붙는다(조용한 손상이다).
 *
 * 부모를 못 찾는 항목(원본이 순환이거나 참조가 깨진 경우)은 **버리지 않고 뒤에 붙인다** —
 * 여기서 지우면 리포트의 전수 계정(REQ-IMP-016)이 맞지 않게 된다. 판정은 서버가 한다.
 */
function orderByParent(items: readonly ImportSpecItem[]): ImportSpecItem[] {
  const remaining = new Map(items.map((item) => [item.key, item]));
  const placed = new Set<string>();
  const ordered: ImportSpecItem[] = [];

  let progressed = true;
  while (progressed && remaining.size > 0) {
    progressed = false;
    for (const [key, item] of [...remaining]) {
      const parent = item.parent_key;
      if (parent == null || placed.has(parent) || !remaining.has(parent)) {
        ordered.push(item);
        placed.add(key);
        remaining.delete(key);
        progressed = true;
      }
    }
  }
  return [...ordered, ...remaining.values()];
}

/**
 * frontmatter `id` 가 없을 때의 키 — **경로에서 만든다**.
 *
 * 스캔 경로는 저장소 안에서 유일하므로 키도 유일하다. 파일명만 쓰면 디렉터리가 다른
 * 동명 파일이 한 키를 두고 다투고, 그 다툼은 upsert 가 조용히 덮어쓰는 것으로 끝난다.
 */
function keyFromPath(path: string): string {
  return path
    .replace(/\.md$/, '')
    .split('/')
    .filter((segment) => segment !== '')
    .join('-');
}

/**
 * 같은 키를 가진 파일이 둘 이상이면 **적재에서 빼고 리포트에 올린다**.
 *
 * 키가 겹치면 나중 것이 앞선 것을 덮어쓴다 — 그런데 그 덮어쓰기는 서버에서 정상 upsert 라
 * 오류가 나지 않는다. 아무도 말해 주지 않으면 "136건 전량 변환·실패 0" 이라는 리포트와
 * 함께 문서가 사라진다(실측). 전수 계정(REQ-IMP-016)이 지켜야 하는 것이 바로 이것이다.
 */
function withoutDuplicateKeys(
  items: readonly ImportSpecItem[],
  entries: ReportEntry[],
): ImportSpecItem[] {
  const byKey = new Map<string, string[]>();
  for (const item of items) {
    byKey.set(item.key, [...(byKey.get(item.key) ?? []), item.source_path]);
  }
  const conflicted = new Set<string>();
  for (const [key, paths] of byKey) {
    if (paths.length < 2) continue;
    conflicted.add(key);
    for (const path of paths) {
      entries.push({
        file: path,
        line: null,
        reason: t()('cli.reason.duplicate_key', { key, count: paths.length }),
        disposition: 'aborted',
      });
    }
  }
  // **적재에서 뺀다.** 그대로 보내면 서버는 정상 upsert 로 받아들이고 나중 것이 앞선 것을
  // 덮어쓴다 — 문서가 사라지는데 오류는 나지 않는다. 빼면 사라지되 리포트에 이름이 남는다.
  return items.filter((item) => !conflicted.has(item.key));
}

/**
 * 스캔 글롭의 리터럴 접두 — 트리의 뿌리다. `spec/**` + `/*.md` → `spec`.
 *
 * 뿌리 자체는 노드가 되지 않는다. 그 바로 아래 디렉터리부터 area 다(§2.2 표의 "영역 디렉터리").
 */
function scanRoot(profile: ImportProfile): string {
  const first = profile.scan.spec[0] ?? '';
  const segments: string[] = [];
  for (const segment of first.split('/')) {
    if (segment.includes('*') || segment.includes('{')) break;
    segments.push(segment);
  }
  return segments.join('/');
}

function relativeToScanRoot(path: string, profile: ImportProfile): string {
  const root = scanRoot(profile);
  if (root === '') return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/**
 * 디렉터리 계층 → 스펙 트리 (importer.md §2.2 · `tree.area_from_directory`).
 *
 * 규칙 셋을 그대로 옮긴다.
 *   ① 디렉터리당 area 노드 1개
 *   ② 그 디렉터리에 `area_body_file`(예: `_product-overview.md`)이 있으면 **그 문서가 곧
 *      area 노드다** — 별도 리프로 만들지 않는다. 키·제목·본문·요구사항을 그대로 승계하므로
 *      원본의 안정 ID 가 트리 중간 노드에 살아남는다(FR-01)
 *   ③ 없으면 본문 없는 노드를 만들고 **리포트에 표기한다**(Spec 은 트리 노드일 뿐 본문을
 *      갖지 않는다 — data-model §2.2)
 *
 * 이것이 없으면 모든 문서가 최상위에 평탄하게 붙는다 — 트리가 이 제품의 주 항해 수단인데
 * 130편이 한 층에 늘어서면 아무것도 찾을 수 없다(실측 2026-08-23).
 */
/** 테스트가 트리 규칙만 따로 확인할 수 있게 내보낸다 */
export const buildTreeForTesting = buildAreaTree;

function buildAreaTree(
  items: readonly ImportSpecItem[],
  profile: ImportProfile,
  entries: ReportEntry[],
): ImportSpecItem[] {
  if (!profile.tree.area_from_directory) return [...items];

  const bodyFile = profile.tree.area_body_file;
  const dirOf = (item: ImportSpecItem): string => {
    const rel = relativeToScanRoot(item.source_path, profile);
    const dir = dirname(rel);
    return dir === '.' ? '' : dir;
  };

  // ② 디렉터리를 대표하는 문서 — 있으면 그것이 area 노드다
  const areaByDir = new Map<string, ImportSpecItem>();
  const leaves: ImportSpecItem[] = [];
  for (const item of items) {
    const isBody = bodyFile !== undefined && basename(item.source_path) === bodyFile;
    const dir = dirOf(item);
    if (isBody && dir !== '') areaByDir.set(dir, item);
    else leaves.push(item);
  }

  // ③ 문서가 있는 모든 디렉터리 — 조상까지 포함해야 중간이 끊기지 않는다
  const dirs = new Set<string>();
  for (const item of items) {
    let dir = dirOf(item);
    while (dir !== '') {
      dirs.add(dir);
      dir = dirname(dir) === '.' ? '' : dirname(dir);
    }
  }

  const keyOfDir = new Map<string, string>();
  for (const dir of dirs) {
    const body = areaByDir.get(dir);
    // 대표 문서가 frontmatter `id` 를 선언했으면 그 안정 ID 를 area 가 승계한다(FR-01).
    // 선언하지 않아 경로에서 만든 키였다면 **디렉터리 키**가 낫다 —
    // `4-nodes-_product-overview` 는 사람이 부를 이름이 아니다.
    const declared =
      body !== undefined && body.key !== keyFromPath(relativeToScanRoot(body.source_path, profile));
    keyOfDir.set(dir, declared && body !== undefined ? body.key : keyFromPath(dir));
  }
  const parentKeyOf = (dir: string): string | null => {
    const parent = dirname(dir) === '.' ? '' : dirname(dir);
    return parent === '' ? null : (keyOfDir.get(parent) ?? null);
  };

  const areas: ImportSpecItem[] = [];
  for (const dir of [...dirs].sort()) {
    const existing = areaByDir.get(dir);
    if (existing !== undefined) {
      areas.push({
        ...existing,
        key: keyOfDir.get(dir) ?? existing.key,
        type: 'area',
        parent_key: parentKeyOf(dir),
      });
      continue;
    }
    entries.push({
      file: dir,
      line: null,
      reason: t()('cli.reason.area_without_body', { file: bodyFile ?? '' }),
      disposition: 'manual',
    });
    areas.push({
      source_path: dir,
      key: keyOfDir.get(dir) ?? keyFromPath(dir),
      parent_key: parentKeyOf(dir),
      type: 'area',
      title: basename(dir),
      // 본문 없는 트리 노드다 — 원문이 없는데 지어내지 않는다
      body_md: '',
      doc_status: 'approved',
      requirements: [],
      evidence: [],
    });
  }

  return [
    ...areas,
    ...leaves.map((item) => {
      const dir = dirOf(item);
      return { ...item, parent_key: dir === '' ? null : (keyOfDir.get(dir) ?? null) };
    }),
  ];
}
