// frontmatter 파싱 + 필드 매핑 (importer.md §2.3)
//
// **원문 보존이 제1규칙이다**(§2.4) — body 는 자르거나 재작성하지 않고 그대로 넘긴다.
// 링크 재작성은 원문 위에 덮어쓰는 것이 아니라 **새 버전을 추가**하는 방식이다(--rewrite-links).

export interface ParsedDocument {
  frontmatter: Record<string, string | string[]>;
  /** 원문 그대로 — 손대지 않는다 */
  body: string;
  /**
   * 선두 블록의 **원문** — 매니페스트가 해시로 남긴다(§3.3).
   *
   * 본문 해시만으로는 "frontmatter 만 바뀐 재실행" 을 무변경으로 읽는다 — `updated:` 하나
   * 고친 문서가 그렇다. 블록이 없으면 `null` 이고, 그것도 사실이다.
   */
  raw: string | null;
  /**
   * `---` 로 열렸는데 **닫히지 않았다.**
   *
   * 예전에는 이 경우 조용히 전체를 본문으로 돌렸다 — 사람이 오타를 낸 문서가 아무 말 없이
   * "frontmatter 없는 문서" 로 적재됐고, 그 문서의 `id` 는 경로에서 지어졌다.
   */
  unparsable: boolean;
}

export function parseFrontmatter(content: string): ParsedDocument {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content, raw: null, unparsable: false };
  }

  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: content, raw: null, unparsable: true };

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
    frontmatter[key] = value === undefined || value === '' ? [] : scalarOrFlowList(value);
  }

  return { frontmatter, body, raw, unparsable: false };
}

/**
 * 한 줄 목록(`code: []` · `code: [a, b]`)은 **목록이다**(2026-09-26). 이 파서는 줄 목록(`- a`)만
 * 알아서, clemvion 의 `code: []` 가 문자열 `"[]"` 로 읽혀 존재하지 않는 경로 하나가 됐다 —
 * 실존 검사가 그것을 "아무것도 가리키지 않는 glob" 으로 보고했다(실측 2026-09-26).
 */
function scalarOrFlowList(value: string): string | string[] {
  const flow = /^\[(.*)\]$/.exec(value.trim());
  if (flow === null) return unquote(value);
  return (flow[1] ?? '')
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item !== '');
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
