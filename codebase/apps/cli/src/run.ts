// 임포트 실행 — 스캔 → 파싱 → 판정 → (선택) 적재 → 리포트.
//
// 실행 패스는 셋이다(importer.md §3.5). 순서가 규약이다:
//   ① structure  트리 골격 — 부모가 있어야 자식이 붙는다
//   ② document   본문·요구사항 — 파일 1건 = 트랜잭션 1건
//   ③ links      관계 해소 — 모든 노드가 존재한 뒤에야 참조가 풀린다
//
// dry-run 은 ①~③ 을 전부 계산하되 서버를 부르지 않는다. `--server` 가 있으면 preflight 까지
// 수행해 자연 키 충돌을 미리 본다(REQ-IMP-011).

import { IMPORT_BATCH_MAX } from '@nerv/schema';
import { displayKeySuffix } from '@nerv/schema/keys';
import { t } from './i18n.js';
import { basename, dirname } from 'node:path';
import type {
  ImportBatchResult,
  ImportProfile,
  ImportReviewItem,
  ImportSpecItem,
  ImportTaskItem,
} from '@nerv/schema';
import { ImportClient } from './client/index.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPlan } from './parse/plan.js';
import { branchFromRetryState, parseReviewSummary } from './parse/review.js';
import { addedAtMap, headOf, snapshotMap, snapshotOf } from './parse/git.js';
import { parseFrontmatter, splitStatus } from './parse/frontmatter.js';
import { extractRequirements } from './parse/requirements.js';
import { scan } from './parse/scan.js';
import {
  emptyManifest,
  knows,
  manifestFromServerMap,
  readManifest,
  writeManifest,
} from './manifest.js';
import type { Manifest, ManifestItem } from './manifest.js';
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
  if (options.command === 'review') return runReviewImport(options, profile);
  // **`rebuild-map` 은 적재하지 않는다.** 2026-09-06 까지 이 분기가 없어 spec 경로로
  // 떨어졌다 — "다시 짓는다" 는 이름의 명령이 임포트를 수행하고 있었다(§3.3).
  if (options.command === 'rebuild-map') return runRebuildMap(options, profile);

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
    rootCommit: headOf(options.root),
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

    // **매니페스트를 먼저 읽는다**(§3.3). 없으면 없는 것이지 실패가 아니다 — 첫 실행에는
    // 당연히 없다. 있으면 "우리가 넣은 것" 의 목록이고, 그것이 `map-conflict` 의 축이다.
    const manifest =
      readManifest(options.mapPath) ?? emptyManifest(profile.profile, options.project);

    // preflight — 서버 쓰기 0. 무엇이 이미 있고 무엇이 그대로인지 먼저 묻는다(§3.3·§3.4)
    const preflight = await client.preflight({
      profile: profile.profile,
      kind: 'spec',
      items: files.map((f) => ({
        source_path: f.path,
        natural_key: specKeyOf(f, profile),
        content_hash: bodyHash(f),
      })),
    });

    // **답을 쓴다.** 예전에는 이 응답을 받아서 버렸다 — 서버는 세 판정을 계산했고 CLI 는
    // 전건을 그대로 다시 보냈다. 재실행이 "바뀌지 않은 것은 건너뛴다"(REQ-IMP-004)를 못
    // 하던 이유의 절반이 이것이고(나머지 절반은 해시 축 — `bodyHash` 주석), 그 사이
    // 판정은 **계산만 되고 아무 일도 하지 않는 값**이었다.
    const unchanged = new Set(
      preflight.items.filter((i) => i.state === 'unchanged').map((i) => i.source_path),
    );
    // **실패 표에 넣지 않는다.** 무변경은 재실행의 정상이지 실패가 아니고, 엔트리로 올리면
    // 멱등 재실행이 종료 코드 1(실패·수동 확인 있음)을 내게 된다 — 게이트가 뒤집힌다.
    report.unchanged = unchanged.size;

    /**
     * **`map-conflict` — 매니페스트 없이 남의 데이터 위에 적재하지 않는다**(§3.3 · §4.1).
     *
     * 이 게이트는 매니페스트가 있어야 성립한다: 서버에 이미 있는 키가 *우리가 넣은 것*인지
     * *남이 넣은 것*인지 가릴 수 있어야 하기 때문이다. 그래서 2026-09-06 PR #1 에서는 켜지
     * 않고 남겼고, 매니페스트가 생긴 지금 켠다.
     *
     * abort 다 — 그 항목만 건너뛰는 것으로는 부족하다. 남의 프로젝트 위에 절반을 덮어쓰고
     * 멈추는 것이 아무것도 안 하고 멈추는 것보다 나쁘다. 되찾는 길은 `rebuild-map` 이다.
     */
    for (const item of preflight.items) {
      if (item.state === 'new' || knows(manifest, item.natural_key)) continue;
      entries.push({
        file: item.source_path,
        line: null,
        rule: 'map-conflict',

        reason: t()('cli.reason.map_conflict', { key: item.natural_key }),
        disposition: 'aborted',
      });
    }
    if (halted(entries)) return report;

    if (options.apply) {
      // ① 트리 골격 → ② 본문 순서. 부모가 먼저 있어야 자식이 붙는다
      //
      // **나눠 보낸다**(importer.md §3.1 `--batch-size`). 한 번에 보내면 본문이 몸집을
      // 키워 서버가 413 으로 끊는다 — clemvion 136건이 그랬다(실측 2026-08-23).
      for (const chunk of chunked(orderByParent(loadable), options.batchSize)) {
        await client.specs({
          profile: profile.profile,
          kind: 'structure',
          items: chunk,
          ...(report.rootCommit === null ? {} : { root_commit: report.rootCommit }),
        });
      }
      const applied: ImportBatchResult['items'] = [];
      // 본문은 **바뀐 것만** 보낸다. 골격은 부모가 먼저 있어야 하므로 전건을 보낸다
      // (upsert 라 무해하다) — 몸집을 키우는 것은 본문이다.
      const changed = loadable.filter((item) => !unchanged.has(item.source_path));
      for (const chunk of chunked(changed, options.batchSize)) {
        // 문서는 **파일 1건 = 트랜잭션 1건**이라(§3.5) 순서가 결과를 바꾸지 않는다
        applied.push(
          ...(
            await client.specs({
              profile: profile.profile,
              kind: 'document',
              items: chunk,
              ...(report.rootCommit === null ? {} : { root_commit: report.rootCommit }),
            })
          ).items,
        );
      }
      // 관계 — 문서가 서로를 가리키는 선. **문서 적재 뒤에 보낸다**: 양끝이 다 있어야
      // 해소된다. 이것이 없으면 그래프는 노드만 있고 선이 없는 화면이 된다.
      const relations = extractRelations(files, loadable);
      for (const chunk of chunked(relations, options.batchSize)) {
        await client.links({ profile: profile.profile, relations: chunk, pending: [] });
      }

      for (const item of applied) {
        if (item.status === 'error') {
          entries.push({
            file: item.source_path,
            line: null,
            rule: 'server-rejected',
            reason: item.detail ?? t()('cli.reason.load_failed'),
            disposition: 'skipped',
          });
          continue;
        }
        // **적재한 것을 매니페스트에 적는다**(§3.3). 이 기록이 다음 실행의 `map-conflict`
        // 판정 축이고, 링크 재작성·`spec_impact` 경로 변환이 쓰는 별칭 표다.
        const scanned = files.find((f) => f.path === item.source_path);
        const front = scanned === undefined ? null : parseFrontmatter(scanned.content);
        upsertManifestItem(manifest, {
          source_path: item.source_path,
          kind: 'spec',
          natural_key:
            loadable.find((l) => l.source_path === item.source_path)?.key ?? item.source_path,
          // **원문 해시는 둘이다**(REQ-IMP-030) — 본문만 세면 `updated:` 하나 고친 재실행이
          // 무변경으로 읽히고, 보존 값은 옛것으로 남는다.
          ...(scanned === undefined ? {} : { content_hash: bodyHash(scanned) }),
          ...(front?.raw == null
            ? {}
            : { frontmatter_hash: createHash('sha256').update(front.raw, 'utf8').digest('hex') }),
          ...(front === null ? {} : preservedOf(front.frontmatter, profile)),
          ...(item.spec_id === undefined ? {} : { spec_id: item.spec_id }),
          ...(item.spec_version_id === undefined ? {} : { spec_version_id: item.spec_version_id }),
          ...(item.requirement_refs === undefined ? {} : { requirements: item.requirement_refs }),
        });
      }
      manifest.root_commit = report.rootCommit;
      writeManifest(options.mapPath, manifest);
    }
  }

  return report;
}

/**
 * `nerv import rebuild-map` — 서버에서 매니페스트를 되짓는다(EP-IMP-05 · §3.3).
 *
 * **적재하지 않는다.** 이 명령의 존재 이유가 그것이다: 매니페스트를 잃은 사람이
 * `map-conflict` 로 막혔을 때 되찾는 길이고, 그 자리에서 임포트가 돌면 막은 뜻이 사라진다.
 * 2026-09-06 까지 분기가 없어 정확히 그 일이 일어나고 있었다.
 */
async function runRebuildMap(options: CliOptions, profile: ImportProfile): Promise<ImportReport> {
  const entries: ReportEntry[] = [];
  const report: ImportReport = {
    profile: profile.profile,
    root: options.root,
    rootCommit: headOf(options.root),
    scanned: 0,
    converted: 0,
    entries,
    expectation: [],
  };

  if (options.server === undefined || options.token === undefined) {
    // 서버에서 되짓는 명령이라 서버가 없으면 할 일이 없다 — dry-run 이 성립하지 않는다
    entries.push({
      file: t()('cli.report.aggregate'),
      line: null,
      rule: 'server-unauthorized',

      reason: t()('cli.reason.rebuild_needs_server'),
      disposition: 'aborted',
    });
    return report;
  }

  const client = new ImportClient({
    server: options.server,
    token: options.token,
    project: options.project,
  });
  const { items } = await client.map();
  const manifest = manifestFromServerMap(profile.profile, options.project, items);
  writeManifest(options.mapPath, manifest);

  report.scanned = items.length;
  report.converted = manifest.items.length;
  return report;
}

/** 매니페스트는 자연 키로 유일하다 — 재실행은 덮어쓴다(추가가 아니다) */
function upsertManifestItem(manifest: Manifest, item: ManifestItem): void {
  const at = manifest.items.findIndex((i) => i.natural_key === item.natural_key);
  if (at === -1) manifest.items.push(item);
  else manifest.items[at] = { ...manifest.items[at], ...item };
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
  // 완료 시각은 **git 이 안다** — frontmatter 에 완료일이 없다(§2.6d). 계획이
  // `plan/complete/` 에 처음 나타난 커밋이 곧 그것을 끝낸 날이다. 이력 한 번 훑기다.
  const completedAt = addedAtMap(options.root, 'plan/');
  // 스펙 경로 → 키. plan 패스는 spec 패스와 따로 도는데, 계획의 `spec_impact` 는
  // **경로**로 적혀 있고 서버가 아는 것은 **키**다. 같은 규칙으로 다시 계산한다 —
  // 규칙이 갈라지면 링크가 조용히 빗나가므로 spec 패스와 같은 함수를 쓴다(§2.6e).
  const specKeys = specKeyIndex(options, profile);
  const pending: { requirement_ref: string; task_source_path: string }[] = [];

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
        rule: 'research-doc',
        reason: classified.note ?? t()('cli.reason.reference_doc'),
        // **잘못된 것이 없다.** 참고 문서는 Task 를 만들지 않는 것이 정상이라 `warn` 이다 —
        // `skipped` 로 두면 정상 실행이 종료 코드 1 을 낸다(§4.1 의 4분류).
        disposition: 'warn',
      });
      statusCounts['reference'] = (statusCounts['reference'] ?? 0) + 1;
      continue;
    }

    const task = classified.task;
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    for (const warning of task.warnings) {
      entries.push({
        file: file.path,
        line: null,
        rule: 'pending-plan-unresolved',
        reason: warning,
        disposition: 'manual',
      });
    }
    if (task.assignee_user_id === null && task.owner_label !== null) {
      statusCounts['unassigned'] = (statusCounts['unassigned'] ?? 0) + 1;
    }

    // 기준 스펙 — 계획이 건드린다고 적어 둔 스펙 중 **우리가 아는 첫 번째**.
    // 여럿이면 첫 번째를 기준으로 삼는다: 하나만 고를 수 있는 자리이고(FK 는 단수),
    // 원본의 나열 순서가 곧 그 계획의 주된 대상이라는 것이 실측이다.
    const specKey = task.spec_paths.map((path) => specKeys.get(path)).find((k) => k !== undefined);
    if (task.spec_paths.length > 0 && specKey === undefined) {
      entries.push({
        file: task.source_path,
        line: null,
        rule: 'plan-spec-unresolved',
        reason: t()('cli.reason.plan_spec_unresolved', { paths: task.spec_paths.join(', ') }),
        disposition: 'skipped',
      });
    }

    // **하나뿐일 때만 링크한다.** 여럿을 언급한 계획은 그중 무엇을 구현한 것인지
    // 문서가 말하지 않는다 — 고르는 순간 없는 판정을 지어내는 것이 된다.
    if (task.requirement_refs.length === 1) {
      pending.push({
        requirement_ref: task.requirement_refs[0]!,
        task_source_path: task.source_path,
      });
    } else if (task.requirement_refs.length > 1) {
      entries.push({
        file: task.source_path,
        line: null,
        rule: 'plan-many-refs',
        reason: t()('cli.reason.plan_many_refs', { count: task.requirement_refs.length }),
        disposition: 'manual',
      });
    }

    const doneAt = task.status === 'done' ? (completedAt.get(task.source_path) ?? null) : null;
    if (task.status === 'done' && doneAt === null) {
      // 되찾지 못하면 서버가 적재 시각으로 채운다 — 조용히 넘기지 않고 리포트에 올린다
      entries.push({
        file: task.source_path,
        line: null,
        rule: 'done-at-unrecovered',
        reason: t()('cli.reason.plan_no_done_at'),
        disposition: 'manual',
      });
    }
    items.push({
      source_path: task.source_path,
      title: task.title,
      body_md: task.body_md,
      status: task.status,
      assignee_user_id: task.assignee_user_id,
      depends_on: [],
      ...(specKey === undefined ? {} : { source_spec_key: specKey }),
      ...(doneAt === null ? {} : { done_at: doneAt }),
      // **계산해 놓고 버리던 셋**(2026-09-07 · REQ-IMP-027·028). 파서는 이 값들을 원본에서
      // 읽어 놓고 계약에 실을 자리가 없어 흘렸다 — 서버는 그때마다 기본값을 채웠고,
      // 화면은 그 기본값을 **사람이 고른 값**으로 그렸다.
      //
      // 미표기는 보내지 않는다: 여기서 `null` 을 명시하는 것과 키를 빼는 것은 서버에서
      // 같은 결과(NULL·now())이지만, **없는 것을 없다고 적는 편**이 계약을 읽는 쪽에 낫다.
      ...(task.priority === null ? {} : { priority: task.priority as ImportTaskItem['priority'] }),
      ...(task.started === null ? {} : { created_at: task.started }),
      ...(task.spec_impact === null ? {} : { spec_impact: task.spec_impact }),
    });
  }

  // spec 과 같은 규율이다 — 서버가 만들 표시 ID 를 미리 계산해 충돌을 거른다.
  // 겹친 채로 보내면 서버는 정상 upsert 로 받아들이고 나중 것이 앞선 것을 덮어쓴다:
  // 상태가 다른 두 티켓이 하나가 되는데 리포트는 "실패 0"이다(실측 2026-08-23).
  const loadable = withoutDuplicateTaskKeys(items, entries);

  const report: ImportReport = {
    profile: profile.profile,
    root: options.root,
    rootCommit: headOf(options.root),
    scanned: files.length,
    converted: loadable.length,
    entries,
    expectation: checkPlanExpectations(profile, files.length, statusCounts, entries),
  };

  // **abort 는 세 패스 모두에서 문을 닫는다**(2026-09-07 · REQ-IMP-023). spec 패스만
  // 게이트를 걸고 있었고, plan·review 는 `aborted` 항목을 리포트에 적은 뒤 **그대로 전송**
  // 했다 — 중단이라 적어 놓고 중단하지 않으면 그 등급은 이름만 남는다.
  if (halted(entries)) return report;

  if (options.server !== undefined && options.token !== undefined && options.apply) {
    const client = new ImportClient({
      server: options.server,
      token: options.token,
      project: options.project,
    });
    // **나눠 보낸다** — spec 패스와 같은 이유이자 같은 한도다(계약 `max(200)`).
    // plan 패스만 이 처리가 빠져 있어 clemvion 481건이 한 요청으로 나갔고 서버가
    // 스키마 위반으로 거절했다(실측 2026-08-23). 본문 크기가 아니라 항목 수의 벽이다.
    const applied: ImportBatchResult['items'] = [];
    for (const chunk of chunked(loadable, options.batchSize)) {
      applied.push(
        ...(
          await client.tasks({
            profile: profile.profile,
            items: chunk,
            ...(report.rootCommit === null ? {} : { root_commit: report.rootCommit }),
          })
        ).items,
      );
    }

    // 요구사항 ↔ Task 링크는 **Task 가 다 들어온 뒤에** 보낸다 — 양끝이 있어야 해소된다.
    // 이 호출이 없어 계약의 `pending` 이 늘 빈 배열이었고, 그래서 커버리지의
    // "요구사항 → 작업" 축이 언제나 0 이었다(실측 2026-08-24).
    for (const chunk of chunked(pending, options.batchSize)) {
      const linked = await client.links({
        profile: profile.profile,
        relations: [],
        pending: chunk,
      });
      for (const item of linked.items) {
        if (item.status !== 'ok') {
          entries.push({
            file: item.source_path,
            line: null,
            rule: 'server-rejected',
            reason: item.detail ?? t()('cli.reason.load_failed'),
            disposition: 'skipped',
          });
        }
      }
    }

    for (const item of applied) {
      if (item.status === 'error') {
        entries.push({
          file: item.source_path,
          line: null,
          rule: 'server-rejected',
          reason: item.detail ?? t()('cli.reason.load_failed'),
          disposition: 'skipped',
        });
      }
    }
  }

  return report;
}

/**
 * 스펙 파일 경로 → 스펙 키. **spec 패스와 같은 규칙**이다(frontmatter `id` 우선, 없으면
 * 스캔 뿌리 기준 상대 경로에서 만든다) — 규칙이 갈라지면 plan 이 가리키는 키와 spec 이
 * 발급한 키가 어긋나 링크가 조용히 빗나간다(§2.6e).
 */
function specKeyIndex(options: CliOptions, profile: ImportProfile): Map<string, string> {
  const out = new Map<string, string>();
  if (profile.scan.spec.length === 0) return out;
  for (const file of scan(options.root, profile.scan.spec, profile.scan.exclude)) {
    const { frontmatter } = parseFrontmatter(file.content);
    // **`id` 를 읽는다.** 프로파일의 `frontmatter.id: 'spec.key'` 는 "원본의 id 가 우리
    // spec.key 가 된다"는 **매핑 방향**이지 원본 필드 이름이 아니다 — 그것을 필드
    // 이름으로 읽어 `key` 를 찾았더니 365건 중 31건만 맞았다(실측 2026-08-24).
    // spec 패스가 읽는 자리와 같아야 한다(`convert()`).
    const declared = frontmatter['id'];
    out.set(
      file.path,
      typeof declared === 'string' && declared !== ''
        ? declared
        : keyFromPath(relativeToScanRoot(file.path, profile)),
    );
  }
  return out;
}

/**
 * review 패스 — **리뷰를 파일에서 레코드로**(FR-09 · importer.md §2.7).
 *
 * 원본 한 세션 = `review/<kind>/YYYY/MM/DD/HH_MM_SS/` 디렉터리이고, 그 안에서 우리가
 * 읽는 것은 `SUMMARY.md`(결론) · `meta.json`(대상 파일) · `_retry_state.json`(브랜치)
 * 셋뿐이다. 역할별 md 13,777개는 **읽지 않는다** — 옮기면 clemvion 의 131MB 를 DB 안에서
 * 재현하는 것이 된다(D-01·D-07).
 *
 * `head_sha`·`base_sha` 는 원본에 없어서 git 이력에서 되찾는다(§2.7). 되찾지 못한 세션은
 * **건너뛴다**: 무엇을 봤는지 답할 수 없는 리뷰는 게이트의 근거가 되지 못한다.
 */
async function runReviewImport(options: CliOptions, profile: ImportProfile): Promise<ImportReport> {
  const patterns = profile.scan.review ?? [];
  const files = patterns.length === 0 ? [] : scan(options.root, patterns, profile.scan.exclude);
  const entries: ReportEntry[] = [];
  const items: ImportReviewItem[] = [];
  const snapshots = snapshotMap(options.root, 'review/');
  let findingCount = 0;

  for (const file of files) {
    const sessionDir = dirname(file.path);
    const snapshot = snapshotOf(snapshots, sessionDir);
    if (snapshot === null) {
      // 커밋되지 않은 리뷰다(작업 트리에만 있는 것). 스냅샷이 없으면 받을 수 없다.
      entries.push({
        file: file.path,
        line: null,
        rule: 'review-no-snapshot',
        reason: t()('cli.reason.review_no_snapshot'),
        disposition: 'skipped',
      });
      continue;
    }

    const parsed = parseReviewSummary(file.content);
    const meta = readJson(join(options.root, sessionDir, 'meta.json'));
    const retry = readText(join(options.root, sessionDir, '_retry_state.json'));
    const branch = retry === null ? 'main' : branchFromRetryState(retry, 'main');

    if (parsed.tableless) {
      // 산문 형식 SUMMARY(원본 271/1,984 — sub-agent 실패 등). 세션은 남기되 사람이 본다.
      entries.push({
        file: file.path,
        line: null,
        rule: 'review-tableless',
        reason: t()('cli.reason.review_tableless'),
        disposition: 'manual',
      });
    }

    findingCount += parsed.findings.length;
    items.push({
      source_path: sessionDir,
      kind: reviewKindOf(sessionDir),
      branch,
      base_sha: snapshot.base_sha === '' ? snapshot.head_sha : snapshot.base_sha,
      head_sha: snapshot.head_sha,
      changeset: changesetOf(meta),
      ...(timestampOf(meta) === null ? {} : { reviewed_at: timestampOf(meta)! }),
      block: parsed.block,
      reports: reportsOf(parsed, meta),
      findings: parsed.findings,
    });
  }

  const report: ImportReport = {
    profile: profile.profile,
    root: options.root,
    rootCommit: headOf(options.root),
    scanned: files.length,
    converted: items.length,
    entries,
    expectation: checkReviewExpectations(profile, files.length, findingCount, entries),
  };

  // spec·plan 과 같은 게이트다(REQ-IMP-023)
  if (halted(entries)) return report;

  if (options.server !== undefined && options.token !== undefined && options.apply) {
    const client = new ImportClient({
      server: options.server,
      token: options.token,
      project: options.project,
    });
    const applied: ImportBatchResult['items'] = [];
    for (const chunk of chunked(items, options.batchSize)) {
      applied.push(
        ...(
          await client.reviews({
            profile: profile.profile,
            items: chunk,
            ...(report.rootCommit === null ? {} : { root_commit: report.rootCommit }),
          })
        ).items,
      );
    }
    for (const item of applied) {
      if (item.status === 'error') {
        entries.push({
          file: item.source_path,
          line: null,
          rule: 'server-rejected',
          reason: item.detail ?? t()('cli.reason.load_failed'),
          disposition: 'skipped',
        });
      }
    }
  }

  return report;
}

/** `review/code/...` → `code`. 디렉터리가 kind 다(원본 구조가 그렇게 나뉘어 있다). */
function reviewKindOf(sessionDir: string): ImportReviewItem['kind'] {
  const segment = sessionDir.split('/')[1] ?? '';
  if (segment === 'consistency') return 'consistency';
  if (segment === 'spec-coverage') return 'spec_coverage';
  if (segment === 'merge') return 'merge';
  return 'code';
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, unknown> | null {
  const raw = readText(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 검토 대상 목록 — changeset 해시의 재료다. **kind 마다 다른 곳에 있다**(실측):
 *   code         `files[].file_path` — 파일 목록
 *   consistency  `target_path` — 검사 대상 경로 하나(`files` 자체가 없다)
 *
 * 이 갈래를 놓치면 consistency 세션의 changeset 이 전부 비고, **같은 커밋에 들어온 두
 * 검사가 한 세션으로 합쳐진다**(실측 2026-08-24: 922건이 461건으로 정확히 반이 됐다).
 * 라운드 병합은 "같은 것을 다시 본 것"에만 일어나야 한다.
 */
function changesetOf(meta: Record<string, unknown> | null): string[] {
  const files = meta?.['files'];
  if (Array.isArray(files)) {
    return files
      .map((f) => (f as { file_path?: unknown }).file_path)
      .filter((p): p is string => typeof p === 'string');
  }
  const target = meta?.['target_path'];
  return typeof target === 'string' && target !== '' ? [target] : [];
}

function timestampOf(meta: Record<string, unknown> | null): string | null {
  const value = meta?.['timestamp'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * 역할별 리포트. **표가 있으면 그것이 정본**이고(위험도·핵심 발견이 함께 온다),
 * 없으면 `meta.json.agents` 명단으로 커버리지만 남긴다 — 누가 봤는지는 게이트가 묻는
 * 질문이라(커버리지 무결성) 위험도를 모르더라도 명단은 값이 있다.
 */
function reportsOf(
  parsed: ReturnType<typeof parseReviewSummary>,
  meta: Record<string, unknown> | null,
): ImportReviewItem['reports'] {
  if (parsed.reports.length > 0) return parsed.reports;
  // 역할 명단도 kind 마다 이름이 다르다 — code 는 `agents`, consistency 는 `checkers`
  const roster = meta?.['agents'] ?? meta?.['checkers'];
  if (!Array.isArray(roster)) return [];
  return roster
    .filter((a): a is string => typeof a === 'string')
    .map((role) => ({ role, risk: parsed.risk, body_md: null }));
}

/** review 기대 집계 — plan·spec 과 같은 규율이다(REQ-IMP-016). */
function checkReviewExpectations(
  profile: ImportProfile,
  scanned: number,
  findings: number,
  entries: ReportEntry[],
): ImportReport['expectation'] {
  const results: ImportReport['expectation'] = [];
  const expected = profile.expect?.review_total;
  if (expected !== undefined) {
    const ok = expected === scanned;
    results.push({ field: 'review_total', expected, actual: scanned, ok });
    if (!ok) {
      entries.push({
        file: t()('cli.report.aggregate'),
        line: null,
        rule: 'count-mismatch',

        reason: t()('cli.reason.review_total', { expected, actual: scanned }),
        disposition: 'aborted',
      });
    }
  }
  // 발견 수는 **기대값이 없다** — 원본이 살아 있는 저장소라 수치가 자란다. 세고 적기만 한다.
  results.push({ field: 'review_findings', expected: findings, actual: findings, ok: true });
  return results;
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
        rule: 'count-mismatch',

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
  const parsed = parseFrontmatter(file.content);
  const { frontmatter, body } = parsed;
  const key = specKeyOf(file, profile);

  // **닫히지 않은 frontmatter 는 조용히 넘기지 않는다**(REQ-IMP-030). 예전에는 전체를
  // 본문으로 돌렸고, 사람이 오타를 낸 문서가 "frontmatter 없는 문서" 로 적재되면서 `id` 가
  // 경로에서 지어졌다 — 원본에 있던 고정 ID 를 잃은 채로.
  if (parsed.unparsable) {
    entries.push({
      file: file.path,
      line: null,
      rule: 'frontmatter-unparsable',
      reason: t()('cli.reason.frontmatter_unparsable'),
      disposition: 'skipped',
    });
    return null;
  }

  const rawStatus = typeof frontmatter['status'] === 'string' ? frontmatter['status'] : undefined;
  if (rawStatus !== undefined) statusCounts[rawStatus] = (statusCounts[rawStatus] ?? 0) + 1;

  // **status 가 없다는 사실을 조용히 넘기지 않는다**(§5.1 · `frontmatter-missing`).
  // 아무 말도 없으면 사람은 적재된 값을 자기가 고른 값이라고 읽는다. `skip` 이 아니라
  // **`warn`** 인 이유는 적재 자체는 정상이기 때문이다 — 이 저장소의 15편이 그 경우다.
  if (rawStatus === undefined) {
    entries.push({
      file: file.path,
      line: null,
      rule: 'frontmatter-missing',
      reason: t()('cli.reason.frontmatter_missing'),
      disposition: 'warn',
    });
  }

  // 프로파일이 기본값을 선언했으면 그것이 "없을 때의 값" 이다 — 없으면 draft 로 떨어진다.
  // 이 저장소의 승인된 정본 15편이 초안으로 적재되던 자리다(§5.1 · REQ-IMP-030).
  const effectiveStatus = rawStatus ?? profile.frontmatter.status_default;
  const status = splitStatus(effectiveStatus, profile.frontmatter.status_map);
  if (rawStatus !== undefined && status === null) {
    // 매핑에 없는 값을 기본값으로 넘기지 않는다 — 그러면 117/17/1 집계가 조용히 틀어진다
    entries.push({
      file: file.path,
      line: null,
      rule: 'status-unknown',
      reason: t()('cli.reason.unknown_status', { value: rawStatus }),
      // 어휘 밖 값은 **적재에서 빼고 계속**이다 — 사람이 고칠 것은 원본이지 이 실행이 아니다
      disposition: 'skipped',
    });
    return null;
  }

  // **버린 키를 적어 둔다**(REQ-IMP-030). 조용히 버리면 다음 사람은 그 키가 원본에
  // 있었다는 사실조차 모른다 — 무엇을 잃었는지 아는 것이 정보 손실 0 의 실무적 최소치다.
  const unmapped = preservedOf(frontmatter, profile).unmapped_keys ?? [];
  if (unmapped.length > 0) {
    entries.push({
      file: file.path,
      line: null,
      rule: 'frontmatter-unmapped',
      reason: t()('cli.reason.frontmatter_unmapped', { keys: unmapped.join(', ') }),
      disposition: 'warn',
    });
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
    sort_key: sortKeyOf(basename(file.path)),
    requirements: requirementsOf(file, body, profile, status?.impl ?? 'unimplemented', entries),
    evidence: [],
  };
}

/**
 * 요구사항 추출 + 그 과정에서 생긴 수동 확인 큐(§2.5 · §4.1).
 *
 * **정의를 가진 파일이 따로 있으면 거기서만 읽는다**(규칙 1). clemvion 은
 * `_product-overview.md` 가 그 파일이고, 프로파일이 `tree.area_body_file` 로 선언한다.
 * 선언이 없는 프로파일(nerv-docs)은 모든 파일의 표를 읽는다 — 정의 파일이 따로 없다는 뜻이다.
 */
function requirementsOf(
  file: ScannedFile,
  body: string,
  profile: ImportProfile,
  implStatus: string,
  entries: ReportEntry[],
): ImportSpecItem['requirements'] {
  const bodyFile = profile.tree.area_body_file;
  if (bodyFile !== undefined && basename(file.path) !== bodyFile) return [];

  const { requirements, duplicates } = extractRequirements(body, profile.requirement.id_pattern);

  for (const duplicate of duplicates) {
    entries.push({
      file: file.path,
      line: duplicate.line,
      rule: 'req-id-duplicate',

      reason: t()('cli.reason.req_id_duplicate', { ref: duplicate.ref }),
      disposition: 'manual',
    });
  }
  for (const requirement of requirements.filter((r) => r.priority === null)) {
    entries.push({
      file: file.path,
      line: requirement.line,
      rule: 'req-priority-missing',

      reason: t()('cli.reason.req_priority_missing', { ref: requirement.ref }),
      disposition: 'manual',
    });
  }
  // 문서 status 복사값의 요구사항 단위 확정(§2.3 · `impl-status-doc-copied`). 구현 축이
  // `in_progress` 라는 것은 **일부만 됐다**는 뜻이고, 그 한 값을 모든 요구사항에 복사한
  // 순간 어떤 행은 반드시 틀린다 — 어느 행인지는 문서가 답하지 못한다.
  if (implStatus === 'in_progress' && requirements.length > 0) {
    entries.push({
      file: file.path,
      line: null,
      rule: 'impl-status-doc-copied',

      reason: t()('cli.reason.impl_status_doc_copied', { count: requirements.length }),
      disposition: 'manual',
    });
  }

  return requirements.map((r) => ({
    ref: r.ref,
    text: r.text,
    acceptance_md: r.acceptance,
    priority: r.priority,
    impl_status: implStatus as 'unimplemented',
    ordinal: r.ordinal,
  }));
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

/**
 * 멱등 키의 축은 (파일 경로 + frontmatter id) 다(§3.3).
 *
 * **적재하는 키와 preflight 가 묻는 키는 같아야 한다.** 서버는 이 값을 `spec.key` 로 찾는데
 * (`import.service.preflight`), 예전에는 frontmatter id 가 없는 파일에 대해 적재는
 * `keyFromPath(…)` 를, 조회는 `file.path` 를 썼다 — 축이 어긋나 그 파일들은 이미 적재돼
 * 있어도 언제나 `new` 로 돌아왔다. 두 자리가 같은 함수를 부르게 해서 다시 어긋나지 않게 한다.
 */
function specKeyOf(file: ScannedFile, profile: ImportProfile): string {
  const { frontmatter } = parseFrontmatter(file.content);
  const id = frontmatter['id'];
  // **폴백은 경로다.** 파일명만 쓰면 디렉터리가 다른 동명 파일이 같은 키를 갖고, upsert 가
  // 서로를 덮어쓴다 — clemvion 은 `_product-overview.md` 7건 · `0-common.md` 7건이라
  // 136건이 127노드로 줄고 9건이 조용히 사라졌다(실측 2026-08-23). 경로는 유일하다.
  return typeof id === 'string' && id !== ''
    ? id
    : keyFromPath(relativeToScanRoot(file.path, profile));
}

/**
 * preflight 가 보내는 해시 — **본문 해시다.** 파일 전문 해시가 아니다.
 *
 * 서버가 견주는 것은 `spec_version.content_hash = sha256(body_md)` 이고 `body_md` 는
 * frontmatter 를 뺀 본문이다(REQ-IMP-002). CLI 는 파일 전문(`scan.contentHash`)을 보내고
 * 있었으므로 두 값은 **같아질 수가 없었고**, `unchanged` 판정이 영구히 나오지 않았다 —
 * 재실행이 "바뀌지 않은 것은 건너뛴다"(REQ-IMP-004)를 못 하던 이유다.
 */
function bodyHash(file: ScannedFile): string {
  const { body } = parseFrontmatter(file.content);
  return createHash('sha256').update(body, 'utf8').digest('hex');
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
        rule: 'count-mismatch',

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
        rule: 'dist-mismatch',
        reason: t()('cli.reason.status_dist', { status, expected, actual }),
        // 전표(§4.1)가 warn 이라 적는다 — 분포가 기대와 다른 것은 **아무것도 잘못되지
        // 않은 사실**이라 종료 코드를 올리지 않는다(그 코드를 게이트로 쓰는 쪽이 있다)
        disposition: 'warn',
      });
    }
  }
  return results;
}

/** n 개씩 끊는다 — 배치는 전송 단위일 뿐이다(api.md §2.10) */
/**
 * 배치 분할. **상한은 계약이 정한다**(`IMPORT_BATCH_MAX`) — 호출부가 준 값이 더 크면 깎는다.
 *
 * 보증을 호출부가 아니라 여기에 두는 이유: `--batch-size` 는 사람에게서 오고, 보내는 자리는
 * 네 곳(structure·document·links·tasks)이다. 각자 지키게 하면 한 곳이 빠졌을 때 드러나지
 * 않는다 — 실제로 tasks 가 그랬다(실측 2026-08-23).
 */
/**
 * **abort 는 전송 전에 문을 닫는다**(REQ-IMP-023).
 *
 * 세 패스가 각자 이 판정을 적으면 언젠가 한 곳이 빠진다 — 실제로 그랬다: spec 패스만
 * 게이트가 있었고 plan·review 는 `aborted` 를 적은 채 그대로 보냈다. 등급이 무엇을 뜻하는지는
 * 한 곳에서만 정한다.
 */
function halted(entries: readonly ReportEntry[]): boolean {
  return entries.some((e) => e.disposition === 'aborted');
}

function chunked<T>(items: readonly T[], requested: number): T[][] {
  const size = Math.min(IMPORT_BATCH_MAX, Math.max(1, requested));
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
 * 파일·디렉터리 이름의 숫자 접두 → 형제 정렬 키.
 *
 * `0-common.md`·`1-logic`·`10-triggers` 의 접두는 저자가 적어 둔 읽는 순서다. 그대로 문자열로
 * 두면 `10` 이 `9` 앞에 오므로(텍스트 정렬) **폭을 고정해 0 으로 채운다**.
 *
 * 앞의 한 글자는 숫자 유무를 가르는 순위다 — 접두가 있으면 `0`, 없으면 `1`. 콜레이션이
 * 달라져도 `'1' > '0…'` 은 흔들리지 않으므로 접두 없는 이름은 항상 뒤로 간다. `ls` 순서와
 * 같은 결과이고, 같은 순위 안의 동률은 트리 질의의 `ORDER BY sort_key, key` 가 푼다.
 */
export function sortKeyOf(name: string): string {
  const digits = /^(\d+)/.exec(name);
  return digits === null ? '1' : `0${digits[1]!.padStart(6, '0')}`;
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
 * task 버전(判) — `withoutDuplicateKeys` 와 같은 이유, 다른 키다.
 *
 * spec 은 키가 frontmatter·경로에서 오지만 task 의 표시 ID 는 **서버가 원본 경로를 해싱해**
 * 만든다. CLI 는 `project.key` 를 모르므로 **변하는 부분만** 견준다 — 한 프로젝트 안에서
 * 접두는 상수라 충돌은 거기서만 일어난다(`displayKeySuffix`).
 */
function withoutDuplicateTaskKeys(
  items: readonly ImportTaskItem[],
  entries: ReportEntry[],
): ImportTaskItem[] {
  const byKey = new Map<string, string[]>();
  for (const item of items) {
    const key = displayKeySuffix(item.source_path);
    byKey.set(key, [...(byKey.get(key) ?? []), item.source_path]);
  }
  const conflicted = new Set<string>();
  for (const [key, paths] of byKey) {
    if (paths.length < 2) continue;
    conflicted.add(key);
    for (const path of paths) {
      entries.push({
        file: path,
        line: null,
        rule: 'id-collision',
        reason: t()('cli.reason.duplicate_key', { key, count: paths.length }),
        // **항목 제외이지 실행 중단이 아니다**(2026-09-07 · 사람 결정). 코드는 처음부터
        // 그 항목만 빼고 계속했는데 등급만 `aborted` 였다 — 등급은 종료 코드와 재실행 큐를
        // 가르는 축이라 뜻이 하나여야 한다. 신호는 남는다: skipped 도 종료 코드 1 이다.
        disposition: 'skipped',
      });
    }
  }
  return items.filter((item) => !conflicted.has(displayKeySuffix(item.source_path)));
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
        rule: 'id-collision',
        reason: t()('cli.reason.duplicate_key', { key, count: paths.length }),
        // **항목 제외이지 실행 중단이 아니다**(2026-09-07 · 사람 결정). 코드는 처음부터
        // 그 항목만 빼고 계속했는데 등급만 `aborted` 였다 — 등급은 종료 코드와 재실행 큐를
        // 가르는 축이라 뜻이 하나여야 한다. 신호는 남는다: skipped 도 종료 코드 1 이다.
        disposition: 'skipped',
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
 *      원본의 고정 ID 가 트리 중간 노드에 살아남는다(FR-01)
 *   ③ 없으면 본문 없는 노드를 만들고 **리포트에 표기한다**(Spec 은 트리 노드일 뿐 본문을
 *      갖지 않는다 — data-model §2.2)
 *
 * 이것이 없으면 모든 문서가 최상위에 평탄하게 붙는다 — 트리가 이 제품의 주 항해 수단인데
 * 130편이 한 층에 늘어서면 아무것도 찾을 수 없다(실측 2026-08-23).
 */
/** 테스트가 트리 규칙만 따로 확인할 수 있게 내보낸다 */
export const buildTreeForTesting = buildAreaTree;
export const withoutDuplicateTaskKeysForTesting = withoutDuplicateTaskKeys;
export const withoutDuplicateKeysForTesting = withoutDuplicateKeys;

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
    // 대표 문서가 frontmatter `id` 를 선언했으면 그 고정 ID 를 area 가 승계한다(FR-01).
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
        // 순서를 가진 쪽은 디렉터리 이름이다 — 대표 문서 이름(`_product-overview.md`)이 아니라.
        sort_key: sortKeyOf(basename(dir)),
      });
      continue;
    }
    entries.push({
      file: dir,
      line: null,
      rule: 'area-body-missing',
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
      sort_key: sortKeyOf(basename(dir)),
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

/**
 * 본문의 상대경로 링크 → `references` 관계 (importer.md §2.4 · REQ-API-024).
 *
 * **경로 해소는 클라이언트만 할 수 있다.** 서버는 원본 체크아웃을 보지 못하므로(§3.2)
 * `[텍스트](../5-system/x.md)` 가 어느 스펙을 가리키는지 알 방법이 없다. 고정 ID 로 쓰인
 * 참조는 서버가 저장 시점에 동기화하고(SpecRelationService), 경로로 쓰인 참조는 여기서
 * 키로 바꿔 보낸다 — 둘이 같은 `references` kind 로 합류한다.
 *
 * 없는 파일을 가리키는 링크는 **버린다**. 원본의 깨진 링크를 관계로 만들면 그래프가
 * 있지도 않은 문서를 가리키게 된다.
 */
function extractRelations(
  files: readonly ScannedFile[],
  items: readonly ImportSpecItem[],
): { from_key: string; to_key: string; kind: 'references' }[] {
  const keyByPath = new Map(items.map((item) => [item.source_path, item.key]));
  const known = new Set(items.map((item) => item.key));
  const seen = new Set<string>();
  const out: { from_key: string; to_key: string; kind: 'references' }[] = [];

  for (const file of files) {
    const from = keyByPath.get(file.path);
    if (from === undefined) continue;
    for (const match of file.content.matchAll(/\]\((\.{1,2}\/[^)\s#]+\.md)/g)) {
      const to = keyByPath.get(joinPosix(dirname(file.path), match[1] ?? ''));
      // 자기 참조는 관계가 아니고, 적재되지 않은 문서(중복 키로 빠진 것)도 끝점이 못 된다
      if (to === undefined || to === from || !known.has(to)) continue;
      const edge = `${from} ${to}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      out.push({ from_key: from, to_key: to, kind: 'references' });
    }
  }
  return out;
}

/** `a/b` + `../c/d.md` → `a/c/d.md`. 스캔 경로는 posix 라 이 정도면 충분하다 */
function joinPosix(base: string, relative: string): string {
  const segments = base === '.' ? [] : base.split('/');
  for (const part of relative.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

/**
 * 매니페스트에 남길 frontmatter — **옮긴 것과 버린 것을 가른다**(§3.3 · REQ-IMP-030).
 *
 * `preserve` 는 NERV 필드로 옮길 자리가 없지만 원본으로 되돌릴 때 필요한 값이고,
 * `unmapped_keys` 는 **적재되지도 보존되지도 않은** 키다 — 조용히 버리면 다음 사람은 그
 * 키가 원본에 있었다는 사실조차 모른다. 무엇을 잃었는지 적어 두는 것이 정보 손실 0 의
 * 실무적 최소치다.
 */
function preservedOf(
  frontmatter: Record<string, string | string[]>,
  profile: ImportProfile,
): Pick<ManifestItem, 'frontmatter' | 'unmapped_keys'> {
  const preserve = profile.frontmatter.preserve;
  const known = new Set([
    'id',
    'status',
    ...preserve,
    ...(profile.frontmatter.code === undefined ? [] : ['code']),
    ...(profile.frontmatter.pending_plans === undefined ? [] : ['pending_plans']),
  ]);
  const kept: Record<string, string | string[]> = {};
  for (const key of preserve) {
    const value = frontmatter[key];
    if (value !== undefined) kept[key] = value;
  }
  const unmapped = Object.keys(frontmatter).filter((k) => !known.has(k));
  return {
    ...(Object.keys(kept).length === 0 ? {} : { frontmatter: kept }),
    ...(unmapped.length === 0 ? {} : { unmapped_keys: unmapped }),
  };
}
