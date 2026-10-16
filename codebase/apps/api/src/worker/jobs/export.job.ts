// 승인본 미러 — md 파일을 쓰고 git 저장소에 커밋하며, 원격이 있으면 push 한다 (P1 후반 · git 커밋은 2026-10-16 · E21-S02)
//
// **DB 가 진실이고 md 는 표현이다**(D-09). 이 잡은 그 표현을 파일로 떨어뜨려, git 을 보는
// 도구·사람이 NERV 없이도 승인된 스펙을 읽을 수 있게 한다 — 반대 방향(파일 → DB)은 없다.
// 파일에서 DB 로 되돌아오는 경로를 열면 두 개의 진실이 생긴다.
//
// **미러 폴더는 git 저장소다**(2026-10-16 · 사람 지시 · codebase.md REQ-CB-062). 예전에는 디렉터리에 쓰기만 하고 배포를
// 운영의 선택으로 남겼다. 이제 내보낸 파일이 바뀌면 커밋하고(바뀐 것이 없으면 커밋하지 않는다), `NERV_MIRROR_GIT_REMOTE` 가
// 있으면 fast-forward 로만 push 한다. M2 롤백은 이 미러를 SoT 로 승격하므로(roadmap §7.6) 미러는 컷오버 전부터 늘 최신
// 승인본을 담아야 한다. 원격에 NERV 가 만들지 않은 커밋이 있으면 push 를 멈추고 경고한다(REQ-CB-063 · roadmap §7.4 규칙 1).
//
// **프로젝트 폴더는 `<조직 slug>/<프로젝트 slug>/` 다**(2026-10-16 · REQ-CB-062). 프로젝트 slug 는 조직 안에서만 유일하다
// (`project_org_slug_uq`). 예전처럼 프로젝트 slug 만 폴더로 쓰면 두 조직의 `web` 이 같은 폴더에 써서 한쪽이 다른 쪽을 덮었고,
// 그 덮어쓰기가 원격 이력에 남았으며 갈라짐 경고도 엉뚱한 프로젝트에 갔다. 조직 slug 는 전역에서 유일하고 바뀌지 않는다.
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { HEARTBEAT_INTERVAL_SECONDS, NERV_EVENT_PHASE2 } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { resolveInside, safePathSegment } from '../../common/safe-path.js';
import { EventService } from '../../modules/event/event.service.js';
import { BaselineService } from '../../modules/spec/baseline.service.js';
import { SpecService } from '../../modules/spec/spec.service.js';
import { MirrorGit, mirrorGitConfig } from '../mirror-git.js';
import type { PushOutcome } from '../mirror-git.js';

export interface ExportReport {
  root: string | null;
  projects: number;
  files: number;
  skipped: string | null;
  /** 이번 판에 커밋했는가 — 바뀐 것이 없으면 false 다 */
  committed: boolean;
  /** 원격에 push 했는가 — 원격이 없거나 이미 같으면 false 다 */
  pushed: boolean;
  /** 원격에 NERV 가 만들지 않은 커밋이 있어 push 를 멈췄는가(REQ-CB-063) */
  diverged: boolean;
  /** 이번 판에 새로 낸 `mirror.diverged` 이벤트 수 — 같은 갈라짐은 다시 내지 않는다 */
  divergence_warnings: number;
}

/** 프로젝트 하나가 내보낸 것 — 커밋 메시지와 갈라짐 경고가 쓴다 */
interface ExportedProject {
  id: string;
  /** 미러 안의 폴더 — `<조직>/<프로젝트>`(`mirrorFolder`) */
  folder: string;
  approvals: { key: string; version: number; by: string | null }[];
}

/** 승인본 목록(`manifest.json`)의 모양 — EP-SPEC-14 와 같은 함수가 만든다 */
interface Manifest {
  specs?: Record<string, { version_no?: unknown } | undefined>;
}

/** 표 한 칸 — 탭 · 줄바꿈은 칸과 줄을 깨므로 빈칸으로 바꾼다 */
const tsvCell = (value: unknown): string => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
/** 커밋 메시지의 한 줄 — 사람이 쓴 이름에 든 줄바꿈이 메시지의 줄을 만들지 않게 한다 */
const oneLine = (value: string): string => value.replace(/[\r\n\t]+/g, ' ').trim();

@Injectable()
export class ExportJob {
  readonly name = 'export';
  private readonly logger = new Logger(ExportJob.name);

  constructor(
    private readonly specs: SpecService,
    private readonly baselines: BaselineService,
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  async run(): Promise<ExportReport> {
    const root = process.env['NERV_EXPORT_DIR'];
    // 경로가 없으면 **아무것도 하지 않는다.** 임의의 위치에 파일을 흩뿌리는 것이
    // 이 잡이 할 수 있는 최악이다 — 운영이 명시적으로 켠 경우에만 돈다.
    if (root === undefined || root === '') {
      return {
        root: null,
        projects: 0,
        files: 0,
        // eslint-disable-next-line no-restricted-syntax -- 운영자용 보고(REQ-CB-022)
        skipped: 'NERV_EXPORT_DIR 미설정',
        committed: false,
        pushed: false,
        diverged: false,
        divergence_warnings: 0,
      };
    }

    // 설정이 틀렸으면 아무것도 쓰기 전에 실패한다 — 잡 실패 줄이 원인을 말한다
    const config = mirrorGitConfig();
    await mkdir(root, { recursive: true });
    // 원격 시한은 하트비트 한 주기다 — 잡은 차례로 돌아서, 답하지 않는 원격이 리스 회수를 그만큼 늦춘다
    const git = new MirrorGit(root, config, HEARTBEAT_INTERVAL_SECONDS * 1000);
    await git.ensureRepo();

    const { rows: projects } = await this.db.execute<{
      id: string;
      slug: string;
      name: string;
      org_slug: string;
    }>(sql`
      SELECT p.id, p.slug, p.name, o.slug AS org_slug
        FROM project p
        JOIN organization o ON o.id = p.org_id
       WHERE p.archived_at IS NULL
       ORDER BY o.slug, p.slug, p.id
    `);

    const produced = new Set<string>();
    const exported: ExportedProject[] = [];
    const write = async (relative: string[], content: string): Promise<void> => {
      await writeFile(resolveInside(root, ...relative), content, 'utf8');
      produced.add(relative.join('/'));
    };

    for (const project of projects) {
      // **slug 와 키는 경로의 한 칸으로만 쓴다**(2026-09-28 · REQ-API-235). 둘 다 형식 검사가 없어서
      // `../` 가 든 값이 그대로 들어가면 이 폴더 밖에 파일이 써졌다
      const segments = mirrorSegments(project.org_slug, project.slug);
      // git 의 저장소 폴더와 같은 이름이면 쓰지 않는다 — 맨 위에 쓰면 미러가 아니라 저장소를 고치고, 안쪽이면 git 이
      // 그 경로를 받지 않아 커밋 전체가 실패한다
      if (segments.some((segment) => segment.toLowerCase() === '.git')) {
        this.logger.warn(
          `프로젝트 ${project.id} 의 조직 · 프로젝트 slug 가 git 저장소 폴더와 같아 미러에서 뺍니다`,
        );
        continue;
      }
      const folder = segments.join('/');
      await mkdir(resolveInside(root, ...segments, 'specs'), { recursive: true });

      await write(
        [...segments, 'llms.txt'],
        await this.specs.llmsTxt({ projectId: project.id, projectName: project.name }),
      );

      // **승인본 목록과 요구사항 표**(architecture §2.4(b) 의 트리). 둘 다 API 와 같은 함수다 — `manifest.json` 은
      // EP-SPEC-14, `requirements.tsv` 는 EP-REQ-01. 키 순서를 고정해 같은 상태면 같은 바이트다(커밋이 생기지 않는다)
      const manifest = await this.baselines.manifest({ projectId: project.id });
      const before = parseManifest(await git.showHead(`${folder}/manifest.json`));
      await write(
        [...segments, 'manifest.json'],
        `${JSON.stringify(sortedManifest(manifest), null, 2)}\n`,
      );
      await write([...segments, 'requirements.tsv'], await this.requirementsTsv(project.id));

      // 승인된 것만 내보낸다 — draft 를 파일로 떨어뜨리면 "승인 전 문서가 승인된 것처럼"
      // 읽히는 경로가 생긴다(문서 축 상태가 파일에서는 보이지 않기 때문이다).
      const nodes = await this.specs.tree({ projectId: project.id });
      for (const node of nodes) {
        if (node.doc_status !== 'approved') continue;
        const markdown = await this.specs.mirrorMarkdown({
          projectId: project.id,
          specKey: node.key,
        });
        await write([...segments, 'specs', `${safePathSegment(node.key)}.md`], markdown);
      }

      exported.push({
        id: project.id,
        folder,
        approvals: await this.approvalsSince(project.id, before, manifest as Manifest),
      });
    }

    // **사라진 파일도 미러의 변화다** — 보관한 문서 · 보관한 프로젝트의 파일은 지난 판이 커밋했지만 이번 판은 만들지 않았다.
    // git 이 추적하는 것만 지운다: 운영자가 폴더에 둔 남의 파일(추적하지 않는다)은 건드리지 않는다
    const removed: string[] = [];
    for (const path of await git.trackedFiles()) {
      if (produced.has(path)) continue;
      await unlink(resolveInside(root, ...path.split('/'))).catch(() => undefined);
      removed.push(path);
    }

    const committed = await git.commit([...produced, ...removed], commitMessage(exported));
    const outcome = await git.push();
    const warnings =
      outcome.kind === 'diverged' ? await this.warnDiverged(outcome, exported, config.branch) : 0;

    if (committed && outcome.kind === 'no_remote') {
      this.logger.log(
        // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
        '미러를 로컬에 커밋했습니다 — 원격(NERV_MIRROR_GIT_REMOTE)이 없어 push 하지 않습니다',
      );
    }
    if (outcome.kind === 'diverged') {
      this.logger.warn(
        `미러 원격에 NERV 가 만들지 않은 커밋 ${outcome.foreign_commits}개가 있어 push 를 멈췄습니다` +
          ` (원격 ${outcome.remote_head.slice(0, 12)} · 로컬 ${outcome.head.slice(0, 12)})`,
      );
    }
    this.logger.log(`md 미러 ${produced.size}개 파일 생성 (${projects.length}개 프로젝트)`);
    return {
      root,
      projects: projects.length,
      files: produced.size,
      skipped: null,
      committed,
      pushed: outcome.kind === 'pushed',
      diverged: outcome.kind === 'diverged',
      divergence_warnings: warnings,
    };
  }

  /** EP-REQ-01 과 같은 목록을 표로 — 고정 ID · 스펙 · 구현 상태 · 증적 수(architecture §2.4(b) 의 `requirements.tsv`) */
  private async requirementsTsv(projectId: string): Promise<string> {
    const rows = await this.specs.requirements({ projectId });
    const lines = rows.map((r) =>
      [r['ref'], r['spec_key'], r['impl_status'], r['evidence_count']].map(tsvCell).join('\t'),
    );
    return `${['ref', 'spec', 'impl_status', 'evidence_count'].join('\t')}\n${lines.map((l) => `${l}\n`).join('')}`;
  }

  /**
   * 지난 커밋 뒤에 새로 승인된 버전 — 커밋 메시지(`export(spec): <키>@v<n> approved by <이름>` · architecture §2.4(b))의
   * 재료다. 지난 커밋의 `manifest.json` 과 이번 것을 견준다: 새 키이거나 버전 번호가 바뀐 문서다.
   */
  private async approvalsSince(
    projectId: string,
    before: Manifest,
    after: Manifest,
  ): Promise<ExportedProject['approvals']> {
    const changed: { key: string; version: number }[] = [];
    for (const [key, entry] of Object.entries(after.specs ?? {})) {
      const version = Number(entry?.version_no);
      if (!Number.isInteger(version)) continue;
      if (Number(before.specs?.[key]?.version_no) === version) continue;
      changed.push({ key, version });
    }
    const out: ExportedProject['approvals'] = [];
    for (const { key, version } of changed.sort((a, b) => a.key.localeCompare(b.key))) {
      const { rows } = await this.db.execute<{ by: string | null }>(sql`
        SELECT u.display_name AS by
          FROM spec s
          JOIN spec_version sv ON sv.spec_id = s.id AND sv.version_no = ${version}
     LEFT JOIN "user" u ON u.id = sv.approved_by_user_id
         WHERE s.project_id = ${projectId} AND s.key = ${key}
      `);
      out.push({ key, version, by: rows[0]?.by ?? null });
    }
    return out;
  }

  /**
   * **미러 쪽 편집을 경고한다**(REQ-CB-063 · roadmap §7.4 규칙 1). 그 커밋이 바꾼 폴더의 프로젝트마다 `mirror.diverged` 를
   * 남기고, 카탈로그가 그 프로젝트의 admin 에게 중요 알림을 보낸다. 폴더는 경로의 앞 두 칸(`<조직>/<프로젝트>`)이다 — 앞 한
   * 칸만 보면 조직이 다른 같은 slug 를 가리지 못한다. 어느 프로젝트의 폴더도 아니면(저장소 맨 위나 조직 폴더 바로 아래의
   * 파일 · 공통 조상이 없는 이력) 내보낸 프로젝트 전부다 — push 가 멈추면 모두의 미러가 낡는다.
   *
   * **같은 갈라짐은 한 번만 알린다** — 그 프로젝트의 가장 나중 경고가 같은 원격 커밋을 가리키면 내지 않는다. 잡은 1시간마다
   * 돌고, 사람이 원격을 고치기 전까지 갈라짐은 그대로다. 원격 주소는 넣지 않는다(자격증명이 들어 있을 수 있다).
   */
  private async warnDiverged(
    outcome: Extract<PushOutcome, { kind: 'diverged' }>,
    exported: ExportedProject[],
    branch: string,
  ): Promise<number> {
    const touched = new Set((outcome.foreign_paths ?? []).map(projectFolderOf));
    const targets = exported.filter((p) => touched.has(p.folder));
    let warned = 0;
    for (const project of targets.length > 0 ? targets : exported) {
      const emitted = await this.events.transact(async (tx, emit) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mirror:diverged:${project.id}`}, 0))`,
        );
        const { rows } = await tx.execute<{ remote_head: string | null }>(sql`
          SELECT e.payload->>'remote_head' AS remote_head
            FROM event e
           WHERE e.subject_type = 'project' AND e.subject_id = ${project.id}
             AND e.type = ${NERV_EVENT_PHASE2.MIRROR_DIVERGED}
           ORDER BY e.occurred_at DESC
           LIMIT 1
        `);
        if (rows[0]?.remote_head === outcome.remote_head) return false;
        const paths = (outcome.foreign_paths ?? []).filter((path) =>
          path.startsWith(`${project.folder}/`),
        );
        await emit({
          type: NERV_EVENT_PHASE2.MIRROR_DIVERGED,
          projectId: project.id,
          subjectType: 'project',
          subjectId: project.id,
          actorUserId: null,
          isAgent: false,
          payload: {
            branch,
            remote_head: outcome.remote_head,
            local_head: outcome.head,
            last_pushed: outcome.last_pushed,
            foreign_commits: outcome.foreign_commits,
            // 이 프로젝트 폴더에서 바뀐 파일 수 — 경로 자체는 넣지 않는다(문서 키가 곧 경로다)
            changed_files: paths.length,
          },
        });
        return true;
      });
      if (emitted) warned += 1;
    }
    return warned;
  }
}

/**
 * 프로젝트 폴더의 두 칸 — `<조직 slug>/<프로젝트 slug>`. 프로젝트 slug 는 조직 안에서만 유일해서 조직 칸이 없으면 두 조직의
 * 같은 slug 가 한 폴더에 쓴다(REQ-CB-062). 두 칸 모두 `safePathSegment` 를 거친다. 그 인코딩은 서로 다른 이름을 서로 다른
 * 칸으로 바꾸고(`%` 도 `%25` 로 적는다) 조직 slug 는 전역에서 유일하므로, 서로 다른 프로젝트가 같은 폴더를 받지 않는다.
 */
export function mirrorSegments(orgSlug: string, projectSlug: string): [string, string] {
  return [safePathSegment(orgSlug), safePathSegment(projectSlug)];
}

/**
 * 미러 안의 파일 경로 → 그 파일이 든 프로젝트 폴더(`<조직>/<프로젝트>`). 프로젝트 폴더 **안**의 파일만 셈한다 — 저장소 맨 위나
 * 조직 폴더 바로 아래의 파일은 어느 프로젝트의 것도 아니라 null 이다.
 */
export function projectFolderOf(path: string): string | null {
  const [org, project, ...rest] = path.split('/');
  if (org === undefined || project === undefined || rest.length === 0) return null;
  return `${org}/${project}`;
}

function parseManifest(text: string | null): Manifest {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Manifest) : {};
  } catch {
    return {};
  }
}

/** 키 순서를 고정한다 — 같은 상태면 같은 바이트여야 커밋이 생기지 않는다 */
function sortedManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const specs = manifest['specs'];
  if (specs === null || typeof specs !== 'object') return manifest;
  const entries = Object.entries(specs as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return { ...manifest, specs: Object.fromEntries(entries) };
}

/**
 * 커밋 메시지 — 설계의 모양(`export(spec): <키>@v<n> approved by <이름>` · architecture §2.4(b))이다. 승인이 여럿이면 첫째를
 * 제목에 쓰고 수를 붙이며 본문에 모두 적는다. 승인 없이 바뀐 판(구현 상태 · 보관 · 제목)은 `export(spec): refresh` 다.
 */
export function commitMessage(projects: readonly ExportedProject[]): string {
  const lines = projects
    .flatMap((p) => p.approvals)
    .map(({ key, version, by }) =>
      oneLine(`${key}@v${version} approved${by === null ? '' : ` by ${by}`}`),
    );
  if (lines.length === 0) return 'export(spec): refresh\n';
  const [first, ...rest] = lines;
  const subject = `export(spec): ${first ?? ''}${rest.length > 0 ? ` (+${rest.length})` : ''}`;
  return rest.length === 0 ? `${subject}\n` : `${subject}\n\n${lines.join('\n')}\n`;
}
