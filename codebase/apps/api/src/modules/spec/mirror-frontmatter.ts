// md 미러의 frontmatter — 값은 모두 YAML 이 그대로 읽는 모양으로 쓴다 (2026-09-28 · REQ-API-245)
//
// 문자열을 이어 붙여 만들던 동안 제목의 `: ` 하나가 YAML 파싱을 깨뜨렸다(clemvion 446편 중 2편 —
// `CLE-MKS-CPIK` · `CLE-RESEARCH-COMPETITORS`). 문자열은 **JSON 문자열로** 쓴다 — JSON 문자열은
// YAML 1.2 의 큰따옴표 문자열이기도 해서 새 의존성 없이 어느 파서로든 같은 값으로 읽힌다.
// 다만 JSON 은 그대로 두는데 YAML 은 인쇄 가능한 글자로 보지 않는 것(DEL · C1 제어 문자 · BOM ·
// U+FFFE/FFFF)과 YAML 1.1 파서가 줄바꿈으로 읽는 것(NEL · U+2028/2029)은 `\uXXXX` 로 바꾼다.

export type FrontmatterValue = string | number | boolean | null | readonly string[];

const UNSAFE = /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g;

/** YAML 과 JSON 이 같은 값으로 읽는 큰따옴표 문자열 */
export function yamlString(value: string): string {
  return JSON.stringify(value).replace(
    UNSAFE,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function yamlValue(value: FrontmatterValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return yamlString(value);
  return `[${value.map(yamlString).join(', ')}]`;
}

/** 키 순서가 곧 계약이다 — 부른 쪽이 준 순서 그대로 쓴다 */
export function renderFrontmatter(
  entries: readonly (readonly [string, FrontmatterValue])[],
): string {
  return ['---', ...entries.map(([key, value]) => `${key}: ${yamlValue(value)}`), '---', ''].join(
    '\n',
  );
}
