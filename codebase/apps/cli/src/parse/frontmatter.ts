// frontmatter 파싱 + 필드 매핑 (importer.md §2.3)
//
// **원문 보존이 제1규칙이다**(§2.4) — body 는 자르거나 재작성하지 않고 그대로 넘긴다.
// 링크 재작성은 원문 위에 덮어쓰는 것이 아니라 **새 버전을 추가**하는 방식이다(--rewrite-links).

export interface ParsedDocument {
  frontmatter: Record<string, string | string[]>;
  /** 원문 그대로 — 손대지 않는다 */
  body: string;
}

export function parseFrontmatter(content: string): ParsedDocument {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content };

  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: content };

  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const frontmatter: Record<string, string | string[]> = {};

  let currentKey: string | null = null;
  for (const line of raw.split('\n')) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem !== null && currentKey !== null) {
      const existing = frontmatter[currentKey];
      const value = unquote(listItem[1] ?? '');
      frontmatter[currentKey] = Array.isArray(existing) ? [...existing, value] : [value];
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair === null) continue;
    const [, key, value] = pair;
    if (key === undefined) continue;
    currentKey = key;
    frontmatter[key] = value === undefined || value === '' ? [] : unquote(value);
  }

  return { frontmatter, body };
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

/**
 * status 2축 분해 — 원본의 1축 status 를 문서 축 × 구현 축으로 나눈다(§2.3).
 * 매핑에 없는 값은 **조용히 기본값으로 넘기지 않는다** — 리포트에 수동 확인 항목으로 올린다.
 */
export function splitStatus(
  raw: string | undefined,
  statusMap: Record<string, { doc: string; impl: string }>,
): { doc: string; impl: string } | null {
  if (raw === undefined) return null;
  return statusMap[raw] ?? null;
}
