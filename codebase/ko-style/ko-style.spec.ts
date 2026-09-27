// ko-style 플러그인 — 규칙 · 생성물 · 훅을 실제로 돌려 본다 (4.6 §7 · REQ-PLG-020~026)
//
// **규칙은 예문이 증명한다.** 규칙마다 걸려야 할 예문(bad)과 걸리지 않아야 할 예문(good)을
// 적게 하고 여기서 전부 돌린다. 정규식 하나를 고쳐 다른 예문이 새로 걸리거나 빠지면 바로
// 보인다 — 한국어는 조사 · 어미가 붙어 쓰여서 규칙 하나가 엉뚱한 말을 잡는 일이 흔하다.
//
// **훅은 실제로 실행한다.** `sh hooks/run.sh <이벤트>` 에 훅 입력 JSON 을 넣고 출력 JSON 을
// 본다. 파일만 대조하면 "node 가 없을 때" · "같은 메시지로 다시 실행할 때" 같은 갈림길을
// 셀 수 없다.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RULES_BEGIN,
  RULES_END,
  compileRules,
  lint,
  loadCoreRules,
  maskText,
  messagesOf,
  settingsOf,
  skillRulesTable,
  staticDigestJson,
  toneOf,
} from './skills/ko-style/scripts/ko-lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const RUN = join(here, 'hooks', 'run.sh');

type Rule = {
  id: string;
  custom?: string;
  examples?: { bad: string[]; good: string[] };
};
type Finding = { id: string; level: string; line: number; match: string };

const core = loadCoreRules() as Rule[];
const repoConfig = JSON.parse(readFileSync(join(repoRoot, '.ko-style.json'), 'utf8')) as {
  team: Rule[];
};

function ids(text: string, config: object = {}, opts: object = {}): string[] {
  const rules = compileRules(core, settingsOf(config));
  return (lint(text, { rules, ...opts }) as Finding[]).map((f) => f.id);
}

describe('REQ-PLG-021 — 규칙은 예문이 증명한다', () => {
  const exampled = core.filter((r) => !r.custom || r.custom === 'dash');

  it.each(exampled.map((r) => [r.id, r] as const))('%s 공통 규칙', (id, rule) => {
    expect(rule.examples?.bad.length, `${id} 에 걸려야 할 예문이 없다`).toBeGreaterThan(0);
    for (const bad of rule.examples?.bad ?? []) expect(ids(bad), bad).toContain(id);
    for (const good of rule.examples?.good ?? []) expect(ids(good), good).not.toContain(id);
  });

  it.each(repoConfig.team.map((r) => [r.id, r] as const))('%s 이 저장소의 팀 어휘', (id, rule) => {
    expect(rule.examples?.bad.length, `${id} 에 걸려야 할 예문이 없다`).toBeGreaterThan(0);
    for (const bad of rule.examples?.bad ?? []) expect(ids(bad, repoConfig), bad).toContain(id);
    for (const good of rule.examples?.good ?? [])
      expect(ids(good, repoConfig), good).not.toContain(id);
  });

  it('규칙 ID 가 겹치지 않는다', () => {
    const all = [...core, ...repoConfig.team].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('검사하지 않는 자리 — 코드 · 링크 · 인용', () => {
  it('코드 블록 · 인라인 코드 · 링크 주소 · URL 은 검사하지 않는다', () => {
    const md = [
      '```',
      '이 작업은 권한을 필요로 한다',
      '```',
      '`필요로 한다` 는 예시다. [링크](https://x.example/필요로-한다)',
      'https://x.example/필요로한다',
    ].join('\n');
    expect(ids(md)).not.toContain('KO-N-03');
  });

  it('따옴표 안은 인용으로 보고 건너뛴다 — 쓰지 않는 표현을 설명하는 글이 스스로 걸리지 않게', () => {
    expect(ids('"권한을 필요로 한다" 대신 "권한이 필요하다" 로 쓴다.')).not.toContain('KO-N-03');
    expect(ids('「권한을 필요로 한다」 는 번역투다.')).not.toContain('KO-N-03');
  });

  it('위치는 그대로 둔다 — 가린 뒤에도 줄 번호가 맞는다', () => {
    const text = '`코드`\n둘째 줄은 권한을 필요로 한다.';
    expect(maskText(text).split('\n')).toHaveLength(2);
    const rules = compileRules(core, settingsOf({}));
    const [f] = lint(text, { rules }) as Finding[];
    expect(f?.line).toBe(2);
  });

  it('NFD 로 들어온 글도 잡는다 — macOS 파일 이름 · 붙여 넣기에서 생긴다', () => {
    expect(ids('이 작업은 권한을 필요로 한다.'.normalize('NFD'))).toContain('KO-N-03');
  });

  it('줄 끝의 ko-style-ignore: <이유> 는 그 줄만 뺀다 — 이유가 없으면 빼지 않는다', () => {
    const line = '이 작업은 권한을 필요로 한다.';
    expect(ids(`${line} <!-- ko-style-ignore: 인용한 옛 문장 -->`)).not.toContain('KO-N-03');
    expect(ids(`${line} // ko-style-ignore: 예문`)).not.toContain('KO-N-03');
    expect(ids(`${line} <!-- ko-style-ignore: -->`)).toContain('KO-N-03');
    expect(ids(`${line} <!-- ko-style-ignore: 예문 -->\n${line}`)).toContain('KO-N-03');
  });

  it('한글 경계 — "머리말" · "전기 배선" 은 팀 어휘에 걸리지 않는다', () => {
    expect(ids('머리말에 버전을 적는다.', repoConfig)).not.toContain('KO-V-09');
    expect(ids('전기 배선을 점검한다.', repoConfig)).not.toContain('KO-V-04');
    expect(ids('실은 그렇지 않다.', repoConfig)).not.toContain('KO-V-03');
  });
});

describe('말투 · 줄표 · 빈도 — 문장 단위 규칙', () => {
  it('합쇼체는 ㅂ 받침 + "니다" 다 — "아니다" 는 해라체다', () => {
    expect(toneOf('저장합니다.')).toBe('hapsyo');
    expect(toneOf('기준입니다.')).toBe('hapsyo');
    expect(toneOf('그것은 기준이 아니다.')).toBe('haera');
    expect(toneOf('다시 시도하세요.')).toBe('request');
    expect(toneOf('저장했어요.')).toBe('haeyo');
    expect(toneOf('저장됨')).toBeNull();
  });

  it('글 종류가 합쇼체면 해라체 · 해요체 문장을 잡고 "-세요" 요청은 둔다', () => {
    const text = '설정을 저장합니다. 다시 시도하세요. 결과를 확인한다. 저장했어요.';
    const found = ids(text, {}, { tone: 'hapsyo' }).filter((id) => id === 'KO-T-01');
    expect(found).toHaveLength(2);
  });

  it('제목과 표는 문장이 아니다 — 말투를 판정하지 않는다', () => {
    expect(ids('# 설정을 바꾼다.\n| 칸 | 값을 바꾼다. |', {}, { tone: 'hapsyo' })).not.toContain(
      'KO-T-01',
    );
  });

  it('줄표는 앞이 절일 때만 잡는다 — 부제와 이름표는 규범이 허용한다', () => {
    expect(ids('서버는 이유를 담는다 — 화면에는 그 이유가 표시된다.')).toContain('KO-P-01');
    expect(ids('관계 그래프 — 문서가 늘어도 형태가 그대로다')).not.toContain('KO-P-01');
    expect(ids('- **동적 강화** — 티어를 한 단계 올린다.')).not.toContain('KO-P-01');
    expect(ids('- `draft` — 초안이다.')).not.toContain('KO-P-01');
    expect(
      ids('서버는 이유를 담는다 — 화면에는 그 이유가 표시된다.', {}, { dash: 'off' }),
    ).not.toContain('KO-P-01');
  });

  it('빈도 규칙은 비율도 본다 — 긴 글의 쉼표 몇 개는 사람도 쓴다', () => {
    const plain = Array.from({ length: 40 }, (_, i) => `${i}번 항목을 확인했다.`).join(' ');
    const three = '늘었지만, 그대로다. 바꿨는데, 같았다. 확인해서, 올렸다.';
    expect(ids(three)).toContain('KO-A-02');
    expect(ids(`${three} ${plain}`)).not.toContain('KO-A-02');
  });
});

describe('REQ-PLG-022 — 모델이 읽는 글은 규칙 표에서 만든다', () => {
  it('SKILL.md 의 규칙 표가 rules/core.json 과 같다 (ko-lint.mjs sync)', () => {
    const skill = readFileSync(join(here, 'skills/ko-style/SKILL.md'), 'utf8');
    const block = skill
      .slice(skill.indexOf(RULES_BEGIN) + RULES_BEGIN.length, skill.indexOf(RULES_END))
      .trim();
    expect(block).toBe(skillRulesTable());
  });

  it('hooks/digest.json 이 rules/core.json 과 같다 (ko-lint.mjs sync)', () => {
    expect(readFileSync(join(here, 'hooks/digest.json'), 'utf8')).toBe(staticDigestJson());
  });

  it('SKILL.md 가 스스로 걸리지 않는다 — 예문은 따옴표 안에 있다', () => {
    const skill = readFileSync(join(here, 'skills/ko-style/SKILL.md'), 'utf8');
    const strong = (
      lint(skill, { rules: compileRules(core, settingsOf(repoConfig)), tone: 'haera' }) as Finding[]
    ).filter((f) => f.level !== 'hint');
    expect(strong).toEqual([]);
  });
});

// ── 훅 ──────────────────────────────────────────────────────────────────────

function tempRepo(config?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'ko-style-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (config) writeFileSync(join(dir, '.ko-style.json'), JSON.stringify(config));
  return dir;
}

/** 훅이 내는 JSON — 테스트가 읽는 필드만 적는다 */
type HookOut = {
  decision?: string;
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
};

function hook(event: string, input: object, env: Record<string, string> = {}) {
  const data =
    (env['CLAUDE_PLUGIN_DATA'] as string | undefined) ??
    mkdtempSync(join(tmpdir(), 'ko-style-data-'));
  const res = spawnSync('/bin/sh', [RUN, event], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data, ...env },
    encoding: 'utf8',
  });
  expect(res.status, res.stderr).toBe(0);
  const out = res.stdout.trim();
  return { data, out: out ? (JSON.parse(out) as HookOut) : null };
}

const commit = (message: string) =>
  `git commit -m "$(cat <<'EOF'\n${message}\n\nCo-Authored-By: x <x@example.com>\nEOF\n)"`;

describe('REQ-PLG-020 — 세션 요약', () => {
  it('SessionStart 는 요약을 additionalContext 로 넣는다 — Codex 상한(약 2,500토큰) 안이다', () => {
    const repo = tempRepo();
    const { out } = hook('session-start', { cwd: repo, hook_event_name: 'SessionStart' });
    const text = out?.['hookSpecificOutput']?.['additionalContext'] as string;
    expect(out?.['hookSpecificOutput']?.['hookEventName']).toBe('SessionStart');
    expect(text).toContain('ko-style');
    expect(text.length).toBeLessThan(4000);
  });

  it('저장소 설정의 팀 어휘와 글 종류별 말투가 요약에 들어간다', () => {
    const repo = tempRepo({
      surfaces: [{ name: '도움말', files: ['help/*.md'], tone: 'hapsyo' }],
      team: [{ id: 'T-1', name: '싣다', avoid: ['싣는다'], use: '포함한다' }],
    });
    const { out } = hook('subagent-start', { cwd: repo });
    const text = out?.['hookSpecificOutput']?.['additionalContext'] as string;
    expect(out?.['hookSpecificOutput']?.['hookEventName']).toBe('SubagentStart');
    expect(text).toContain('싣다');
    expect(text).toContain('도움말');
  });

  it('node 가 없으면 미리 만든 요약만 넣는다 — 검사는 돌지 않는다고 적는다', () => {
    const bin = mkdtempSync(join(tmpdir(), 'ko-style-bin-'));
    for (const tool of ['cat', 'dirname']) {
      const found = ['/bin', '/usr/bin'].map((d) => join(d, tool)).find((p) => existsSync(p));
      if (found) symlinkSync(found, join(bin, tool));
    }
    const { out } = hook('session-start', { cwd: tempRepo() }, { PATH: bin });
    expect(out?.['hookSpecificOutput']?.['additionalContext']).toContain('node 가 없어서');
  });

  it('"enabled": false 인 저장소와 KO_STYLE_DISABLE=1 에서는 아무것도 하지 않는다', () => {
    expect(hook('session-start', { cwd: tempRepo({ enabled: false }) }).out).toBeNull();
    expect(hook('session-start', { cwd: tempRepo() }, { KO_STYLE_DISABLE: '1' }).out).toBeNull();
  });
});

describe('REQ-PLG-023 — 커밋 · PR 명령 전 검사', () => {
  it('걸리면 한 번 거부하고, 같은 메시지로 다시 실행하면 통과한다', () => {
    const repo = tempRepo();
    const input = {
      cwd: repo,
      tool_input: { command: commit('fix: 이 작업은 권한을 필요로 한다') },
    };
    const first = hook('pre-bash', input);
    const hso = first.out?.['hookSpecificOutput'];
    expect(hso?.['permissionDecision']).toBe('deny');
    expect(hso?.['permissionDecisionReason']).toContain('KO-N-03');
    const second = hook('pre-bash', input, { CLAUDE_PLUGIN_DATA: first.data });
    expect(second.out).toBeNull();
  });

  it('걸리지 않는 메시지와 커밋이 아닌 명령은 그대로 둔다', () => {
    const repo = tempRepo();
    expect(
      hook('pre-bash', { cwd: repo, tool_input: { command: commit('fix: 권한 검사를 고친다') } })
        .out,
    ).toBeNull();
    expect(hook('pre-bash', { cwd: repo, tool_input: { command: 'ls -la' } }).out).toBeNull();
  });

  it('-m · -F · gh pr 의 --title · --body 를 읽는다', () => {
    const repo = tempRepo();
    writeFileSync(join(repo, 'msg.txt'), '본문을 필요로 한다');
    const texts = (cmd: string) => (messagesOf(cmd, repo) as { text: string }[]).map((m) => m.text);
    expect(texts('git commit -m "첫 줄" -m \'둘째 줄\'')).toEqual(['첫 줄', '둘째 줄']);
    expect(texts('git commit -F msg.txt')).toEqual(['본문을 필요로 한다']);
    expect(texts('gh pr create --title "제목" --body "본문"')).toEqual(['제목', '본문']);
    expect(texts('git log -m')).toEqual([]);
  });
});

describe('REQ-PLG-024 — 문서 저장 직후 검사', () => {
  it('새로 쓴 줄만 본다 — 이전부터 있던 문장은 걸리지 않는다', () => {
    const repo = tempRepo();
    const file = join(repo, 'a.md');
    const old = '이전 문장은 권한을 필요로 한다.';
    const next = '새 문장도 설정을 필요로 한다.';
    writeFileSync(file, `${old}\n${next}\n`);
    const { out } = hook('post-edit', {
      cwd: repo,
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: old, new_string: `${old}\n${next}` },
    });
    expect(out?.['decision']).toBe('block');
    expect(out?.['reason']).toContain('2행');
    expect((out?.['reason'] as string).match(/KO-N-03/g)).toHaveLength(1);
  });

  it('Write 는 커밋된 내용과 비교한다', () => {
    const repo = tempRepo();
    const file = join(repo, 'b.md');
    writeFileSync(file, '이전 문장은 권한을 필요로 한다.\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=x@x', '-c', 'user.name=x', 'commit', '-qm', 'init'], {
      cwd: repo,
    });
    const content = '이전 문장은 권한을 필요로 한다.\n새 줄은 문제없다.\n';
    writeFileSync(file, content);
    expect(
      hook('post-edit', { cwd: repo, tool_name: 'Write', tool_input: { file_path: file, content } })
        .out,
    ).toBeNull();
  });

  it('어느 글 종류에도 들지 않거나 제외한 파일은 검사하지 않는다', () => {
    const repo = tempRepo({
      surfaces: [{ name: '문서', files: ['docs/**/*.md'] }],
      ignore: ['docs/glossary.md'],
    });
    mkdirSync(join(repo, 'docs'));
    for (const name of ['src.ts', 'docs/glossary.md']) {
      const file = join(repo, name);
      writeFileSync(file, '권한을 필요로 한다.');
      const out = hook('post-edit', {
        cwd: repo,
        tool_name: 'Write',
        tool_input: { file_path: file, content: '권한을 필요로 한다.' },
      }).out;
      expect(out, name).toBeNull();
    }
  });
});

describe('REQ-PLG-025 — 대화 답변은 알리기만 한다', () => {
  it('걸리면 사용자에게 한 줄로 알리고, 다음 요청 때 모델에게 알린 뒤 지운다', () => {
    const repo = tempRepo();
    const stop = hook('stop', {
      cwd: repo,
      session_id: 's1',
      last_assistant_message: '이 작업은 권한을 필요로 합니다.',
    });
    expect(stop.out?.['systemMessage']).toContain('ko-style');
    expect(stop.out?.['decision']).toBeUndefined(); // 다시 쓰게 하지 않는다
    const env = { CLAUDE_PLUGIN_DATA: stop.data };
    const next = hook('prompt', { cwd: repo, session_id: 's1' }, env);
    expect(next.out?.['hookSpecificOutput']?.['additionalContext']).toContain('KO-N-03');
    expect(hook('prompt', { cwd: repo, session_id: 's1' }, env).out).toBeNull();
  });

  it('"rewrite" 로 두면 한 번 다시 쓰게 하고, 이어 쓰는 중에는 다시 막지 않는다', () => {
    const repo = tempRepo({ reply: { mode: 'rewrite' } });
    const msg = '이 작업은 권한을 필요로 합니다.';
    expect(hook('stop', { cwd: repo, last_assistant_message: msg }).out?.['decision']).toBe(
      'block',
    );
    expect(
      hook('stop', { cwd: repo, last_assistant_message: msg, stop_hook_active: true }).out,
    ).toBeNull();
  });

  it('한국어가 없는 답변과 "off" 는 보지 않는다', () => {
    expect(hook('stop', { cwd: tempRepo(), last_assistant_message: 'All done.' }).out).toBeNull();
    const off = tempRepo({ reply: { mode: 'off' } });
    expect(
      hook('stop', { cwd: off, last_assistant_message: '권한을 필요로 합니다.' }).out,
    ).toBeNull();
  });
});

// ── 패키지 ──────────────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(join(here, '.claude-plugin/plugin.json'), 'utf8')) as {
  name: string;
  version: string;
};

describe('REQ-PLG-026 — 패키지와 카탈로그', () => {
  it('버전이 네 자리에서 같다 — 매니페스트 · package.json · README · 저장소 루트 카탈로그', () => {
    const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toBe(manifest.version);
    expect(readFileSync(join(here, 'README.md'), 'utf8').split('\n')[0]).toContain(
      `v${manifest.version}`,
    );
    const catalog = JSON.parse(
      readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8'),
    ) as {
      plugins: { name: string; version: string; source: string }[];
    };
    const entry = catalog.plugins.find((p) => p.name === manifest.name);
    expect(entry?.version).toBe(manifest.version);
    expect(entry?.source).toBe('./codebase/ko-style');
  });

  it('스킬은 Agent Skills 표준 필드만 쓴다 — Codex 도 같은 파일을 읽는다', () => {
    const allowed = new Set([
      'name',
      'description',
      'license',
      'compatibility',
      'metadata',
      'allowed-tools',
    ]);
    for (const skill of ['ko-style', 'check', 'init']) {
      const text = readFileSync(join(here, 'skills', skill, 'SKILL.md'), 'utf8');
      const front = text.split('---')[1] ?? '';
      const keys = [...front.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
      for (const key of keys) expect(allowed.has(key ?? ''), `${skill}: ${key}`).toBe(true);
      expect(front).toContain(`name: ${skill}`);
      const description = /^description: (.*)$/m.exec(front)?.[1] ?? '';
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(1024);
    }
  });

  it('최상위 bin/ 이 없다 — claude.ai · Cowork 는 bin/ 이 있는 플러그인을 설치하지 않는다', () => {
    expect(existsSync(join(here, 'bin'))).toBe(false);
  });

  it('훅은 모두 run.sh 를 sh 로 부른다 — zip 이 실행 비트를 잃어도 돈다', () => {
    const hooks = JSON.parse(readFileSync(join(here, 'hooks/hooks.json'), 'utf8')) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const commands = Object.values(hooks.hooks).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => h.command)),
    );
    expect(commands.length).toBe(6);
    for (const c of commands)
      expect(c.startsWith('sh "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh" ')).toBe(true);
  });
});

describe('이 저장소(NERV)의 설정 — 용어 사전 §3.4 와 대조한다', () => {
  /**
   * 사람이 읽는 정본은 용어 사전 §3.4 표이고 `.ko-style.json` 은 검사기가 쓸 활용형을 더한
   * 사본이다. 표에 행을 더하고 설정을 잊으면 그 말은 아무도 잡지 않는다 — 반대도 같다.
   */
  it('§3.4 표의 규칙 ID 와 .ko-style.json 의 KO-V-* 가 같다', () => {
    const glossary = readFileSync(join(repoRoot, 'docs/glossary.md'), 'utf8');
    const section = glossary.slice(glossary.indexOf('### 3.4'), glossary.indexOf('## 4.'));
    const inTable = [...section.matchAll(/^\|\s*`?(KO-V-\d{2})`?\s*\|/gm)].map((m) => m[1]).sort();
    const inConfig = repoConfig.team
      .map((r) => r.id)
      .filter((id) => id.startsWith('KO-V-'))
      .sort();
    expect(inTable.length).toBeGreaterThan(0);
    expect(inConfig).toEqual(inTable);
  });
});
