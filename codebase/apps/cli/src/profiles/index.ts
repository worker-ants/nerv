// 프로파일 로더 — 내장 2종 + 사용자 정의 파일.
//
// 프로파일은 **클라이언트 것이다**(importer.md §1.4 경계 1). 서버는 해석하지 않고 이름만
// 기록한다 — 서버가 원본 파일도 파싱 규칙도 알 필요가 없다는 것이 §3.2 구조의 전제다.

import { t } from '../i18n.js';
import { readFileSync } from 'node:fs';
import { importProfileSchema } from '@nerv/schema';
import type { ImportProfile } from '@nerv/schema';
import { clemvionProfile } from './clemvion.js';
import { nervDocsProfile } from './nerv-docs.js';

export const BUILTIN_PROFILES: Record<string, ImportProfile> = {
  clemvion: clemvionProfile,
  'nerv-docs': nervDocsProfile,
};

/**
 * 프로파일을 읽지 못했다 — **시작 전에 멈추는 실패**다(REQ-IMP-025).
 *
 * 보통의 예외와 갈라 두는 이유는 종료 코드다: 이것은 "완료했으나 수동 확인" 이 아니라
 * **중단**(2)이고, 그 사실이 리포트에도 한 줄로 남아야 한다. 예전에는 리포트 없이 죽어
 * 종료 코드 1 로 나갔다 — 가장 흔한 실패(프로파일 이름 오타)가 그렇게 오독됐다.
 */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

export function loadBuiltin(name: string): ImportProfile {
  const profile = BUILTIN_PROFILES[name];
  if (profile === undefined) {
    throw new ProfileError(
      t()('cli.err.unknown_profile', {
        name,
        available: Object.keys(BUILTIN_PROFILES).join(', '),
      }),
    );
  }
  return profile;
}

/**
 * 사용자 정의 프로파일 — `--profile-file`. **스키마 검증을 거친다**:
 * 잘못된 프로파일로 135개 파일을 잘못 매핑하는 것보다 시작 전에 멈추는 편이 싸다.
 */
export function loadProfileFile(path: string): ImportProfile {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = path.endsWith('.json') ? JSON.parse(raw) : parseSimpleYaml(raw);
  const result = importProfileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProfileError(
      t()('cli.err.profile_schema', { path, issues: JSON.stringify(result.error.issues) }),
    );
  }
  return result.data;
}

/**
 * 최소 YAML 파서 — 프로파일이 쓰는 부분집합(중첩 맵·문자열 배열·스칼라)만 읽는다.
 * 전용 의존성을 하나 더 들이지 않기 위한 절충이고, 지원 범위 밖 문법은 조용히 넘기지 않고 던진다.
 */
export function parseSimpleYaml(text: string): unknown {
  const root: Record<string, unknown> = {};
  // `owner`·`key` 는 이 프레임을 연 자리다 — 다음 줄이 `- item` 이면 그 자리를 배열로 바꾼다
  const stack: {
    indent: number;
    node: Record<string, unknown>;
    owner?: Record<string, unknown>;
    key?: string;
  }[] = [{ indent: -1, node: root }];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    while (stack.length > 1 && indent <= (stack.at(-1)?.indent ?? -1)) stack.pop();
    const parent = stack.at(-1)?.node ?? root;

    // 블록 리스트 — `key:` 다음 줄부터 `- item` 이 이어지는 모양(frontmatter 와 같은 규칙).
    // 빈 값 뒤에 오는 것이 배열인지 중첩 맵인지는 **다음 줄이 정한다**: 먼저 오는 쪽이
    // 그 자리를 쓴다. `- ` 가 왔으면 열어 둔 빈 맵을 배열로 바꾼다.
    if (content.startsWith('- ')) {
      const frame = stack.at(-1);
      if (frame?.owner === undefined || frame.key === undefined) {
        throw new ProfileError(t()('cli.err.profile_yaml', { content }));
      }
      if (!Array.isArray(frame.owner[frame.key])) frame.owner[frame.key] = [];
      (frame.owner[frame.key] as unknown[]).push(parseScalar(content.slice(2).trim()));
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(content);
    if (match === null) throw new ProfileError(t()('cli.err.profile_yaml', { content }));

    const [, key, value] = match;
    if (key === undefined) continue;

    if (value === undefined || value === '') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, node: child, owner: parent, key });
      continue;
    }
    parent[key] = parseScalar(value);
  }
  return root;
}

function parseScalar(value: string): unknown {
  if (value.startsWith('[') || value.startsWith('{')) return parseInline(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, '');
}

/**
 * 인라인 맵·배열 — **YAML 이지 JSON 이 아니다**(2026-09-07 · REQ-IMP-029).
 *
 * 예전에는 `JSON.parse(value.replaceAll("'", '"'))` 였다. 따옴표 없는 키를 JSON 은 받지
 * 않으므로 `{ implemented: 117 }` 이 `Expected property name` 으로 죽었고 — **§1.4 의
 * 유일한 프로파일 예시가 첫 인라인 맵에서 그렇게 죽었다.** 문서가 보여 주는 대로 쓴
 * 사람은 자기 파일이 잘못됐다고 읽는다.
 *
 * 작은 토크나이저를 두는 이유는 의존성 하나가 이 CLI 의 성질을 깨기 때문이다 — `@nerv/schema`
 * 밖을 의존하지 않는다. 지원 범위는 프로파일이 실제로 쓰는 것뿐이고(중첩 포함), 밖은
 * 조용히 넘기지 않고 던진다.
 */
function parseInline(text: string): unknown {
  const tokens = text.match(/[[\]{}:,]|"[^"]*"|'[^']*'|[^[\]{}:,\s][^[\]{}:,]*/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string => tokens[at++] ?? '';

  function value(): unknown {
    const token = peek();
    if (token === '[') return list();
    if (token === '{') return map();
    return scalar(take());
  }
  function list(): unknown[] {
    take(); // [
    const out: unknown[] = [];
    while (peek() !== undefined && peek() !== ']') {
      if (peek() === ',') {
        take();
        continue;
      }
      out.push(value());
    }
    take(); // ]
    return out;
  }
  function map(): Record<string, unknown> {
    take(); // {
    const out: Record<string, unknown> = {};
    while (peek() !== undefined && peek() !== '}') {
      if (peek() === ',') {
        take();
        continue;
      }
      const key = String(scalar(take()));
      if (peek() === ':') take();
      out[key] = value();
    }
    take(); // }
    return out;
  }
  function scalar(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed.slice(1, -1);
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }

  const parsed = value();
  // 남은 토큰이 있으면 우리가 읽지 못한 문법이다 — 절반만 읽고 통과시키지 않는다
  if (at !== tokens.length) throw new ProfileError(t()('cli.err.profile_yaml', { content: text }));
  return parsed;
}
