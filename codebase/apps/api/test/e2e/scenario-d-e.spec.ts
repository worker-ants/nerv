// L3 시나리오 D·E — 기획자 웹↔터미널 왕복 · 임포터 전수 (backlog.md §5.4~§5.5)
//
// D 의 요점은 **한 사람이 두 표면을 오간다**는 것이다. 리스 인계가 매끄럽지 않으면 사람은
// 둘 중 하나를 포기하게 되고(대개 웹), 그러면 D-09("스펙은 DB, md 는 표현")가 무의미해진다.
// 판정은 두 개의 0 이다: `NERV_DRAFT_LEASED` 0건 · `base_version` 충돌 0건.
//
// E 는 임포터의 **전수 계정**이다. 자동 변환율보다 중요한 것이 "실패를 전건 목록화"와
// "두 번째 실행의 신규 레코드 0"이다 — 조용히 사라지는 항목이 있으면 임포트는 신뢰를 잃는다.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NERV_EVENT } from '@nerv/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, countEvents, stackAvailable, startStack } from './harness.js';
import type { E2EStack } from './harness.js';

const AVAILABLE = stackAvailable();
let stack: E2EStack;
let jiminToken: string;

beforeAll(async () => {
  if (!AVAILABLE) return;
  stack = await startStack('nerv_e2e_de');
  jiminToken = await stack.tokenFor('jimin', [
    'spec:read',
    'spec:draft',
    'agent-session:launch',
    'import:write',
  ]);
});

afterAll(async () => {
  if (AVAILABLE) await stack.close();
});

describe.skipIf(!AVAILABLE)('시나리오 D — 기획자 웹↔터미널 왕복 (성공 기준 1-11)', () => {
  it('1~3단계 — 웹 편집 → 터미널 이어쓰기(리스 자동 인계) → 웹 복귀', async () => {
    const { SpecService } = await import('../../src/modules/spec/spec.service.js');
    const specs = stack.app.get(SpecService);
    const jimin = stack.users['jimin'] ?? '';

    // 1단계 — 웹 에디터에서 초안 편집(리스 획득)
    const draft = await specs.draftUpsert({
      roles: ['planner'],
      projectId: stack.projectId,
      key: 'SPC-CWC-007',
      title: '웹챗 위젯 임베드',
      type: 'feature',
      bodyMd:
        '# 웹챗 위젯 임베드\n\nREQ-CWC-031 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다',
      userId: jimin,
    });
    const specId = draft['spec_id'] as string;
    expect(draft['web_url']).toBe('/p/clemvion/specs/SPC-CWC-007');

    const { rows: leased } = await stack.pool.query<{ holder: string }>(
      `SELECT edit_lease_user_id AS holder FROM spec_version WHERE id = $1`,
      [draft['spec_version_id']],
    );
    expect(leased[0]?.holder).toBe(jimin); // 리스 보유자 표시

    // 2단계 — **같은 사용자**가 터미널에서 이어쓴다. 자동 인계여야 한다
    const session = await callTool(stack, jiminToken, 'nerv_bootstrap', {
      project: stack.projectSlug,
      agent_type: 'claude-code',
      hostname: 'mac-07',
      cwd: '/work/clemvion',
    });
    const sessionId = String(session.result['session_id']);

    const terminal = await callTool(stack, jiminToken, 'nerv_spec_draft_upsert', {
      spec_id: specId,
      body_md:
        '# 웹챗 위젯 임베드\n\nREQ-CWC-031 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다\n\n## 보안\n토큰으로 검증한다',
      base_version: draft['spec_version_id'],
      idempotency_key: `d-terminal-${specId}`,
      session_id: sessionId,
    });
    expect(terminal.error).toBeNull();

    // 3단계 — 사전 검토 후 웹으로 복귀해 마무리
    const check = await callTool(stack, jiminToken, 'nerv_spec_check', {
      spec_version_id: draft['spec_version_id'],
    });
    expect(check.error).toBeNull();

    await specs.draftUpsert({
      roles: ['planner'],
      projectId: stack.projectId,
      specId,
      bodyMd:
        '# 웹챗 위젯 임베드\n\nREQ-CWC-031 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다\n\n## 보안\n토큰으로 검증한다\n\n## 마무리\n웹에서 이어서 쓴다',
      baseVersionId: draft['spec_version_id'] as string,
      userId: jimin,
    });

    // 판정 — 두 개의 0
    const { rows: errors } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type LIKE '%lease%'`,
    );
    expect(errors[0]?.n).toBe(0); // NERV_DRAFT_LEASED 로 막힌 적이 없다
  });

  it('4단계 — 제출 → 코멘트 → 해소 → 승인이 전부 플랫폼 안에서 끝난다 (성공 기준 1-1)', async () => {
    const { SpecService } = await import('../../src/modules/spec/spec.service.js');
    const { SpecCommentService } = await import('../../src/modules/spec/spec-comment.service.js');
    const specs = stack.app.get(SpecService);
    const comments = stack.app.get(SpecCommentService);
    const jimin = stack.users['jimin'] ?? '';
    const reviewer = stack.users['reviewer'] ?? '';

    const { rows } = await stack.pool.query<{ id: string; spec_id: string }>(
      `SELECT id, spec_id FROM spec_version WHERE status = 'draft' ORDER BY created_at DESC LIMIT 1`,
    );
    const versionId = rows[0]!.id;

    // 검토자가 앵커를 지목해 코멘트한다 — 위치 없는 지적은 고칠 수 없다(D-09)
    const comment = await comments.add({
      projectId: stack.projectId,
      specVersionId: versionId,
      anchor: 'REQ-CWC-031',
      bodyMd: '복원 범위를 명시해주세요',
      userId: reviewer,
    });
    expect(comment.open_count).toBe(1);

    // 작성자가 반영하고 해소 — 남은 open 수가 답이다
    const resolved = await comments.resolve({
      projectId: stack.projectId,
      commentId: comment.comment_id,
      resolutionNote: '최근 24시간으로 한정',
      userId: jimin,
    });
    expect(resolved.open_count).toBe(0);

    const submitted = await specs.submitReview({
      projectId: stack.projectId,
      specVersionId: versionId,
      userId: jimin,
    });

    if (submitted.status === 'in_review') {
      // T2·T3 — 사람 승인. **지시자≠승인자**라 다른 사람이 눌러야 한다
      await specs.approve({
        projectId: stack.projectId,
        specVersionId: versionId,
        approverUserId: reviewer,
      });
    }

    const { rows: approved } = await stack.pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(approved[0]?.status).toBe('approved');
    expect(await countEvents(stack, NERV_EVENT.SPEC_APPROVED, versionId)).toBe(1);
    expect(await countEvents(stack, NERV_EVENT.COMMENT_RESOLVED)).toBeGreaterThan(0);
  });
});

describe.skipIf(!AVAILABLE)('시나리오 E — 임포터 전수 (성공 기준 0-6·0-7)', () => {
  const cliDir = join(import.meta.dirname, '../../../cli');
  let fixtureRoot: string;
  let reportDir: string;

  beforeAll(() => {
    if (!AVAILABLE) return;
    // clemvion 체크아웃은 이 환경에 없다 — **프로파일 규칙**을 같은 형태의 픽스처로 검증한다.
    // 135건 실측은 원본이 있는 장비에서 같은 명령으로 재현한다(REQ-IMP-016 의 기대 집계가 그 장치다).
    fixtureRoot = mkdtempSync(join(tmpdir(), 'nerv-import-'));
    mkdirSync(join(fixtureRoot, 'spec/widget'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'spec/widget/embed.md'),
      `---\nid: SPC-CWC-007\nstatus: implemented\n---\n# 웹챗 위젯 임베드\n\nREQ-CWC-031 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다\n`,
    );
    writeFileSync(
      join(fixtureRoot, 'spec/widget/session.md'),
      `---\nid: SPC-CWC-012\nstatus: partial\n---\n# 세션 복원 API\n\nREQ-CWC-040 WHEN 세션이 만료되면 THE SYSTEM SHALL 재인증을 요구한다\n`,
    );
    // 매핑에 없는 status — 기본값으로 넘기지 않고 실패로 목록화돼야 한다
    writeFileSync(
      join(fixtureRoot, 'spec/widget/broken.md'),
      `---\nid: SPC-CWC-099\nstatus: 알수없음\n---\n# 알 수 없는 상태\n`,
    );
    reportDir = mkdtempSync(join(tmpdir(), 'nerv-report-'));
  });

  /**
   * CLI 를 **자식 프로세스로** 실행한다 — 사람이 치는 명령과 같은 경로여야 L3 이다.
   *
   * 반드시 **비동기**여야 한다: 이 테스트 안에서는 API 서버가 같은 프로세스에 떠 있어서,
   * execFileSync 로 자식을 기다리면 이벤트 루프가 막혀 서버가 요청에 답하지 못한다 —
   * CLI 와 API 가 서로를 기다리는 교착이 된다(실측: 60초 타임아웃까지 매달렸다).
   * `pnpm exec` 대신 tsx 바이너리를 직접 부르는 것도 같은 이유(출력 파이프 지연)다.
   *
   * **로케일을 못박는다.** CLI 는 `NERV_LANG`/`LANG` 으로 출력 언어를 정하는데(importer.md
   * §3.5a), 그대로 두면 이 검사가 실행 기계의 LANG 을 따라간다 — 개발자 기계에서 통과하고
   * CI 에서 깨지거나 그 반대가 된다. 이 시나리오는 한국어 출력을 검사한다.
   */
  async function runCli(args: string[], env: Record<string, string> = {}): Promise<string> {
    const tsx = join(import.meta.dirname, '../../../../node_modules/.bin/tsx');
    try {
      const { stdout } = await promisify(execFile)(tsx, ['src/index.ts', ...args], {
        cwd: cliDir,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, NERV_LANG: 'ko', ...env },
      });
      return stdout;
    } catch (error) {
      // dry-run 은 실패 항목이 있으면 비영 종료한다 — 출력은 그대로 판정에 쓴다.
      // stderr 도 합쳐 돌려준다: 조용히 빈 문자열을 주면 실패 원인이 사라진다.
      const failure = error as { stdout?: string; stderr?: string };
      return `${String(failure.stdout ?? '')}\n${String(failure.stderr ?? '')}`;
    }
  }

  it('0단계 — --server 없이 dry-run 이 완주한다 (REQ-IMP-011)', async () => {
    const out = await runCli([
      'spec',
      '--root',
      fixtureRoot,
      '--project',
      'clemvion',
      '--profile-file',
      writeProfile(fixtureRoot),
      '--report-dir',
      reportDir,
    ]);
    expect(out).toContain('dry-run 완료');

    const report = readFileSync(join(reportDir, 'report.md'), 'utf8');
    // 실패 전건 목록화 — **파일과 사유**가 함께 있어야 한다(§4.1). 실패를 세기만 하는
    // 리포트는 "무엇을 고쳐야 하는지"에 답하지 못한다
    expect(report).toContain('spec/widget/broken.md');
    expect(report).toContain('status_map 에 없는 값');
  });

  it('2·3단계 — --apply 로 적재하면 원문이 보존된다 (정보 손실 0)', async () => {
    const token = jiminToken;
    await runCli([
      'spec',
      '--root',
      fixtureRoot,
      '--project',
      'clemvion',
      '--profile-file',
      writeProfile(fixtureRoot),
      '--report-dir',
      reportDir,
      '--server',
      stack.baseUrl,
      '--token',
      token,
      '--apply',
    ]);

    const { rows } = await stack.pool.query<{ key: string; body_md: string }>(
      `SELECT s.key, sv.body_md FROM spec s JOIN spec_version sv ON sv.id = s.current_version_id
        WHERE s.project_id = $1 ORDER BY s.key`,
      [stack.projectId],
    );
    const imported = rows.filter((r) => r.key.startsWith('SPC-CWC'));
    expect(imported.length).toBeGreaterThanOrEqual(2);
    // 원문 보존 — 헤딩과 요구사항 문장이 그대로 있다
    expect(imported.map((r) => r.body_md).join()).toContain('REQ-CWC-031');
    expect(await countEvents(stack, NERV_EVENT.IMPORT_APPLIED)).toBeGreaterThan(0);
  });

  it('4단계 — 2회 연속 실행의 신규 레코드가 0이다 (성공 기준 0-7)', async () => {
    const before = await countSpecs();
    await runCli([
      'spec',
      '--root',
      fixtureRoot,
      '--project',
      'clemvion',
      '--profile-file',
      writeProfile(fixtureRoot),
      '--report-dir',
      reportDir,
      '--server',
      stack.baseUrl,
      '--token',
      jiminToken,
      '--apply',
    ]);
    expect(await countSpecs()).toBe(before);
  });

  it('6단계 — import:write 없는 PAT 는 403 이고 레코드를 만들지 않는다 (REQ-API-017)', async () => {
    const weak = await stack.tokenFor('hana', ['spec:read']);
    const before = await countSpecs();
    const res = await fetch(`${stack.baseUrl}/api/v1/projects/clemvion/import/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${weak}` },
      body: JSON.stringify({ profile: 'clemvion', kind: 'structure', items: [] }),
    });
    expect(res.status).toBe(403);
    expect(await countSpecs()).toBe(before);
  });

  async function countSpecs(): Promise<number> {
    const { rows } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spec WHERE project_id = $1`,
      [stack.projectId],
    );
    return rows[0]?.n ?? 0;
  }

  /** 픽스처용 프로파일 — 기대 집계는 픽스처 크기에 맞춘다(원본 실측치는 clemvion 프로파일에 있다). */
  function writeProfile(root: string): string {
    const path = join(root, 'profile.json');
    writeFileSync(
      path,
      JSON.stringify({
        profile: 'e2e-fixture',
        version: 1,
        scan: { spec: ['spec/**/*.md'], plan: [], exclude: [] },
        tree: { area_from_directory: true, leaf_type: 'feature', overrides: {} },
        frontmatter: {
          id: 'spec.key',
          status_map: {
            implemented: { doc: 'approved', impl: 'implemented' },
            partial: { doc: 'approved', impl: 'in_progress' },
          },
        },
        requirement: { id_pattern: '[A-Z]+-[A-Z]+-\\d+' },
        task: { status_map: {}, unstarted_sentinel: '(unstarted)' },
      }),
      'utf8',
    );
    return path;
  }
});
