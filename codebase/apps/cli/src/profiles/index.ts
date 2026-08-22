// 프로파일 로더 — 내장 2종 + 사용자 정의 파일.
//
// 프로파일은 **클라이언트 것이다**(importer.md §1.4 경계 1). 서버는 해석하지 않고 이름만
// 기록한다 — 서버가 원본 파일도 파싱 규칙도 알 필요가 없다는 것이 §3.2 구조의 전제다.

import { readFileSync } from 'node:fs';
import { importProfileSchema } from '@nerv/schema';
import type { ImportProfile } from '@nerv/schema';
import { clemvionProfile } from './clemvion.js';
import { nervDocsProfile } from './nerv-docs.js';

export const BUILTIN_PROFILES: Record<string, ImportProfile> = {
  clemvion: clemvionProfile,
  'nerv-docs': nervDocsProfile,
};

export function loadBuiltin(name: string): ImportProfile {
  const profile = BUILTIN_PROFILES[name];
  if (profile === undefined) {
    throw new Error(
      `알 수 없는 내장 프로파일: ${name} (사용 가능: ${Object.keys(BUILTIN_PROFILES).join(', ')})`,
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
    throw new Error(`프로파일 스키마 위반 (${path}): ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

/**
 * 최소 YAML 파서 — 프로파일이 쓰는 부분집합(중첩 맵·문자열 배열·스칼라)만 읽는다.
 * 전용 의존성을 하나 더 들이지 않기 위한 절충이고, 지원 범위 밖 문법은 조용히 넘기지 않고 던진다.
 */
export function parseSimpleYaml(text: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: { indent: number; node: Record<string, unknown> }[] = [{ indent: -1, node: root }];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    while (stack.length > 1 && indent <= (stack.at(-1)?.indent ?? -1)) stack.pop();
    const parent = stack.at(-1)?.node ?? root;

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(content);
    if (match === null) throw new Error(`프로파일 YAML 을 해석하지 못했습니다: ${content}`);

    const [, key, value] = match;
    if (key === undefined) continue;

    if (value === undefined || value === '') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, node: child });
      continue;
    }
    parent[key] = parseScalar(value);
  }
  return root;
}

function parseScalar(value: string): unknown {
  if (value.startsWith('[') || value.startsWith('{')) return JSON.parse(value.replaceAll("'", '"'));
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, '');
}
