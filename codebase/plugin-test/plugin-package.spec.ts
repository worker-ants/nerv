// E12 — 플러그인 패키지가 문서 전문과 같은지 대조한다 (REQ-PLG-001·003·006·008)
//
// **문서가 정본이고 이 디렉터리는 그 실물이다.** 두 쪽이 갈라지면 사람은 문서를 읽고
// 에이전트는 파일을 읽으므로, 같은 규약을 서로 다르게 아는 상태가 된다 — 그것이
// clemvion 에서 "규약이 있는데 아무도 같은 규약을 모르는" 상태의 시작이었다.
//
// 그래서 이 테스트는 파일 존재만 보지 않고 **문서에서 다시 추출해 바이트 비교**한다.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 테스트는 플러그인 폴더 밖에 둔다 — 그 폴더는 설치하면 그대로 복사된다(2026-10-16 · 4.6 §5.4 · REQ-PLG-037)
const here = join(dirname(fileURLToPath(import.meta.url)), '../plugin');
const repoRoot = join(here, '../..');
const doc = readFileSync(join(repoRoot, 'docs/04-mvp/plugin.md'), 'utf8');
const lines = doc.split('\n');

/** 문서의 fenced block 을 뽑는다 — 스킬은 ````, JSON·bash 는 ``` 이다. */
function fenceAfter(marker: string, fence: string): string {
  const start = lines.findIndex((line) => line.includes(marker));
  if (start === -1) throw new Error(`문서에서 찾지 못함: ${marker}`);
  let i = start;
  while (!lines[i]!.startsWith(fence)) i += 1;
  const open = i;
  i += 1;
  while (lines[i]!.trim() !== fence) i += 1;
  return lines
    .slice(open + 1, i)
    .join('\n')
    .trimEnd();
}

function file(path: string): string {
  return readFileSync(join(here, path), 'utf8').trimEnd();
}

/** http 변형의 `type:"http"` 훅을 이벤트와 함께 편다 */
function httpHooks(): { event: string; hook: Record<string, unknown> }[] {
  const parsed = JSON.parse(file('hooks/hooks.http.json')) as {
    hooks: Record<string, { hooks: Record<string, unknown>[] }[]>;
  };
  return Object.entries(parsed.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      group.hooks.filter((hook) => hook['type'] === 'http').map((hook) => ({ event, hook })),
    ),
  );
}

// `review` 는 P2 스킬이고 2026-08-23 에 패키지에 들어왔다(4.6 §2.6).
// **MVP 약속은 여전히 5종**이다 — 6번째는 Phase 2 가 위에 얹힌 것이다.
// `import` 는 2026-09-06 에 걷었다 — 플러그인이 배달하지 않는 CLI(`@nerv/cli` 는 private)를
// 부르는 스킬이라 설치한 쪽에서는 첫 Bash 호출이 해석되지 않았다. 근거와 선택지는 4.6 §2.5.
// `mirror` 는 2026-10-07 에 들어왔다(4.6 §2.7). MCP 도구 대신 플러그인이 배달하는 스크립트(`bin/nerv-mirror`)를
// 부른다 — `import` 와 달리 부르는 것이 패키지 안에 있다.
// `approve` 는 2026-10-11 에 들어왔다(4.6 §2.8 · 사람 결정). 사람이 세션에서 대답한 승인을 전한다 — 그 도구는
// A3 라 이 스킬의 `allowed-tools` 에도 없다.
const SKILLS = ['next', 'spec', 'impl', 'question', 'review', 'mirror', 'approve'] as const;

/** A3 도구 — 호출마다 사람이 허용한다. 어느 스킬의 `allowed-tools` 에도 넣지 않는다(4.6 §2.0) */
const A3_TOOLS = ['nerv_spec_submit_review', 'nerv_spec_approve'] as const;

describe('REQ-PLG-001 — 배치된 파일이 문서 §2~§3 전문과 같다', () => {
  it.each(SKILLS)('skills/%s/SKILL.md', (skill) => {
    expect(file(`skills/${skill}/SKILL.md`)).toBe(
      fenceAfter(`\`skills/${skill}/SKILL.md\``, '````'),
    );
  });

  it('hooks/hooks.json', () => {
    expect(file('hooks/hooks.json')).toBe(fenceAfter('### 3.1 `hooks/hooks.json` 전문', '```'));
  });

  /**
   * **플러그인은 `.mcp.json` 을 담지 않는다**(REQ-PLG-001 개정 2026-09-04).
   *
   * 담고 있던 동안 그 파일은 어느 프로젝트에서도 붙을 수 없었다: 플러그인이 제공한
   * `.mcp.json` 은 그 프로젝트의 `settings.local.json` `env` 를 읽지 못해
   * `${NERV_SERVER:-…}` 가 언제나 기본값으로 떨어졌고(실측), 세션마다 `nerv.example.com`
   * 연결 실패가 하나씩 남았다. 서버 주소·토큰은 프로젝트별 값이라 여러 프로젝트가
   * 공유하는 물건에 담길 수 없다 — 4.6 §3.3 템플릿을 쓰는 쪽 저장소가 자기 루트에 둔다.
   */
  it('.mcp.json 을 담지 않는다 — 서버 주소·토큰은 프로젝트별 값이다', () => {
    expect(existsSync(join(here, '.mcp.json'))).toBe(false);
  });

  it('hooks/hooks.http.json', () => {
    expect(file('hooks/hooks.http.json')).toBe(fenceAfter('`hooks/hooks.http.json` 전문', '```'));
  });

  it('.claude-plugin/plugin.json', () => {
    expect(file('.claude-plugin/plugin.json')).toBe(
      fenceAfter('`.claude-plugin/plugin.json` 전문', '```'),
    );
  });

  it('statusline/nerv-statusline.sh', () => {
    expect(file('statusline/nerv-statusline.sh')).toBe(
      fenceAfter('`statusline/nerv-statusline.sh` 전문', '```'),
    );
  });

  it('bin/nerv-env.sh', () => {
    expect(file('bin/nerv-env.sh')).toBe(fenceAfter('`bin/nerv-env.sh` 전문', '```'));
  });
});

describe('REQ-PLG-003 — A3 도구는 어느 스킬의 allowed-tools 에도 없다', () => {
  it.each(A3_TOOLS)('%s 는 목록에 없다 — 사람이 그 자리에서 허용한다', (tool) => {
    for (const skill of SKILLS) {
      const content = file(`skills/${skill}/SKILL.md`);
      const frontmatter = content.split('---')[1] ?? '';
      expect(frontmatter, `${skill} 스킬의 머리말에 ${tool} 이 있다`).not.toContain(tool);
    }
  });

  it('결재 카드를 내리는 도구는 없다 — 그 권한(approval:decide)은 사람 전용이다', () => {
    for (const skill of SKILLS) {
      const frontmatter = file(`skills/${skill}/SKILL.md`).split('---')[1] ?? '';
      expect(frontmatter).not.toContain('nerv_approval_decide');
    }
  });
});

/**
 * **세션에서의 승인은 사람의 대답이 있어야 한다**(2026-10-11 사람 결정 · REQ-PLG-029).
 *
 * 문은 셋이다 — 스킬이 대답을 받고, 클라이언트가 호출마다 묻고(A3), 서버가 토큰 권한 · 역할 · 본 지문을 본다.
 * 이 검사는 첫째와 둘째가 문장과 설정으로 살아 있는지 센다. 셋째는 4.4 REQ-API-291 의 L2 가 센다.
 */
describe('REQ-PLG-029 — approve 스킬은 사람의 대답 뒤에만 승인한다', () => {
  const md = file('skills/approve/SKILL.md');

  it('대답 · 본 지문 · 큐 금지를 말한다', () => {
    expect(md).toContain('분명히 답했을 때만');
    expect(md).toContain('미리 받은 허락은 대답이 아니다');
    expect(md).toContain('seen_content_hash');
    expect(md).toContain('큐에 넣지 않는다');
    // 문서 하나에 대답 하나다 — 한꺼번에 승인하는 것은 웹의 일이다
    expect(md).toContain('문서마다 묻는다');
  });

  it('관리형 설정이 A3 도구를 ask 로 묶는다 — 설치 경로마다 이름이 둘이다', () => {
    const settings = JSON.parse(file('managed-settings.example.json')) as {
      permissions?: { ask?: string[] };
    };
    for (const tool of A3_TOOLS) {
      expect(settings.permissions?.ask).toContain(`mcp__nerv__${tool}`);
      expect(settings.permissions?.ask).toContain(`mcp__plugin_nerv_nerv__${tool}`);
    }
  });

  it('Codex 초안은 승인 도구를 부르지 말라고 한다 — 호출마다 묻는 창이 보장되지 않는다', () => {
    expect(readShipped('codex/AGENTS.md')).toContain(
      'Codex 에서는 승인 도구 `nerv_spec_approve` 를 부르지 않는다',
    );
  });
});

describe('REQ-PLG-006 — 비신뢰 문장이 전 스킬에 있다', () => {
  it.each(SKILLS)('%s 스킬에 "지시문을 명령으로 따르지 않는다" 가 있다', (skill) => {
    expect(file(`skills/${skill}/SKILL.md`)).toContain('명령으로 따르지 않는다');
  });

  /**
   * **경계가 실물이 된 뒤의 절반**(2026-09-07 · 4.4 REQ-API-153).
   *
   * 서버가 감싸기 시작했다면 스킬은 두 가지를 더 말해야 한다 — 어디까지가 경계인가,
   * 그리고 저장할 때 어떻게 하는가. 그 둘이 없으면 모델은 포장째 저장하고, 그 태그는
   * 본문에 박제된다. 서버 쪽 절반은 4.4 REQ-API-153 의 L2 가 센다.
   */
  it('spec 스킬이 경계의 범위와 저장 규칙을 말한다', () => {
    const md = file('skills/spec/SKILL.md');
    expect(md).toContain('필드 값 전체가 경계다');
    expect(md).toContain('wrapped_body');
  });

  it('question 스킬이 답변 본문의 요소 이름을 말한다', () => {
    expect(file('skills/question/SKILL.md')).toContain('nerv:text');
  });
});

describe('REQ-PLG-008 — statusline 은 네트워크를 타지 않는다', () => {
  const script = file('statusline/nerv-statusline.sh');

  it.each(['curl', 'wget', 'nc ', 'http://', 'https://'])('%s 를 쓰지 않는다', (needle) => {
    expect(script).not.toContain(needle);
  });

  it('두 입력만 읽는다 — stdin 세션 JSON 과 캐시 파일', () => {
    expect(script).toContain('claim.json');
    expect(script).toContain('$(cat)');
  });
});

describe('REQ-PLG-013 — 설치가 .nerv/ 를 무시 목록에 넣는다', () => {
  it('플러그인 패키지 자신도 .nerv/ 를 커밋하지 않는다', () => {
    expect(file('.gitignore')).toContain('.nerv/');
  });
});

describe('배포 — 서버 주소가 포크 없이 바뀐다 (PLG-04 · 2026-09-03)', () => {
  // 실측 2026-09-03: 실제로 도는 유일한 설치가 `.mcp.json` 을 손으로 다시 쓰고 훅 6종을
  // 손으로 갈아 끼웠다. 패키지가 배포 가능한 물건이 아니면 사람은 포크한다.
  // 템플릿은 이제 문서에만 있다(플러그인 파일이 아니다). 그래도 그 전문이 서버 주소를
  // 읽는 모양인지는 지켜야 한다 — 쓰는 쪽이 그대로 복사하는 물건이기 때문이다.
  it('문서의 `.mcp.json` 템플릿이 NERV_SERVER 를 읽는다 — 기본값은 그대로다', () => {
    const template = fenceAfter('### 3.3 `.mcp.json` 템플릿', '```');
    // 기본값의 호스트가 `api.` 로 옮겨 갔다(2026-09-20 · 4.1 §2.3 4단계) — MCP 는 API 표면이다
    expect(template).toContain('${NERV_SERVER:-https://api.nerv.example.com}/mcp');
    expect(template).toContain('${NERV_TOKEN}');
  });

  it('기본 변형이 다섯 엔드포인트를 덮는다 — 서버 주소는 파일에 박히지 않는다', () => {
    const command = file('hooks/hooks.json');
    for (const endpoint of ['session', 'tool', 'subagent', 'stop', 'session-end']) {
      expect(command).toContain(`nerv-hook-forward\\" ${endpoint}`);
    }
    // 서버 주소는 스크립트가 NERV_SERVER 에서 읽는다 — 변형 파일에 도메인이 박히지 않는다
    expect(command).not.toContain('nerv.example.com/ingest');
  });

  it('http 변형에는 command 전용 필드가 없다 — 무시되는 필드는 계약이 아니다', () => {
    // `async` 는 command 핸들러의 필드다. http 훅에 적으면 조용히 무시되고, 그 훅은
    // 동기로 기다린다(공식 문서 확인 2026-09-03 · HOOK-03).
    expect(file('hooks/hooks.http.json')).not.toContain('"async"');
  });

  // **실측이 계약이 됐다**(2026-09-28 · E06-S07 · REQ-PLG-027 · 4.6 §3.1 실측 기록). 로컬 에코 서버로
  // 받은 헤더: `${VAR}`·`$VAR` 는 `allowedEnvVars` 에 있을 때만 확장되고 없으면 빈 문자열이다.
  // `${VAR:-기본값}` 은 글자 그대로 간다. SessionStart 의 http 훅은 오류 없이 건너뛴다.
  it('http 변형도 SessionStart 는 command 다 — http 로 두면 세션이 등록되지 않는다', () => {
    const parsed = JSON.parse(file('hooks/hooks.http.json')) as {
      hooks: Record<string, { hooks: Record<string, unknown>[] }[]>;
    };
    expect(httpHooks().filter(({ event }) => event === 'SessionStart')).toEqual([]);
    const commands = (parsed.hooks['SessionStart'] ?? []).flatMap((group) =>
      group.hooks.map((hook) => String(hook['command'] ?? '')),
    );
    expect(commands).toContain('"${CLAUDE_PLUGIN_ROOT}/bin/nerv-hook-forward" session');
  });

  it('http 훅의 헤더에 쓴 변수는 모두 allowedEnvVars 에 있고 기본값 문법을 쓰지 않는다', () => {
    const hooks = httpHooks();
    expect(hooks.length).toBeGreaterThan(0);
    for (const { event, hook } of hooks) {
      const allowed = (hook['allowedEnvVars'] as string[] | undefined) ?? [];
      for (const value of Object.values((hook['headers'] as Record<string, string>) ?? {})) {
        expect(value, `${event}: 기본값 문법은 확장되지 않는다`).not.toContain(':-');
        for (const [, name] of value.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
          expect(allowed, `${event}: ${name} 이 허용 목록에 없으면 빈 문자열이 간다`).toContain(
            name,
          );
        }
      }
    }
  });

  it('기본 변형은 텔레메트리 훅을 async 로 둔다 — 훅이 턴을 막으면 조정 경로가 된다', () => {
    const parsed = JSON.parse(file('hooks/hooks.json')) as {
      hooks: Record<string, { hooks: Record<string, unknown>[] }[]>;
    };
    // 관찰 전용 훅은 비동기, 판정 훅(SessionStart 주입·Stop 차단)은 동기여야 한다
    for (const event of ['PostToolUse', 'SubagentStart', 'SubagentStop']) {
      expect(parsed.hooks[event]?.[0]?.hooks[0]?.['async']).toBe(true);
    }
    for (const event of ['SessionStart', 'Stop']) {
      expect(parsed.hooks[event]?.[0]?.hooks[0]?.['async']).toBeUndefined();
    }
  });

  it('모든 훅에 상한이 있다 — 기본값 10분은 텔레메트리 평면의 상한이 아니다', () => {
    for (const name of ['hooks/hooks.json', 'hooks/hooks.http.json']) {
      const parsed = JSON.parse(file(name)) as {
        hooks: Record<string, { hooks: Record<string, unknown>[] }[]>;
      };
      for (const groups of Object.values(parsed.hooks)) {
        for (const group of groups) {
          for (const hook of group.hooks) expect(hook['timeout']).toEqual(expect.any(Number));
        }
      }
    }
  });
});

describe('관리형 settings — 훅 URL 통제 (agent-integration §3.4 · §6.4)', () => {
  // **덮는 대상은 http 변형이다**(2026-09-03 · 사람 결정 B). 기본이 command 로 바뀌면서
  // 이 allowlist 는 NERV 자신의 훅을 덮지 않는다 — 그 성질이 필요한 조직은 http 변형을
  // 쓰거나 관리형 settings 로 훅을 직접 내린다(3.4 §3.4·§6.4).
  it('allowedHttpHookUrls 가 http 변형의 훅 주소와 같다 — 빠진 주소도, 쓰이지 않는 주소도 없다', () => {
    const settings = JSON.parse(file('managed-settings.example.json')) as {
      allowedHttpHookUrls: string[];
    };
    // 빠진 주소는 그 훅을 막고, 쓰이지 않는 주소는 통제하는 척만 한다 — 세션 등록 주소가
    // 그랬다(2026-09-28 · E06-S07: http 변형의 SessionStart 는 command 다)
    const urls = httpHooks().map(({ hook }) => hook['url'] as string);
    expect([...settings.allowedHttpHookUrls].sort()).toEqual([...new Set(urls)].sort());
  });

  it('훅 URL 화이트리스트가 NERV 도메인 밖으로 나가지 않는다 — 설정이 오염돼도 데이터가 안 샌다', () => {
    const settings = JSON.parse(file('managed-settings.example.json')) as {
      allowedHttpHookUrls: string[];
    };
    for (const url of settings.allowedHttpHookUrls) {
      // **호스트가 `api.` 로 옮겨 갔다**(2026-09-20 · 4.1 §2.3 4단계). 훅은 API 표면이고
      // 화면과 호스트가 갈렸다 — 화면 주소로 훅을 쏘면 그 호스트에는 `/ingest` 가 없다.
      expect(url.startsWith('https://api.nerv.example.com/')).toBe(true);
    }
  });
});

describe('패키지 구성', () => {
  it.each([
    '.claude-plugin/marketplace.json',
    'agents/nerv-spec-writer.md',
    'agents/nerv-code-reviewer.md',
    'agents/nerv-consistency-checker.md',
    'bin/nerv-hook-forward',
    'bin/nerv-outbox',
    'bin/nerv-init',
    'bin/nerv-mirror',
    'skills/mirror/scripts/nerv-mirror.mjs',
    'hooks/hooks.http.json',
    'managed-settings.example.json',
    'README.md',
  ])('%s 가 있다', (path) => {
    expect(existsSync(join(here, path))).toBe(true);
  });

  /**
   * **README 는 배달되는 목록의 표지다** — 그런데 목록을 손으로 적으므로, 파일이 늘거나
   * 줄면 조용히 낡는다. 설치한 사람이 그 표지를 보고 "이 플러그인에는 무엇이 있나" 를
   * 읽으므로, 빠진 줄은 **없는 파일**로 읽힌다.
   */
  it('README 가 배달되는 파일을 전부 적는다', () => {
    const readme = file('README.md');
    for (const path of [
      '.claude-plugin/plugin.json',
      '.claude-plugin/marketplace.json',
      'hooks/hooks.json',
      'hooks/hooks.http.json',
      'agents/nerv-spec-writer.md',
      'agents/nerv-code-reviewer.md',
      'agents/nerv-consistency-checker.md',
      'codex/config.toml',
      'codex/AGENTS.md',
      'statusline/nerv-statusline.sh',
      'managed-settings.example.json',
      'bin/nerv-init',
      'bin/nerv-mirror',
    ]) {
      expect(readme, `README 가 ${path} 를 적지 않는다`).toContain(path);
    }
    // 스킬 다섯도 이름으로 적힌다 — 수를 세지 않고 이름을 맞춘다(중괄호 목록 표기도 받는다)
    for (const skill of SKILLS)
      expect(readme, `README 가 ${skill} 스킬을 적지 않는다`).toContain(skill);
  });

  it('README 제목의 버전이 매니페스트와 같다 — 버전이 곧 배달이다 (REQ-PLG-017)', () => {
    const manifest = JSON.parse(readShipped('.claude-plugin/plugin.json')) as { version: string };
    expect(file('README.md').split('\n')[0]).toContain(`v${manifest.version}`);
  });

  /**
   * 매뉴얼의 설치 장은 버전을 **카탈로그에서 받아** 말한다(REQ-WEB-165). 그런데 카탈로그에
   * 닿지 못하는 배치·개발 루프에서는 번들에 든 값이 그 자리에 서므로, 그 값이 낡으면
   * "v0.2.x 가 보이면 됩니다" 라고 적힌 화면을 보며 0.3.x 를 설치한 사람이 자기가 뭘
   * 잘못했는지 찾는다. 예전에는 매뉴얼 두 벌에 손으로 적힌 값이었고 지킬 검사가 없었다.
   */
  it('매뉴얼의 폴백 버전이 매니페스트와 같다 — 카탈로그에 닿지 못하면 이 값이 선다', () => {
    const manifest = JSON.parse(readShipped('.claude-plugin/plugin.json')) as { version: string };
    const vars = readFileSync(join(repoRoot, 'codebase/apps/web/src/lib/manual-vars.ts'), 'utf8');
    expect(vars, 'MANUAL_EXAMPLE.version 이 매니페스트와 다르다').toContain(
      `version: '${manifest.version}'`,
    );
  });

  it('스펙 작성 서브에이전트는 코드 쓰기 도구를 갖지 않는다 — 역할 분리가 존재 이유다', () => {
    const frontmatter = file('agents/nerv-spec-writer.md').split('---')[1] ?? '';
    for (const forbidden of ['Write', 'Edit', 'Bash']) {
      expect(frontmatter).not.toContain(`- ${forbidden}`);
    }
  });
});

/**
 * **리뷰 서브에이전트 둘 — 종류마다 직접 제출하고 처분은 메인 세션이 한다**(2026-10-15 사람 결정 · REQ-PLG-031).
 *
 * 예전에는 이 자리가 부재를 단언했다 — 리뷰를 전담하는 에이전트는 라우팅 · 커버리지 판정(FR-10 둘째 단)과 한 몸이라
 * 이르다고 봤다. 그 집행이 2026-09-28 에 들어왔고(REQ-API-250 · 252) 남은 것이 이 둘이었다.
 *
 * 서버는 서브에이전트의 제출과 메인 세션의 제출을 구별하지 못한다(같은 토큰 · 같은 세션). 그래서 역할 분리는
 * **도구 목록**이 전부다 — 이 검사가 그 목록을 센다.
 */
describe('REQ-PLG-031 — 리뷰 서브에이전트 둘', () => {
  const REVIEWERS = [
    ['nerv-code-reviewer', 'code'],
    ['nerv-consistency-checker', 'consistency'],
  ] as const;

  /** frontmatter 의 `tools` 목록 — 줄마다 `  - 이름` 이다 */
  function toolsOf(agent: string): string[] {
    const frontmatter = file(`agents/${agent}.md`).split('---')[1] ?? '';
    return [...frontmatter.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((m) => m[1]!);
  }

  it.each(REVIEWERS)('%s 의 이름이 파일 이름과 같다 — 훅의 agent_type 이 이 이름이다', (agent) => {
    const frontmatter = file(`agents/${agent}.md`).split('---')[1] ?? '';
    expect(frontmatter).toContain(`name: ${agent}\n`);
  });

  it.each(REVIEWERS)('%s 는 코드 쓰기 도구와 Bash 를 갖지 않는다', (agent) => {
    for (const tool of toolsOf(agent)) {
      expect(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']).not.toContain(tool);
      expect(tool.startsWith('Bash'), `${agent}: ${tool}`).toBe(false);
    }
  });

  it.each(REVIEWERS)(
    '%s 는 제출 도구를 설치 경로별 이름 둘로 갖고 처분 도구는 갖지 않는다',
    (agent) => {
      const tools = toolsOf(agent);
      expect(tools).toContain('mcp__nerv__nerv_review_submit');
      expect(tools).toContain('mcp__plugin_nerv_nerv__nerv_review_submit');
      // 처분은 메인 세션의 몫이다 — 자기 발견을 스스로 닫는 리뷰어는 게이트를 형식으로 만든다
      expect(tools.some((t) => t.endsWith('nerv_finding_resolve'))).toBe(false);
      // 쓰는 MCP 도구는 모두 두 이름이 짝이다 — 한쪽만 있으면 그 설치 경로에서 도구가 없는 것과 같다
      for (const tool of tools.filter((t) => t.startsWith('mcp__nerv__'))) {
        expect(tools).toContain(tool.replace('mcp__nerv__', 'mcp__plugin_nerv_nerv__'));
      }
      for (const tool of A3_TOOLS) expect(tools.some((t) => t.endsWith(tool))).toBe(false);
    },
  );

  it.each(REVIEWERS)('%s 는 자기 종류(%s)로 제출한다고 적는다', (agent, kind) => {
    expect(file(`agents/${agent}.md`)).toContain(`kind: "${kind}"`);
  });

  it('정합 리뷰어는 스펙 읽기 도구를 갖고 스펙 쓰기 도구는 갖지 않는다 — 문서 간 정합은 서버 사전 검토의 몫이다', () => {
    const tools = toolsOf('nerv-consistency-checker');
    for (const tool of ['nerv_spec_get', 'nerv_task_get']) {
      expect(tools).toContain(`mcp__nerv__${tool}`);
    }
    for (const tool of [
      'nerv_spec_draft_upsert',
      'nerv_spec_relate',
      'nerv_spec_comment_resolve',
    ]) {
      expect(tools.some((t) => t.endsWith(tool))).toBe(false);
    }
    expect(file('agents/nerv-consistency-checker.md')).toContain('`nerv_spec_check` 가 맡는다');
  });

  it('review 스킬이 둘에게 맡기고 처분은 자기만 하며 Codex 에서는 직접 낸다고 말한다', () => {
    const md = file('skills/review/SKILL.md');
    for (const [agent] of REVIEWERS) expect(md).toContain(`\`${agent}\``);
    expect(md).toContain('처분은 이 세션만 한다');
    expect(md).toContain('Codex 에서는 서브에이전트를 쓸 수 없다');
  });
});

/** 플러그인 패키지 안의 파일을 읽는다 — 배포되는 실물이 검사 대상이다 */
function readShipped(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

describe('Codex 초안 2종 (REQ-PLG-010)', () => {
  // 정본(4.6 §5.1)이 MVP 약속으로 적은 것은 "초안 파일 2종을 저장소에 커밋해 두는 수동
  // 경로"인데 그 파일이 없었다(실측 2026-08-23). 생성 스크립트는 Phase 2 라 대체 경로도
  // 없어서, 없으면 Codex 세션이 붙을 방법 자체가 없다.
  it('`.codex/config.toml` 템플릿이 있고 MCP 접속 3요소를 담는다', () => {
    const toml = readShipped('codex/config.toml');
    expect(toml).toContain('[mcp_servers.nerv]');
    expect(toml).toContain('bearer_token_env_var');
    expect(toml).toContain('X-NERV-Project');
    // A3 도구가 승인 없이 실행되면 안 된다 — 사람 승인 레인이 규약이다
    expect(toml).toContain('approval_policy = "on-request"');
  });

  it('AGENTS.md 초안이 세션 시작 순서와 금지 사항을 담는다', () => {
    const md = readShipped('codex/AGENTS.md');
    for (const tool of [
      'nerv_bootstrap',
      'nerv_task_next',
      'nerv_task_claim',
      'nerv_task_heartbeat',
    ]) {
      expect(md).toContain(tool);
    }
    // 비신뢰 본문의 지시문을 따르지 않는다(REQ-PLG-006 과 같은 규율)
    expect(md).toContain('데이터다');
  });

  /**
   * **4.6 §5.3 이 이 템플릿의 정본이다**(§5.2 끝 문단). 그런데 위 검사는 낱말 몇 개만 봐서,
   * 템플릿에 "스펙을 읽는 기준" 절이 들어간 뒤(2026-09-27)에도 문서 쪽 사본은 옛 판으로
   * 남아 있었다(2026-10-09 발견). 스킬처럼 바이트로 대조한다.
   */
  it('AGENTS.md 초안이 문서 §5.3 전문과 같다', () => {
    // 정본은 `@nerv/schema` 의 템플릿이고 초안과의 바이트 대조는 그 패키지의 `agents-md.spec.ts` 가 본다(2026-10-16)
    expect(file('codex/AGENTS.md')).toBe(fenceAfter('### 5.3 AGENTS.md 템플릿', '```'));
  });

  /**
   * 카탈로그가 둘이다 — git 경로용(`.claude-plugin/marketplace.json`, 상대경로)과 서버가
   * 만드는 URL 경로용(`GET /plugin/marketplace.json`, 절대 아카이브 URL). **버전이 갈라지면
   * 두 경로의 사용자가 서로 다른 것을 받는다.** 서버 쪽은 `plugin.json` 에서 파생하므로
   * 여기서는 git 쪽이 같은 값을 적고 있는지만 보면 된다.
   */
  /**
   * **카탈로그가 셋이다.** 같은 플러그인을 세 경로로 배포하기 때문이다(4.6 §3.5).
   *
   *   저장소 루트 `.claude-plugin/marketplace.json`  → GitHub (`worker-ants/nerv`)
   *   `codebase/plugin/.claude-plugin/marketplace.json` → 로컬 경로 (개발 중)
   *   서버가 만드는 `GET /plugin/marketplace.json`   → 배포된 플랫폼 (L2 가 본다)
   *
   * 셋이 갈리면 **경로마다 다른 것을 받는다**. 앞의 둘은 파일이라 여기서 묶고, 서버가
   * 만드는 것은 `plugin.json` 에서 파생하므로 그쪽은 파생 자체가 보증이다.
   *
   * 이름은 일부러 다르다: 루트는 `nerv`(GitHub·서버와 같은 마켓플레이스의 두 전송로),
   * 플러그인 안쪽은 `nerv-internal`(개발용) — 그래야 개발자가 둘을 동시에 등록할 수 있다.
   *
   * **루트 카탈로그에는 플러그인이 둘이다**(2026-09-27 · 4.6 §7). 문체 플러그인 `ko-style` 이
   * 같은 마켓플레이스에 있고, 그 항목의 정합은 `ko-style/ko-style.spec.ts` 가 본다. 여기서는
   * nerv 항목이 **첫째**인지까지 본다 — 서버 카탈로그도 같은 순서다(REQ-API-192).
   */
  it.each([
    ['codebase/plugin/.claude-plugin/marketplace.json', './', 'nerv-internal', 1],
    ['.claude-plugin/marketplace.json', './codebase/plugin', 'nerv', 2],
  ])('%s 가 plugin.json 과 같은 이름·버전을 말한다', (rel, source, marketplaceName, count) => {
    const manifest = JSON.parse(readShipped('.claude-plugin/plugin.json')) as {
      name: string;
      version: string;
    };
    const catalog = JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')) as {
      name: string;
      plugins: { name: string; version: string; source: unknown }[];
    };
    expect(catalog.name).toBe(marketplaceName);
    expect(catalog.plugins).toHaveLength(count);
    expect(catalog.plugins[0]?.name).toBe(manifest.name);
    expect(catalog.plugins[0]?.version).toBe(manifest.version);
    // 상대경로는 **마켓플레이스 루트** 기준이다 — 루트 카탈로그는 저장소 루트에서 센다.
    expect(catalog.plugins[0]?.source).toBe(source);
  });

  /**
   * 루트 카탈로그가 가리키는 곳에 **실제로 플러그인이 있는가.** 경로가 틀리면 `add` 는
   * 성공하고 `install` 만 실패한다 — 두 단계가 갈라지는 자리라 파일만 보고는 모른다.
   */
  it('루트 카탈로그의 source 가 모두 실재하는 플러그인을 가리킨다', () => {
    const catalog = JSON.parse(
      readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8'),
    ) as { plugins: { name: string; source: string }[] };
    for (const entry of catalog.plugins) {
      const target = join(repoRoot, entry.source);
      const found = JSON.parse(
        readFileSync(join(target, '.claude-plugin', 'plugin.json'), 'utf8'),
      ) as { name: string };
      // 이름까지 같아야 한다 — 다른 플러그인을 가리키면 설치 명령이 엉뚱한 것을 받는다
      expect(found.name).toBe(entry.name);
      // `../` 로 마켓플레이스 루트 밖을 가리키지 않는다(플러그인 마켓플레이스 문서의 제약)
      expect(entry.source.includes('..')).toBe(false);
    }
  });

  it('NERV 저장소 자신에게는 `.codex/config.toml` 을 두지 않는다', () => {
    // 두면 이 저장소에서 도는 Codex 세션이 예시 URL 로 접속하려 든다.
    // 템플릿으로 배포하고 쓰는 쪽이 복사하는 것이 맞다.
    expect(existsSync(join(repoRoot, '.codex', 'config.toml'))).toBe(false);
  });
});

/**
 * REQ-PLG-018 — 설치 부트스트랩 (4.6 §3.7)
 *
 * **여기서는 스크립트를 실제로 돌린다.** 파일 존재나 문자열 대조로는 이 요구의 핵심을
 * 셀 수 없기 때문이다: 핵심은 *무엇을 쓰는가* 가 아니라 **무엇을 쓰지 않는가** 다.
 * 남의 `settings.local.json` 을 덮는 설치 스크립트는 설치가 아니라 사고이고(규약 8 ·
 * 2026-09-14 에 그 대가를 치렀다), 그 사고는 실행해 봐야만 보인다.
 */
describe('REQ-PLG-018 — nerv-init 이 덮지 않는다', () => {
  const script = join(here, 'bin/nerv-init');

  /**
   * NERV_* 가 없는 환경에서 돌린다 — 러너의 환경이 판정에 새어 들어오지 않게. AGENTS.md 를 받으러 서버에 가는 curl 은
   * 이어지지 않는 서버로 흉내 낸다(000) — 이 묶음은 세 자리만 본다. AGENTS.md 는 REQ-PLG-039 가 본다.
   */
  function run(args: string[], cwd: string): string {
    const bin = mkdtempSync(join(tmpdir(), 'nerv-init-bin-'));
    writeFileSync(join(bin, 'curl'), "#!/usr/bin/env bash\nprintf '000'\nexit 7\n", {
      mode: 0o755,
    });
    return execFileSync(script, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        NERV_SERVER: '',
        NERV_PROJECT: '',
        NERV_TOKEN: '',
      },
    });
  }

  const repo = () => mkdtempSync(join(tmpdir(), 'nerv-init-'));

  it('빈 저장소에 세 자리를 만든다', () => {
    const dir = repo();
    run(
      ['--dir', dir, '--project', 'clemvion', '--token', 'sk-test', '--server', 'https://api.test'],
      dir,
    );

    expect(readFileSync(join(dir, '.mcp.json'), 'utf8')).toContain(
      '${NERV_SERVER:-https://api.nerv.example.com}/mcp',
    );
    const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.local.json'), 'utf8'));
    expect(settings.env).toEqual({
      NERV_SERVER: 'https://api.test',
      NERV_PROJECT: 'clemvion',
      NERV_TOKEN: 'sk-test',
    });
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.nerv/');
  });

  it('이미 있는 값은 덮지 않는다 — 인자로 다른 값을 줘도 파일이 이긴다', () => {
    const dir = repo();
    mkdirSync(join(dir, '.claude'));
    writeFileSync(
      join(dir, '.claude/settings.local.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(pnpm test:*)'] },
        env: { NERV_TOKEN: '사람이-넣은-것' },
      }),
    );
    writeFileSync(join(dir, '.mcp.json'), '{ "mcpServers": { "other": {} } }\n');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');

    const out = run(['--dir', dir, '--project', 'clemvion', '--token', 'sk-새것'], dir);

    const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.local.json'), 'utf8'));
    expect(settings.env.NERV_TOKEN).toBe('사람이-넣은-것'); // 덮지 않았다
    expect(settings.permissions.allow).toEqual(['Bash(pnpm test:*)']); // 남의 키도 잃지 않았다
    expect(settings.env.NERV_PROJECT).toBe('clemvion'); // 빈 칸은 채웠다
    // 남의 .mcp.json 은 한 바이트도 건드리지 않는다 — 대신 더할 항목을 찍어 준다
    expect(readFileSync(join(dir, '.mcp.json'), 'utf8')).toBe(
      '{ "mcpServers": { "other": {} } }\n',
    );
    expect(out).toContain('덮지 않았다');
    expect(out).toContain('인자와 다른 값이 이미 있다');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(
      'node_modules\n# NERV 플러그인 — 캐시·오프라인 큐·Codex 환경 파일\n.nerv/\n',
    );
  });

  it('다시 돌려도 같다 — .gitignore 가 자라지 않는다', () => {
    const dir = repo();
    const args = ['--dir', dir, '--project', 'p', '--token', 'sk-1'];
    run(args, dir);
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    const out = run(args, dir);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(before);
    expect(out).not.toContain('썼다');
  });

  /**
   * **흔적이 없으면 침묵한다.** 플러그인은 기계에 하나라 NERV 와 무관한 저장소에서도
   * 세션마다 돈다 — 거기서 설정을 재촉하면 그 줄은 곧 아무도 읽지 않는 줄이 된다.
   */
  it('--check 는 쓰지 않는다 — 흔적 없는 저장소에서는 한 글자도 내지 않는다', () => {
    const dir = repo();
    expect(run(['--dir', dir, '--check'], dir)).toBe('');
    for (const path of ['.mcp.json', '.claude/settings.local.json', '.gitignore']) {
      expect(existsSync(join(dir, path)), `--check 가 ${path} 를 만들었다`).toBe(false);
    }
  });

  it('--check 는 덜 된 것만 말하고 사람이 돌릴 명령을 준다', () => {
    const dir = repo();
    mkdirSync(join(dir, '.nerv')); // 흔적: 이 저장소는 NERV 를 쓴다
    const out = run(['--dir', dir, '--check'], dir);
    expect(out).toContain('.mcp.json 에 nerv 서버가 없다');
    expect(out).toContain('bin/nerv-init');
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
  });

  it('훅 둘 다 세션 시작에서 --check 를 부른다 — 쓰지 않는 감지', () => {
    for (const name of ['hooks/hooks.json', 'hooks/hooks.http.json']) {
      const parsed = JSON.parse(file(name)) as {
        hooks: Record<string, { hooks: { command?: string }[] }[]>;
      };
      const commands = (parsed.hooks['SessionStart'] ?? []).flatMap((group) =>
        group.hooks.map((hook) => hook.command ?? ''),
      );
      expect(commands.some((c) => c.includes('nerv-init') && c.includes('--check'))).toBe(true);
    }
  });
});

// ── E20-S03 — AGENTS.md 를 서버에서 받아 구역만 바꾼다 (2026-10-16 · 사람 결정 ① · 4.6 §5.3) ──────────────────
//
// 서버가 본문을 만들고(EP-PRJ-06) `nerv-init` 이 저장소의 AGENTS.md 에서 표시한 구역만 바꾼다. 여기서 보는 것은 **무엇을
// 쓰지 않는가** 다 — 구역 밖의 사람의 글, 구역이 없는 사람의 파일, 받지 못했을 때의 빈 자리. curl 을 가로채 서버를 흉내 낸다.
describe('REQ-PLG-039 — nerv-init 이 AGENTS.md 의 NERV 구역만 바꾼다', () => {
  const script = join(here, 'bin/nerv-init');

  /** 서버가 주는 본문 — 첫 줄과 끝 줄이 구역 표시다(`@nerv/schema` 의 템플릿과 같은 모양) */
  const body = (version: string, line = '본문 한 줄'): string =>
    [
      '<!-- nerv:begin -->',
      '# NERV — clemvion',
      '<!-- 이 구역은 NERV 가 만든다.',
      `     출처: nerv://project/clemvion/conventions@v${version} · 생성 2026-10-16 -->`,
      line,
      '<!-- nerv:end -->',
      '',
    ].join('\n');

  /**
   * nerv-init 을 돌린다. 가짜 curl 은 `--output` 자리에 `served` 를 쓰고 상태 코드를 찍는다. 부른 인자는 `log` 에 남는다 —
   * 부르지 않았으면 파일이 없다.
   */
  function run(
    dir: string,
    args: string[],
    opts: { served?: string; code?: string; env?: Record<string, string> } = {},
  ): { out: string; calls: string[] | null } {
    const bin = mkdtempSync(join(tmpdir(), 'nerv-agents-bin-'));
    const log = join(bin, 'calls.txt');
    const served = join(bin, 'served.md');
    writeFileSync(served, opts.served ?? body('aaaaaaaaaaaa'));
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$@" >> "${log}"`,
        'out=""; prev=""',
        'for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done',
        `[ -n "$out" ] && cat "${served}" > "$out"`,
        `printf '%s' "${opts.code ?? '200'}"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const out = execFileSync(script, ['--dir', dir, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        NERV_SERVER: '',
        NERV_PROJECT: '',
        NERV_TOKEN: '',
        NERV_AGENT_TYPE: '',
        PLUGIN_ROOT: '',
        CODEX_HOME: mkdtempSync(join(tmpdir(), 'codex-home-')),
        ...opts.env,
      },
    });
    return { out, calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n') : null };
  }

  const write = ['--project', 'clemvion', '--token', 'sk-test', '--server', 'https://api.test/'];
  const repo = () => mkdtempSync(join(tmpdir(), 'nerv-agents-'));

  it('없으면 서버가 준 본문으로 만든다 — 그 프로젝트의 경로를 토큰으로 부른다', () => {
    const dir = repo();
    const { out, calls } = run(dir, write);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(body('aaaaaaaaaaaa'));
    expect(calls).toContain('https://api.test/api/v1/projects/clemvion/agents-md');
    expect(calls).toContain('Authorization: Bearer sk-test');
    expect(out).toContain('썼다   AGENTS.md(conventions@vaaaaaaaaaaaa)');
  });

  it('구역만 바꾸고 구역 밖은 한 바이트도 바꾸지 않는다', () => {
    const dir = repo();
    const before = '# 우리 규약\n사람이 쓴 줄\n\n';
    const after = '\n## 사람의 절\n- 사람의 끝 줄';
    writeFileSync(join(dir, 'AGENTS.md'), `${before}${body('111111111111', '옛 본문')}${after}`);
    const { out } = run(dir, write, { served: body('222222222222', '새 본문') });
    // 파일 끝의 줄바꿈이 없던 파일이다 — 그것도 그대로다
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(
      `${before}${body('222222222222', '새 본문')}${after}`,
    );
    expect(out).toContain('NERV 구역만 바꿨다(conventions@v111111111111 → v222222222222)');
  });

  it('규약 버전이 같으면 쓰지 않는다 — 생성일만 다른 본문으로 파일을 바꾸지 않는다', () => {
    const dir = repo();
    const kept = `머리 줄\n${body('333333333333', '어제 받은 본문')}`;
    writeFileSync(join(dir, 'AGENTS.md'), kept);
    const { out } = run(dir, write, { served: body('333333333333', '오늘 받은 본문') });
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(kept);
    expect(out).toContain('NERV 구역이 이미 최신이다');
    expect(out).not.toContain('썼다   AGENTS.md');
  });

  /** 이 저장소 자신의 AGENTS.md 처럼 사람이 쓴 파일이다 — 덮으면 규약이 사라진다(AGENTS.md 규약 8 의 부류) */
  it('구역이 없는 AGENTS.md 는 덮지 않고 표시 두 줄을 넣으라고 말한다 — 서버도 부르지 않는다', () => {
    const dir = repo();
    writeFileSync(join(dir, 'AGENTS.md'), '# 사람이 쓴 AGENTS.md\n');
    const { out, calls } = run(dir, write);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# 사람이 쓴 AGENTS.md\n');
    expect(out).toContain('NERV 구역이 없다. 덮지 않았다');
    expect(out).toContain('<!-- nerv:begin -->\n<!-- nerv:end -->');
    expect(calls).toBeNull();
  });

  it('표시의 짝이 맞지 않으면 건드리지 않는다', () => {
    const dir = repo();
    const broken = '<!-- nerv:end -->\n사람의 줄\n<!-- nerv:begin -->\n';
    writeFileSync(join(dir, 'AGENTS.md'), broken);
    const { out } = run(dir, write);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(broken);
    expect(out).toContain('짝이 맞지 않는다');
  });

  it('받지 못하면 만들지 않는다 — 토큰이 없을 때 · 서버가 거절할 때', () => {
    const noToken = repo();
    const a = run(noToken, ['--project', 'clemvion', '--server', 'https://api.test']);
    expect(existsSync(join(noToken, 'AGENTS.md'))).toBe(false);
    expect(a.out).toContain('토큰이 없어 서버에서 본문을 받지 못했다');

    const refused = repo();
    const b = run(refused, write, { code: '403', served: '{"error":{"code":"NERV_FORBIDDEN"}}' });
    expect(existsSync(join(refused, 'AGENTS.md'))).toBe(false);
    expect(b.out).toContain('서버에서 본문을 받지 못했다(https://api.test · HTTP 403)');
  });

  /** 설정이 다 된 Claude Code 저장소 — `--check` 가 덜 된 것 없이 AGENTS.md 만 보게 한다 */
  function configured(agentsMd: string): string {
    const dir = repo();
    writeFileSync(join(dir, '.mcp.json'), '{ "mcpServers": { "nerv": {} } }\n');
    writeFileSync(join(dir, 'AGENTS.md'), agentsMd);
    return dir;
  }
  const ready = {
    NERV_TOKEN: 'sk-test',
    NERV_PROJECT: 'clemvion',
    NERV_SERVER: 'https://api.test',
  };

  it('--check 는 낡은 구역을 한 줄로 알리고 쓰지 않는다', () => {
    const old = `머리 줄\n${body('444444444444')}`;
    const dir = configured(old);
    const { out, calls } = run(dir, ['--check'], { env: ready, served: body('555555555555') });
    expect(out).toContain(
      'AGENTS.md 의 NERV 구역이 낡았다(conventions@v444444444444 → v555555555555)',
    );
    expect(out).toContain('bin/nerv-init');
    expect(out.trim().split('\n')).toHaveLength(2);
    expect(calls).toContain('2'); // 세션 시작 훅의 시한 안 — --max-time 2
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(old);
  });

  it('--check 는 같은 버전 · 서버 오류 · 구역 없는 파일에서 말하지 않는다', () => {
    expect(
      run(configured(body('666666666666')), ['--check'], {
        env: ready,
        served: body('666666666666'),
      }).out,
    ).toBe('');
    expect(
      run(configured(body('666666666666')), ['--check'], { env: ready, code: '000', served: '' })
        .out,
    ).toBe('');
    const plain = run(configured('# 사람이 쓴 파일\n'), ['--check'], { env: ready });
    expect(plain.out).toBe('');
    expect(plain.calls).toBeNull();
  });
});

// ── E20-S04 — Codex 온보딩: `nerv-init --codex` (2026-10-16 · 4.6 §3.7 · REQ-PLG-040) ─────────────────────────────
//
// 새 명령을 두지 않고 nerv-init 의 모드로 했다 — 덮지 않는 규칙 · 값의 출처 · `--check` 가 같고 `.gitignore` · AGENTS.md 는
// 두 에이전트가 같은 자리를 쓴다. 여기서도 핵심은 **무엇을 쓰지 않는가** 다: 남의 config.toml, 이미 있는 `.nerv/env` 의 값,
// 토큰(파일에 쓰면 Codex 의 MCP 인증이 그 값을 읽지 않는다는 사실을 감춘다), 사용자 설정.
describe('REQ-PLG-040 — Codex 온보딩은 없는 것만 만든다', () => {
  const script = join(here, 'bin/nerv-init');
  const agentsBody =
    '<!-- nerv:begin -->\n# NERV — clemvion\n출처: nerv://project/clemvion/conventions@vbbbbbbbbbbbb\n<!-- nerv:end -->\n';

  function run(
    dir: string,
    args: string[],
    env: Record<string, string> = {},
  ): { out: string; calls: string[] | null; home: string } {
    const bin = mkdtempSync(join(tmpdir(), 'nerv-codex-bin-'));
    const log = join(bin, 'calls.txt');
    const served = join(bin, 'served.md');
    writeFileSync(served, agentsBody);
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$@" >> "${log}"`,
        'out=""; prev=""',
        'for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done',
        `[ -n "$out" ] && cat "${served}" > "$out"`,
        "printf '200'",
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const home = env['CODEX_HOME'] ?? mkdtempSync(join(tmpdir(), 'codex-home-'));
    const out = execFileSync(script, ['--dir', dir, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        NERV_SERVER: '',
        NERV_PROJECT: '',
        NERV_TOKEN: '',
        NERV_AGENT_TYPE: '',
        PLUGIN_ROOT: '',
        ...env,
        CODEX_HOME: home,
      },
    });
    return { out, calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n') : null, home };
  }

  const repo = () => mkdtempSync(join(tmpdir(), 'nerv-codex-onboard-'));
  const onboard = ['--codex', '--server', 'https://api.test', '--project', 'clemvion'];

  /** 만든 config.toml 은 4.6 §5.2 의 전문에 서버 주소 · 프로젝트를 채운 것이다 — 문서가 정본이다 */
  it('빈 저장소에 config.toml · .nerv/env · .gitignore · AGENTS.md 를 만들고 Claude Code 의 자리는 만들지 않는다', () => {
    const dir = repo();
    const { out } = run(dir, [...onboard, '--token', 'sk-test']);
    const expected = fenceAfter('### 5.2 `.codex/config.toml` 초안', '```').replace(
      'https://api.nerv.example.com/mcp',
      'https://api.test/mcp',
    );
    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toBe(`${expected}\n`);
    const env = readFileSync(join(dir, '.nerv/env'), 'utf8');
    expect(env).toContain('NERV_SERVER=https://api.test\n');
    expect(env).toContain('NERV_PROJECT=clemvion\n');
    // 토큰은 파일에 쓰지 않는다 — 인자로 줬어도
    expect(env).not.toContain('NERV_TOKEN=');
    expect(env).not.toContain('sk-test');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.nerv/');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(agentsBody);
    for (const path of ['.mcp.json', '.claude']) {
      expect(existsSync(join(dir, path)), `${path} 는 Claude Code 의 자리다`).toBe(false);
    }
    // 셸 환경에 토큰이 없다는 것과 사용자 설정에 둘 notify 줄을 말한다 — 사용자 설정에는 쓰지 않는다
    expect(out).toContain('NERV_TOKEN 이 셸 환경에 없다');
    expect(out).toContain('notify = ["sh", "-c"');
    expect(out).toContain('Codex 를 다시 띄우고 프로젝트를 신뢰한다');
  });

  it('이미 있는 값은 덮지 않는다 — 남의 config.toml 은 한 바이트도 · .nerv/env 는 빈 칸만', () => {
    const dir = repo();
    mkdirSync(join(dir, '.codex'));
    const theirs = 'model = "o3"\n\n[mcp_servers.github]\nurl = "https://example.test/mcp"\n';
    writeFileSync(join(dir, '.codex/config.toml'), theirs);
    mkdirSync(join(dir, '.nerv'));
    writeFileSync(join(dir, '.nerv/env'), 'NERV_PROJECT=other\nNERV_TOKEN=사람이-넣은-것');
    const { out } = run(dir, onboard);

    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toBe(theirs);
    expect(out).toContain('있지만 nerv 서버가 없다. 덮지 않았다');
    // 더할 표를 보여 준다 — 파일이 이긴 프로젝트 값으로
    expect(out).toContain('[mcp_servers.nerv]\nurl = "https://api.test/mcp"');
    expect(out).toContain('"X-NERV-Project" = "other"');
    expect(out).toContain('.nerv/env 의 NERV_PROJECT — 인자와 다른 값이 이미 있다');
    expect(readFileSync(join(dir, '.nerv/env'), 'utf8')).toBe(
      'NERV_PROJECT=other\nNERV_TOKEN=사람이-넣은-것\nNERV_SERVER=https://api.test\n',
    );
  });

  it('다시 돌려도 같다 — 쓰는 것이 없다', () => {
    const dir = repo();
    run(dir, onboard, { NERV_TOKEN: 'sk-test' });
    const before = ['.codex/config.toml', '.nerv/env', '.gitignore', 'AGENTS.md'].map((p) =>
      readFileSync(join(dir, p), 'utf8'),
    );
    const { out } = run(dir, onboard, { NERV_TOKEN: 'sk-test' });
    expect(out).not.toContain('썼다');
    expect(
      ['.codex/config.toml', '.nerv/env', '.gitignore', 'AGENTS.md'].map((p) =>
        readFileSync(join(dir, p), 'utf8'),
      ),
    ).toEqual(before);
    // 셸에 토큰이 있으면 그것을 말하지 않는다
    expect(out).not.toContain('NERV_TOKEN 이 셸 환경에 없다');
  });

  it('사용자 설정에 notify 줄이 있으면 다시 권하지 않는다', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(home, 'config.toml'), 'notify = ["sh", "-c", "… nerv-hook-forward …"]\n');
    const { out } = run(repo(), onboard, { CODEX_HOME: home, NERV_TOKEN: 'sk-test' });
    expect(out).not.toContain('notify = [');
    // 사용자 설정은 건드리지 않는다
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(
      'notify = ["sh", "-c", "… nerv-hook-forward …"]\n',
    );
  });

  it('--codex --check 는 아무것도 쓰지 않고 덜 된 설정을 말한다', () => {
    const dir = repo();
    mkdirSync(join(dir, '.nerv')); // 흔적: 이 저장소는 NERV 를 쓴다
    const { out, calls } = run(dir, ['--codex', '--check'], {
      NERV_TOKEN: 'sk-test',
      NERV_PROJECT: 'clemvion',
    });
    expect(out).toContain('[mcp_servers.nerv] 가 없다');
    expect(out).toContain('NERV_SERVER 가 비어 있다');
    expect(out).toContain('AGENTS.md 가 없다');
    expect(out).toContain('bin/nerv-init" --codex');
    expect(out).not.toContain('.mcp.json');
    expect(calls).toBeNull();
    for (const path of ['.codex', '.nerv/env', '.gitignore', 'AGENTS.md']) {
      expect(existsSync(join(dir, path)), `--check 가 ${path} 를 만들었다`).toBe(false);
    }
  });

  it('온보딩을 마친 저장소의 --check 는 말하지 않는다', () => {
    const dir = repo();
    run(dir, onboard, { NERV_TOKEN: 'sk-test' });
    const { out } = run(dir, ['--codex', '--check'], { NERV_TOKEN: 'sk-test' });
    expect(out).toBe('');
  });
});

// ── E12-S03 — 플러그인이 켜져 있다는 것은 플러그인만 말할 수 있다 (2026-09-24) ──────────
//
// 세션은 훅(플러그인)으로도 MCP `nerv_bootstrap`(플러그인 없이)으로도 들어온다. 서버가 둘을
// 가르려면 훅이 자기 버전을 실어야 한다 — 포워더가 옆의 `plugin.json` 에서 읽는다.
describe('REQ-PLG-019 — 세션 훅이 플러그인 버전을 싣는다', () => {
  const script = join(here, 'bin/nerv-hook-forward');

  /** curl 을 가로채 인자를 적는다 — 실제로 무엇을 보내는지가 검사 대상이다 */
  function sentHeaders(endpoint: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-forward-'));
    const log = join(dir, 'args.txt');
    writeFileSync(join(dir, 'curl'), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${log}"\n`, {
      mode: 0o755,
    });
    execFileSync(script, [endpoint], {
      cwd: dir,
      input: '{"session_id":"S-1"}',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}`, NERV_SERVER: 'http://x' },
    });
    const args = readFileSync(log, 'utf8').split('\n');
    return args.filter((_, i) => args[i - 1] === '--header');
  }

  const version = (JSON.parse(file('.claude-plugin/plugin.json')) as { version: string }).version;

  it('session 훅은 plugin.json 의 버전을 `X-NERV-Plugin` 으로 싣는다', () => {
    expect(sentHeaders('session')).toContain(`X-NERV-Plugin: ${version}`);
  });

  it('다른 훅은 싣지 않는다 — 같은 세션이라 읽는 곳이 없다', () => {
    for (const endpoint of ['tool', 'stop', 'session-end']) {
      expect(sentHeaders(endpoint).some((h) => h.startsWith('X-NERV-Plugin'))).toBe(false);
    }
  });
});

// ── E20-S01 — Codex 에서도 NERV 훅이 돈다 (2026-10-16 · 4.6 §5.4) ─────────────────────────────
//
// Codex 0.162.1 은 같은 매니페스트 · 같은 hooks.json 으로 플러그인을 설치한다. 2026-10-15 실측에서 훅은 하나도 돌지
// 않았고(`$comment`), 살려 보니 Codex 세션이 Claude Code 세션으로 기록됐다. 아래는 그 자리를 실제로 실행해 본다.
describe('REQ-PLG-035 — Codex 도 같은 hooks.json 을 읽는다', () => {
  const parsed = JSON.parse(file('hooks/hooks.json')) as Record<string, unknown> & {
    hooks: Record<string, Record<string, unknown>[]>;
  };

  it('최상위에는 description · hooks 만 둔다 — Codex 는 모르는 키가 있으면 훅 전체를 버린다', () => {
    expect(Object.keys(parsed).sort()).toEqual(['description', 'hooks']);
    expect(file('hooks/hooks.json')).not.toContain('$comment');
  });

  it('훅 항목에도 실행에 쓰는 키만 둔다', () => {
    for (const [event, groups] of Object.entries(parsed.hooks)) {
      for (const group of groups) {
        for (const key of Object.keys(group)) expect(['matcher', 'hooks'], event).toContain(key);
        for (const hook of group['hooks'] as Record<string, unknown>[]) {
          for (const key of Object.keys(hook)) {
            expect(['type', 'command', 'timeout', 'async'], `${event}.${key}`).toContain(key);
          }
        }
      }
    }
  });

  it('SessionEnd 시한은 3초 이하다 — Codex 가 그보다 길면 줄이고 경고를 남긴다', () => {
    for (const group of parsed.hooks['SessionEnd'] ?? []) {
      for (const hook of group['hooks'] as { timeout: number }[]) {
        expect(hook.timeout).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('REQ-PLG-034 — 포워더가 누가 부르는지 싣는다', () => {
  const script = join(here, 'bin/nerv-hook-forward');

  /**
   * curl 을 가로채 인자를 적고 서버 응답 하나를 흉내 낸다. 러너의 환경(Claude Code 안에서 돌면 `CLAUDECODE` 가
   * 있다)이 판정에 새어 들어오지 않게 판정에 쓰는 두 변수를 비우고 시작한다.
   */
  function send(
    args: string[],
    env: Record<string, string> = {},
    input = '{"session_id":"S-1"}',
  ): { headers: string[]; args: string[]; stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-agent-'));
    const log = join(dir, 'args.txt');
    writeFileSync(
      join(dir, 'curl'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${log}"\nprintf '{"ok":true}\\n200'\n`,
      { mode: 0o755 },
    );
    const stdout = execFileSync(script, args, {
      cwd: dir,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
        NERV_SERVER: 'http://x',
        NERV_AGENT_TYPE: '',
        PLUGIN_ROOT: '',
        ...env,
      },
    });
    const sent = readFileSync(log, 'utf8').split('\n');
    return { headers: sent.filter((_, i) => sent[i - 1] === '--header'), args: sent, stdout };
  }

  it('Claude Code 가 부르면 claude-code 다 — 모든 훅에 싣는다', () => {
    for (const endpoint of ['session', 'tool', 'subagent', 'stop', 'session-end']) {
      expect(send([endpoint]).headers, endpoint).toContain('X-NERV-Agent: claude-code');
    }
  });

  it('Codex 가 부르면(PLUGIN_ROOT) codex 다 — Claude Code 의 셸에서 띄웠어도', () => {
    const codex = { PLUGIN_ROOT: '/home/u/.codex/plugins/cache/nerv/nerv/0.3.32', CLAUDECODE: '1' };
    for (const endpoint of ['session', 'tool', 'stop', 'session-end']) {
      expect(send([endpoint], codex).headers, endpoint).toContain('X-NERV-Agent: codex');
    }
  });

  it('사람이 정한 NERV_AGENT_TYPE 이 이긴다', () => {
    const pinned = { PLUGIN_ROOT: '/p', NERV_AGENT_TYPE: 'claude-code' };
    expect(send(['session'], pinned).headers).toContain('X-NERV-Agent: claude-code');
  });

  it('SessionEnd 는 2초 안에 끝낸다 — Codex 의 시한(3초) 안에 든다', () => {
    const end = send(['session-end']).args;
    expect(end[end.indexOf('--max-time') + 1]).toBe('2');
    const tool = send(['tool']).args;
    expect(tool[tool.indexOf('--max-time') + 1]).toBe('5');
  });

  it('응답 JSON 을 판정으로 흘린다 — 훅 출력 자리다', () => {
    expect(send(['stop']).stdout).toBe('{"ok":true}');
  });
});

describe('REQ-PLG-036 — Codex 가 부른 --check 는 config.toml 을 본다', () => {
  const script = join(here, 'bin/nerv-init');

  function check(dir: string, env: Record<string, string>): string {
    return execFileSync(script, ['--dir', dir, '--check'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NERV_SERVER: '',
        NERV_PROJECT: '',
        NERV_TOKEN: '',
        NERV_AGENT_TYPE: '',
        PLUGIN_ROOT: '/home/u/.codex/plugins/cache/nerv/nerv/0.3.32',
        // 사람의 실제 설정을 읽지 않게 빈 자리를 가리킨다
        CODEX_HOME: mkdtempSync(join(tmpdir(), 'codex-home-')),
        ...env,
      },
    });
  }

  /** 온보딩을 마친 모양 — 훅의 서버 주소(`.nerv/env`)와 사람이 쓴 AGENTS.md 가 있다(2026-10-16 · E20-S04 가 둘도 본다) */
  function codexRepo(config: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-codex-'));
    mkdirSync(join(dir, '.nerv'));
    writeFileSync(join(dir, '.nerv/env'), 'NERV_SERVER=https://api.test\n');
    writeFileSync(join(dir, 'AGENTS.md'), '# 사람이 쓴 규약\n');
    if (config) {
      mkdirSync(join(dir, '.codex'));
      writeFileSync(
        join(dir, '.codex/config.toml'),
        '[mcp_servers.nerv]\nurl = "https://api.test/mcp"\nbearer_token_env_var = "NERV_TOKEN"\n',
      );
    }
    return dir;
  }

  it('MCP 가 config.toml 로 붙은 Codex 세션에 .mcp.json 을 재촉하지 않는다 — 2026-10-15 실측의 잘못된 안내', () => {
    expect(check(codexRepo(true), { NERV_TOKEN: 'sk', NERV_PROJECT: 'clemvion' })).toBe('');
  });

  it('사용자 설정의 nerv 서버도 붙은 것으로 본다', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(home, 'config.toml'), '[mcp_servers.nerv]\nurl = "https://api.test/mcp"\n');
    const out = check(codexRepo(false), {
      CODEX_HOME: home,
      NERV_TOKEN: 'sk',
      NERV_PROJECT: 'clemvion',
    });
    expect(out).toBe('');
  });

  /** 2026-10-16(E20-S04)부터 안내는 템플릿 복사가 아니라 Codex 온보딩(`nerv-init --codex`)이다 — Claude Code 의 자리는 권하지 않는다 */
  it('없으면 config.toml 을 말하고 Codex 온보딩을 가리킨다 — .mcp.json 을 권하지 않는다', () => {
    const out = check(codexRepo(false), { NERV_TOKEN: 'sk', NERV_PROJECT: 'clemvion' });
    expect(out).toContain('[mcp_servers.nerv] 가 없다');
    expect(out).toContain('/home/u/.codex/plugins/cache/nerv/nerv/0.3.32/bin/nerv-init" --codex');
    expect(out).toContain('NERV_TOKEN 은 셸 환경변수로');
    expect(out).not.toContain('.mcp.json');
  });

  it('토큰이 .nerv/env 에만 있으면 그렇다고 말한다 — Codex 의 MCP 인증은 그 파일을 읽지 않는다', () => {
    const dir = codexRepo(true);
    writeFileSync(join(dir, '.nerv/env'), 'NERV_TOKEN=sk-file\nNERV_PROJECT=clemvion\n');
    expect(check(dir, {})).toContain('NERV_TOKEN 이 Codex 의 환경에 없다');
  });
});

/**
 * **설치하면 플러그인 폴더가 그대로 복사된다**(2026-10-15 실측 · 4.6 §5.4). Codex 는 로컬 경로든 Git 이든 카탈로그가
 * 가리키는 폴더를 통째로 캐시에 옮겼다 — 테스트 파일과 워크스페이스 표기, 로컬 경로면 `node_modules` 까지. 그래서
 * 테스트와 `package.json` 은 이 폴더(plugin-test)에 두고 플러그인 폴더에는 배달되는 파일만 둔다.
 */
describe('REQ-PLG-037 — 플러그인 폴더에는 배달되는 파일만 둔다', () => {
  it('git 이 추적하는 플러그인 파일에 테스트 · 워크스페이스 표기가 없다', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'codebase/plugin'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f !== '');
    expect(tracked.length).toBeGreaterThan(0);
    for (const path of tracked) {
      expect(path, `${path} 는 배달되지 않는 파일이다`).not.toMatch(
        /\.spec\.ts$|\/package\.json$|\/node_modules\//,
      );
    }
  });
});

// ── E20-S02 — Codex notify 를 받는다 (2026-10-16 · 4.6 §5.2) ──────────────────────────────────
describe('REQ-PLG-038 — Codex notify 를 포워더로 보낸다', () => {
  const forward = join(here, 'bin/nerv-hook-forward');
  const toml = () => file('codex/config.toml');

  /** NERV 를 설정한 저장소 — `.nerv/env` 하나로 충분하다(`nerv_repo_configured`) */
  function configuredRepo(env = 'NERV_PROJECT=clemvion\n'): string {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-notify-repo-'));
    mkdirSync(join(dir, '.nerv'));
    writeFileSync(join(dir, '.nerv/env'), env);
    return dir;
  }

  /**
   * 포워더를 notify 로 부른다. curl 을 가로채 인자를 적는다 — 보내지 않았으면 기록 파일이 없다. 러너의 환경이 새어
   * 들어오지 않게 판정에 쓰는 값을 비우고 시작한다.
   */
  function notify(
    cwd: string,
    payload: string,
    env: Record<string, string> = {},
  ): { sent: string[] | null; stdout: string } {
    const bin = mkdtempSync(join(tmpdir(), 'nerv-notify-bin-'));
    const log = join(bin, 'args.txt');
    writeFileSync(
      join(bin, 'curl'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${log}"\nprintf '{"ok":true}\\n202'\n`,
      { mode: 0o755 },
    );
    const stdout = execFileSync(forward, ['--event', 'notify', payload], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        NERV_SERVER: 'http://x',
        NERV_TOKEN: 'sk-test',
        NERV_PROJECT: '',
        NERV_AGENT_TYPE: '',
        NERV_ENV_FILE: '',
        PLUGIN_ROOT: '',
        ...env,
      },
    });
    return { sent: existsSync(log) ? readFileSync(log, 'utf8').split('\n') : null, stdout };
  }

  it('포워더는 notify 를 인자로 받아 codex 로 보내고 아무것도 출력하지 않는다', () => {
    const payload = '{"type":"agent-turn-complete","thread-id":"T-1"}';
    const { sent, stdout } = notify(configuredRepo(), payload);
    expect(sent).not.toBeNull();
    expect(sent).toContain('http://x/ingest/hooks/notify');
    expect(sent).toContain('X-NERV-Agent: codex');
    expect(sent![sent!.indexOf('--data') + 1]).toBe(payload);
    // Codex 는 notify 의 출력을 읽지 않는다 — 판정 JSON 을 흘리지 않는다
    expect(stdout).toBe('');
  });

  /**
   * **사용자 설정의 notify 는 모든 저장소의 턴에 불린다**(2026-10-16 · 묶음 11c 가 남긴 결함). 예전에는 셸에 토큰이 있으면
   * NERV 를 쓰지 않는 저장소의 답변까지 서버로 나갔다 — 서버가 세션을 못 찾아 버려도 전송은 됐다.
   */
  it('NERV 설정이 없는 디렉터리의 턴은 보내지 않는다 — 셸에 토큰이 있어도', () => {
    const plain = mkdtempSync(join(tmpdir(), 'plain-repo-'));
    writeFileSync(join(plain, 'AGENTS.md'), '# 다른 저장소\n');
    const { sent, stdout } = notify(plain, '{"type":"agent-turn-complete","thread-id":"T-2"}');
    expect(sent).toBeNull();
    expect(stdout).toBe('');
  });

  it('저장소의 config.toml 이나 .mcp.json 에 nerv 서버가 있으면 NERV 를 설정한 저장소다', () => {
    const codex = mkdtempSync(join(tmpdir(), 'codex-repo-'));
    mkdirSync(join(codex, '.codex'));
    writeFileSync(
      join(codex, '.codex/config.toml'),
      '[mcp_servers.nerv]\nurl = "https://api.test/mcp"\n',
    );
    expect(notify(codex, '{"type":"agent-turn-complete"}').sent).not.toBeNull();

    const claude = mkdtempSync(join(tmpdir(), 'claude-repo-'));
    writeFileSync(join(claude, '.mcp.json'), '{ "mcpServers": { "nerv": {} } }\n');
    expect(notify(claude, '{"type":"agent-turn-complete"}').sent).not.toBeNull();

    // 다른 MCP 서버만 있는 config.toml 은 아니다
    const other = mkdtempSync(join(tmpdir(), 'other-repo-'));
    mkdirSync(join(other, '.codex'));
    writeFileSync(
      join(other, '.codex/config.toml'),
      '[mcp_servers.github]\nurl = "https://x/mcp"\n',
    );
    expect(notify(other, '{"type":"agent-turn-complete"}').sent).toBeNull();
  });

  it('토큰이 없으면 보내지 않는다', () => {
    expect(
      notify(configuredRepo(), '{"type":"agent-turn-complete"}', { NERV_TOKEN: '' }).sent,
    ).toBeNull();
  });

  /** 판정 자리는 그 턴의 작업 디렉터리다 — Codex 가 알림에 `cwd` 를 넣어 준다. 그 저장소의 `.nerv/env` 를 읽는다 */
  it('알림의 cwd 로 판정하고 그 저장소의 .nerv/env 를 읽는다', () => {
    const repo = configuredRepo('NERV_SERVER=http://from-env\nNERV_PROJECT=clemvion\n');
    const elsewhere = mkdtempSync(join(tmpdir(), 'codex-cwd-'));
    const payload = `{"type":"agent-turn-complete","thread-id":"T-3","cwd":"${repo}"}`;
    const { sent } = notify(elsewhere, payload, { NERV_SERVER: '' });
    expect(sent).toContain('http://from-env/ingest/hooks/notify');
    expect(sent).toContain('X-NERV-Project: clemvion');

    // 거꾸로 — 프로세스가 NERV 저장소에서 돌아도 그 턴이 다른 저장소의 것이면 보내지 않는다
    const plain = mkdtempSync(join(tmpdir(), 'plain-cwd-'));
    const away = `{"type":"agent-turn-complete","thread-id":"T-4","cwd":"${plain}"}`;
    expect(notify(repo, away).sent).toBeNull();
  });

  it('템플릿의 최상위 키는 표 이름 앞에 있다 — 뒤에 두면 그 표의 키가 되어 Codex 가 무시한다', () => {
    const lines = toml().split('\n');
    const firstTable = lines.findIndex((l) => l.startsWith('['));
    for (const key of ['approval_policy', 'sandbox_mode']) {
      const at = lines.findIndex((l) => l.startsWith(`${key} =`));
      expect(at, key).toBeGreaterThan(-1);
      expect(at, key).toBeLessThan(firstTable);
    }
    // 저장소 설정의 notify · [otel] 은 Codex 가 무시한다 — 템플릿에는 주석으로만 둔다
    expect(lines.some((l) => l.startsWith('notify'))).toBe(false);
    expect(lines.some((l) => l.startsWith('[otel]'))).toBe(false);
  });

  /** 템플릿이 사용자 설정에 옮겨 적으라는 notify 줄 — `sh -c '<스크립트>' nerv-notify` */
  function notifyScript(): string {
    const m = /^# notify = \["sh", "-c", '(.*)', "nerv-notify"\]$/m.exec(toml());
    if (m === null) throw new Error('템플릿에 notify 줄이 없다');
    return m[1]!;
  }

  it('그 줄이 설치 캐시의 포워더를 찾아 알림 JSON 을 넘긴다', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    const bin = join(home, 'plugins/cache/nerv/nerv/0.3.32/bin');
    mkdirSync(bin, { recursive: true });
    const log = join(home, 'forward.txt');
    writeFileSync(join(bin, 'nerv-hook-forward'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`, {
      mode: 0o755,
    });
    const payload = '{"type":"agent-turn-complete"}';
    execFileSync('sh', ['-c', notifyScript(), 'nerv-notify', payload], {
      env: { PATH: process.env['PATH'] ?? '', HOME: '/nonexistent', CODEX_HOME: home },
    });
    expect(readFileSync(log, 'utf8').split('\n')).toEqual(['--event', 'notify', payload, '']);
  });

  it('플러그인이 없으면 아무것도 하지 않고 성공한다', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    const out = execFileSync('sh', ['-c', notifyScript(), 'nerv-notify', '{}'], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', HOME: '/nonexistent', CODEX_HOME: home },
    });
    expect(out).toBe('');
  });
});
