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
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  // **`stack` 이 없을 수도 있다.** 기동이 실패하면 이 훅이 `undefined.close()` 로 다시
  // 터져서, 원인 하나가 실패 둘로 보고된다 — 진짜 이유가 두 번째 오류에 묻힌다.
  if (stack !== undefined) await stack.close();
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
    // **끝을 본다.** `web_url` 은 `NERV_PUBLIC_URL` 이 있으면 절대 주소, 없으면 경로다
    // (§1.4g 의 딥링크 — 에이전트는 눌러서 열 수 있어야 한다). 경로 하나로 못박으면
    // 그 변수를 가진 기계에서만 깨지는 검사가 된다.
    expect(String(draft['web_url'])).toMatch(/\/p\/clemvion\/specs\/SPC-CWC-007$/);

    const { rows: leased } = await stack.pool.query<{ holder: string }>(
      `SELECT edit_lease_user_id AS holder FROM spec_version WHERE id = $1`,
      [draft['spec_version_id']],
    );
    expect(leased[0]?.holder).toBe(jimin); // 리스 보유자 표시

    // 2단계 — 같은 사용자가 터미널에서 이어쓴다.
    //
    // **명시 인계다**(2026-08-30 사람 결정 · api.md §1.4h). 예전 리스는 사용자 단위라
    // "같은 사용자면 자동 인계" 였는데, 실제 배치는 PAT 하나 = 사용자 하나 = 세션 여럿이라
    // 병렬 에이전트들이 서로를 전혀 막지 못했다 — 리스는 있는데 아무것도 잠그지 않았다.
    // 보유자를 `(user, session)` 으로 좁힌 뒤로, 세션 없는 웹 탭이 쥔 리스를 터미널 세션이
    // 이어받는 것도 인계다. 서버는 거절하면서 응답에 `takeover: true` 로 길을 알려 준다.
    //
    // 사람이 겪는 왕복은 그대로다: 한 번의 호출로 이어 쓴다. 다른 것은 그 호출이
    // **인계를 말한다**는 사실이고, 그 사실이 이벤트에 남는다.
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
      // 계보가 아니라 **지문**이다(§1.4i — `base_version` 은 2026-08-30 에 표면에서 걷었다)
      base_hash: draft['content_hash'] as string,
      takeover: true,
      idempotency_key: `d-terminal-${specId}`,
      session_id: sessionId,
    });
    expect(terminal.error).toBeNull();

    // 인계는 기록된다 — 뺏은 사실이 남지 않으면 "누가 내 초안을 밀었나"에 답할 수 없다
    const { rows: handover } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event
        WHERE type = $1 AND payload->>'takeover' = 'true'`,
      [NERV_EVENT.SPEC_DRAFT_UPDATED],
    );
    expect(handover[0]?.n).toBe(1);

    // 3단계 — 사전 검토 후 웹으로 복귀해 마무리
    const check = await callTool(stack, jiminToken, 'nerv_spec_check', {
      spec_version_id: draft['spec_version_id'],
    });
    expect(check.error).toBeNull();

    // 돌아오는 길도 인계다 — 이제 리스는 터미널 세션이 쥐고 있다. 화면에서는 편집기 위의
    // "이어받기" 버튼(`data-testid="lease-takeover"`)이 이 인자를 싣는다. 사람이 겪는 것은
    // 배너 한 줄과 클릭 한 번이고, 막히지 않는다는 것이 이 시나리오의 판정이다.
    const { rows: current } = await stack.pool.query<{ h: string }>(
      `SELECT encode(v.content_hash, 'hex') AS h FROM spec_version v
        WHERE v.spec_id = $1 ORDER BY v.version_no DESC LIMIT 1`,
      [specId],
    );
    await specs.draftUpsert({
      roles: ['planner'],
      projectId: stack.projectId,
      specId,
      bodyMd:
        '# 웹챗 위젯 임베드\n\nREQ-CWC-031 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다\n\n## 보안\n토큰으로 검증한다\n\n## 마무리\n웹에서 이어서 쓴다',
      // 터미널이 저장한 뒤라 지문이 바뀌었다 — 다시 읽고 그 위에 얹는다(§1.4g)
      baseHash: current[0]?.h ?? '',
      takeover: true,
      userId: jimin,
    });

    // 판정 — **사람이 막힌 적이 없다.** 인계는 한 번의 호출로 끝났고(위 `takeover`),
    // 리스 때문에 왕복이 늘거나 편집이 버려진 자리는 없다. 리스 관련 이벤트가 따로
    // 쌓이지 않는다는 것이 그 증거다.
    const { rows: errors } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type LIKE '%lease%'`,
    );
    expect(errors[0]?.n).toBe(0);
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
      // T2·T3 — 사람 승인. **지시자≠승인자**라 다른 사람이 눌러야 하고, 문은 결재 카드
      // 하나다(2026-09-07 · `SpecService.approve` 는 두 번째 구현이라 지웠다).
      const { ApprovalService } = await import('../../src/modules/approval/approval.service.js');
      const approvals = stack.app.get(ApprovalService);
      for (;;) {
        const { rows: slots } = await stack.pool.query<{ id: string }>(
          `SELECT id FROM approval WHERE subject_id = $1 AND decision IS NULL
            ORDER BY assignee_role NULLS FIRST LIMIT 1`,
          [versionId],
        );
        const card = slots[0];
        if (card === undefined) break;
        await approvals.decide({
          actor: { userId: reviewer, isAgent: false },
          projectId: stack.projectId,
          approvalId: card.id,
          userId: reviewer,
          decision: 'approve',
        });
      }
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
  let mapPath: string;

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
    mapPath = join(mkdtempSync(join(tmpdir(), 'nerv-map-')), 'nerv-import.map.json');
  });

  /**
   * CLI 를 **자식 프로세스로** 실행한다 — 사람이 치는 명령과 같은 경로여야 L3 이다.
   *
   * 반드시 **비동기**여야 한다: 이 테스트 안에서는 API 서버가 같은 프로세스에 떠 있어서,
   * execFileSync 로 자식을 기다리면 이벤트 루프가 막혀 서버가 요청에 답하지 못한다 —
   * CLI 와 API 가 서로를 기다리는 교착이 된다(실측: 60초 타임아웃까지 매달렸다).
   * `pnpm exec` 를 거치지 않고 바이너리를 직접 부르는 것도 같은 이유(출력 파이프 지연)다.
   *
   * **빌드 산출물을 부른다**(2026-09-02 정정). 예전에는 `node_modules/.bin/tsx` 로 소스를
   * 실행했는데 `tsx` 는 vite 의 peer 로 딸려 온 **선언되지 않은 전이 의존**이라, 로컬에는
   * 우연히 링크돼 있고 CI(`--frozen-lockfile`)에는 없었다. execFile 이 ENOENT 로 죽으면
   * stdout·stderr 이 둘 다 비어서 이 함수는 빈 문자열을 돌려줬고, 검사는 "출력에 그 말이
   * 없다"로 실패했다 — **CLI 가 실행조차 되지 않았다는 사실이 그 메시지에 없었다.**
   * 그 뒤 `--apply` 검사까지 연쇄로 무너졌다(적재가 0건이니 스펙 수가 모자랐다).
   *
   * `dist/index.js` 는 `package.json` 의 `bin` 이 가리키는 **실제 배포 산출물**이고,
   * CI 는 e2e 앞에 `pnpm build` 를 돈다. 사람이 치는 `nerv` 와 같은 것을 부르게 됐다.
   *
   * **로케일을 못박는다.** CLI 는 `NERV_LANG`/`LANG` 으로 출력 언어를 정하는데(importer.md
   * §3.5a), 그대로 두면 이 검사가 실행 기계의 LANG 을 따라간다 — 개발자 기계에서 통과하고
   * CI 에서 깨지거나 그 반대가 된다. 이 시나리오는 한국어 출력을 검사한다.
   */
  async function runCli(args: string[], env: Record<string, string> = {}): Promise<string> {
    const entry = join(cliDir, 'dist/index.js');
    if (!existsSync(entry)) {
      // 없는 이유를 여기서 말한다 — 빈 출력으로 흘려보내면 검사는 "그 말이 없다"로
      // 실패하고, 진짜 원인(빌드 안 함)은 어디에도 남지 않는다.
      throw new Error(`CLI 산출물이 없습니다: ${entry} — 먼저 \`pnpm build\` 를 도세요.`);
    }
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [entry, ...args], {
        cwd: cliDir,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, NERV_LANG: 'ko', ...env },
      });
      return stdout;
    } catch (error) {
      // dry-run 은 실패 항목이 있으면 비영 종료한다 — 출력은 그대로 판정에 쓴다.
      // stderr 도 합쳐 돌려준다: 조용히 빈 문자열을 주면 실패 원인이 사라진다.
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      const out = `${String(failure.stdout ?? '')}\n${String(failure.stderr ?? '')}`;
      // **둘 다 비면 프로세스가 뜨지도 못한 것이다**(ENOENT·권한 등). 그 사실을 삼키면
      // "출력에 그 말이 없다"라는 엉뚱한 실패로 보고된다.
      return out.trim() === '' ? `CLI 실행 실패: ${String(failure.message ?? error)}` : out;
    }
  }

  it('0단계 — --server 없이 dry-run 이 완주한다 (REQ-IMP-011)', async () => {
    const out = await runCli([
      // **`import` 을 생략하지 않는다** — 정본(4.7 §3.1)·백로그·CLI 자신의 usage 문구가
      // 말하는 형태가 이것이고, 2026-09-06 에 파서가 그 낱말을 알게 됐다. 이 검사가
      // 옛 형태를 부르고 있어서 **L3 만 빨갛게 됐다**: PR 레인에서 e2e 는 skip 이라
      // preflight 도 PR 도 초록이었고, main 머지 커밋에서야 드러났다.
      'import',
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

  /** `--apply` 한 벌 — 매니페스트 경로까지 같은 것을 쓴다(§3.3) */
  function applyArgs(): string[] {
    return [
      'import',
      'spec',
      '--root',
      fixtureRoot,
      '--project',
      'clemvion',
      '--profile-file',
      writeProfile(fixtureRoot),
      '--report-dir',
      reportDir,
      '--map',
      mapPath,
      '--server',
      stack.baseUrl,
      '--token',
      jiminToken,
      '--apply',
    ];
  }

  it('2단계 — **남의 데이터 위에 적재하지 않는다**(map-conflict · §3.3)', async () => {
    // 시나리오 D 가 `SPC-CWC-007` 을 **사람 손으로** 만들었고(에디터 경로), 픽스처가 같은
    // 키를 쓴다. 매니페스트가 없으면 임포터는 그것이 자기가 넣은 것인지 알 수 없다 —
    // 그때 덮어쓰는 것이 이 게이트가 막는 바로 그 일이다.
    // `runCli` 는 비영 종료를 **던지지 않고 출력으로 돌려준다**(위 헬퍼) — 중단도 출력에 남는다
    await runCli(applyArgs());

    const report = readFileSync(join(reportDir, 'report.md'), 'utf8');
    expect(report).toContain('map-conflict');
    // 중단이므로 **아무것도 들어가지 않았다** — 절반을 덮어쓰고 멈추는 것이 더 나쁘다
    expect(await countEvents(stack, NERV_EVENT.IMPORT_APPLIED)).toBe(0);
  });

  it('3단계 — rebuild-map 이 되돌려 준다. 그다음 적재는 원문을 보존한다 (정보 손실 0)', async () => {
    // 문서가 안내하는 복구 경로 그대로다: 매니페스트를 서버에서 되짓고(EP-IMP-05) 다시 민다.
    await runCli([
      'import',
      'rebuild-map',
      '--root',
      fixtureRoot,
      '--project',
      'clemvion',
      '--profile-file',
      writeProfile(fixtureRoot),
      '--report-dir',
      reportDir,
      '--map',
      mapPath,
      '--server',
      stack.baseUrl,
      '--token',
      jiminToken,
    ]);
    // **되짓기는 적재가 아니다** — 이 명령이 임포트를 수행하던 것이 2026-09-06 의 결함이다
    expect(await countEvents(stack, NERV_EVENT.IMPORT_APPLIED)).toBe(0);
    expect(JSON.parse(readFileSync(mapPath, 'utf8'))['items'].length).toBeGreaterThan(0);

    await runCli(applyArgs());

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
    // **같은 매니페스트로 다시 민다** — 3단계가 남긴 것이라 이번에는 map-conflict 가 없다.
    // 그것이 §3.3 이 말하는 "매니페스트는 캐시" 의 뜻이다: 있으면 재실행이 조용히 지나간다.
    await runCli(applyArgs());
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
