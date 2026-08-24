// 리뷰 산출물 파서 — clemvion `review/<kind>/YYYY/MM/DD/HH_MM_SS/` (importer.md §2.7)
//
// **이 파서가 옮기는 것은 결론이지 프롬프트가 아니다.** 원본 세션 디렉터리에는 역할별 md
// (security.md · testing.md …)와 `_prompts/` 와 `_retry_state.json` 이 함께 있는데, 레코드로
// 남길 것은 `SUMMARY.md` 의 발견 표와 역할별 소견뿐이다. 재생성 가능한 입력을 옮기면
// clemvion 이 겪은 자기증식을 DB 안에서 반복하는 것이 된다(D-01·D-07).
//
// 표의 열 이름이 kind 마다 다르다(실측):
//   code         | # | 카테고리 | 발견사항 | 위치 | 제안 |
//   consistency  | # | Checker | 위배 | target 위치 | 충돌 대상 | 제안 |   (WARNING)
//                | # | Checker | 항목 | 위치 | 제안 |                      (INFO)
// 그래서 **열 위치를 고정하지 않고 머리글에서 찾는다** — 고정하면 kind 하나만 맞는다.

import type { ImportReviewFinding } from '@nerv/schema';

export interface ParsedReview {
  /** 전체 위험도 — `**LOW** — …` 줄에서 */
  risk: 'low' | 'medium' | 'high';
  /** consistency 의 `**BLOCK: YES**` */
  block: boolean;
  findings: ImportReviewFinding[];
  /** `## 에이전트별 위험도 요약` 표 — 역할별 소견. 없으면 빈 배열 */
  reports: { role: string; risk: 'low' | 'medium' | 'high'; body_md: string | null }[];
  /**
   * 발견 표를 하나도 찾지 못했는가. 원본 271/1,984 건은 sub-agent 실패 등으로
   * **산문 형식**이라 표가 없다(실측) — 리포트에 남겨 사람이 보게 한다.
   */
  tableless: boolean;
}

/**
 * 열 머리글 → 우리 필드. 여러 표기를 한 뜻으로 모은다.
 * **여기 한글은 원본을 읽는 어휘다** — 화면에 나가는 문구가 아니다(REQ-CB-022 예외).
 */
/* eslint-disable no-restricted-syntax -- 원본 표의 열 이름 — 출력이 아니다(REQ-CB-022) */
const COLUMN: Record<string, 'category' | 'text' | 'location' | 'conflict' | 'suggestion'> = {
  카테고리: 'category',
  checker: 'category',
  발견사항: 'text',
  위배: 'text',
  항목: 'text',
  위치: 'location',
  'target 위치': 'location',
  '충돌 대상': 'conflict',
  제안: 'suggestion',
};
/* eslint-enable no-restricted-syntax */

const SEVERITY_OF_HEADING: [RegExp, 'critical' | 'warning' | 'info'][] = [
  [/critical/i, 'critical'],
  [/경고|warning/i, 'warning'],
  [/참고|info/i, 'info'],
];

export function parseReviewSummary(markdown: string): ParsedReview {
  const lines = markdown.split('\n');
  const findings: ImportReviewFinding[] = [];
  let risk: ParsedReview['risk'] = 'low';
  let block = false;
  let severity: 'critical' | 'warning' | 'info' | null = null;
  let header: string[] | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    if (/^\*\*BLOCK:\s*YES/i.test(line.trim())) block = true;

    // `## 전체 위험도` 다음 줄의 `**HIGH** — …`
    if (/^##\s+전체 위험도/.test(line)) {
      const next = (lines[i + 1] ?? '') + (lines[i + 2] ?? '');
      const found = /\*\*(LOW|MEDIUM|HIGH)\*\*/i.exec(next);
      if (found !== null) risk = found[1]!.toLowerCase() as 'low';
      continue;
    }

    if (line.startsWith('## ')) {
      severity = severityOf(line);
      header = null;
      continue;
    }

    if (severity === null || !line.trim().startsWith('|')) {
      // 표 밖으로 나오면 머리글도 버린다 — 절이 끝난 뒤의 표는 다른 표다
      if (line.trim() === '') header = null;
      continue;
    }

    const cells = splitRow(line);
    if (isDivider(cells)) continue;
    if (header === null) {
      header = cells.map((c) => c.trim().toLowerCase());
      continue;
    }

    const finding = toFinding(header, cells, severity);
    if (finding !== null) findings.push(finding);
  }

  return {
    risk,
    block,
    findings,
    reports: parseAgentRisks(lines),
    // 표를 만난 적이 없으면(머리글조차 없었으면) 산문 형식이다
    tableless: !markdown.includes('| # |'),
  };
}

/**
 * `## 에이전트별 위험도 요약` 표 → 역할별 리포트(816/1,984 건에 있다 — 실측).
 *
 * **핵심 발견 한 줄만 본문으로 옮긴다.** 역할별 원본 md 를 통째로 넣으면 clemvion 의
 * 131MB 를 DB 안에서 재현하는 것이 된다(D-01·D-07) — 우리가 옮기는 것은 결론이다.
 */
function parseAgentRisks(lines: readonly string[]): ParsedReview['reports'] {
  const out: ParsedReview['reports'] = [];
  let inside = false;
  let seenHeader = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      inside = /에이전트별 위험도|관점별 위험도/.test(line);
      seenHeader = false;
      continue;
    }
    if (!inside || !line.trim().startsWith('|')) continue;
    const cells = splitRow(line).map((c) => c.trim());
    if (isDivider(cells)) continue;
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    const role = normalizeCategory(cells[0] ?? '');
    const risk = riskOf(cells[1] ?? '');
    if (role === '' || risk === null) continue;
    const body = (cells[2] ?? '').trim();
    out.push({ role, risk, body_md: body === '' ? null : body });
  }
  return out;
}

/** `NONE` 은 우리 어휘에 없다 — 위험이 없다는 것이므로 `low` 다. */
function riskOf(raw: string): 'low' | 'medium' | 'high' | null {
  const value = raw.replace(/\*/g, '').trim().toUpperCase();
  if (value === 'NONE' || value === 'LOW') return 'low';
  if (value === 'MEDIUM') return 'medium';
  if (value === 'HIGH' || value === 'CRITICAL') return 'high';
  return null;
}

function severityOf(heading: string): 'critical' | 'warning' | 'info' | null {
  for (const [pattern, value] of SEVERITY_OF_HEADING) {
    if (pattern.test(heading)) return value;
  }
  return null;
}

/**
 * `| a | b |` → `['a','b']`.
 *
 * 셀 구분이 **아닌** `|` 가 둘 있다:
 *   ① 이스케이프된 `\|`
 *   ② **코드 스팬 안의 `|`** — `` `as string | undefined` `` · `` `||` `` 처럼.
 *      markdown 규약대로면 이스케이프해야 하지만 원본은 그냥 쓴다(실측: clemvion
 *      1,984건 중 여러 표에 있다). 그대로 쪼개면 열이 밀려 **다른 칸을 제목으로 읽고**,
 *      운이 나쁘면 백틱 한 글자가 제목이 된다 — 실제로 그래서 적재가 멈췄다.
 */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function isDivider(cells: string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function toFinding(
  header: string[],
  cells: string[],
  severity: 'critical' | 'warning' | 'info',
): ImportReviewFinding | null {
  const pick = (field: string): string => {
    const index = header.findIndex((h) => COLUMN[h] === field);
    return index === -1 ? '' : (cells[index] ?? '').trim();
  };

  const rawText = pick('text');
  if (rawText === '' || /^_?없음_?$|^해당 없음/.test(rawText)) return null;

  const conflict = pick('conflict');
  const location = pick('location');
  const suggestion = pick('suggestion');
  const { file, line } = parseLocation(location);

  // `[SPEC-DRIFT]` 는 카테고리가 아니라 **꼬리표**다 — 스펙을 고칠 신호라서 필터로 쓰인다
  const tags =
    /\[SPEC-DRIFT\]/i.test(rawText) || /spec-drift/i.test(pick('category')) ? ['spec_drift'] : [];

  const detail = [
    rawText,
    conflict === '' ? null : `충돌 대상: ${conflict}`,
    location === '' ? null : `위치: ${location}`,
  ]
    .filter((v): v is string => v !== null && v !== '')
    .join('\n\n');

  return {
    severity,
    category: normalizeCategory(pick('category')),
    title: titleOf(rawText),
    detail_md: detail,
    suggestion_md: suggestion === '' ? null : suggestion,
    file,
    line,
    tags,
  };
}

/**
 * 제목은 **앞 절**이다. 원본의 발견사항 칸은 근거까지 담아 길고(200자 넘는 것이 흔하다),
 * 그대로 제목에 넣으면 목록이 문단이 된다. 본문은 `detail_md` 가 통째로 갖고 있으므로
 * 잘라도 잃는 것이 없다.
 */
function titleOf(text: string): string {
  const stripped = text
    .replace(/\[SPEC-DRIFT\]/gi, '')
    .replace(/`/g, '')
    .trim();
  // 첫 문장 경계 — `—`(설명 시작)·`.`+공백·줄바꿈 중 가장 앞
  const cut = /—|(?<=[^0-9])\.\s|\n/.exec(stripped);
  const head = cut === null ? stripped : stripped.slice(0, cut.index);
  const title = head.trim().replace(/[,·]$/, '');
  // **빈 제목을 내보내지 않는다.** 잘라낸 결과가 비면 자르기 전 문장을 그대로 쓴다 —
  // 이상한 제목은 사람이 고칠 수 있지만, 빈 제목은 계약 위반이라 배치 전체가 멈춘다.
  if (title.length === 0) return stripped.slice(0, 120).trim() || text.trim().slice(0, 120);
  return title.length > 160 ? `${title.slice(0, 157)}…` : title;
}

/** 카테고리는 소문자 한 낱말로 — `Naming Collision` 과 `naming_collision` 이 같은 것이다 */
function normalizeCategory(raw: string): string {
  return raw.replace(/`/g, '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * 위치 칸에서 경로와 줄을 뽑는다. 표기가 제각각이라(실측) 관대하게 읽는다:
 *   `ai-agent.handler.ts 라인 139-143`  ·  `execution-engine.service.ts L700`
 *   `spec/data-flow/9-observability.md §4`  ·  `ai-memory-manager.ts:99-350`
 * **줄을 못 찾아도 파일은 건진다** — 위치의 값어치 대부분이 파일에 있다.
 */
export function parseLocation(raw: string): { file: string | null; line: number | null } {
  if (raw.trim() === '') return { file: null, line: null };
  const text = raw.replace(/`/g, ' ');
  const path = /([\w./-]+\.[a-z]{1,5})(?::(\d+))?/i.exec(text);
  if (path === null) return { file: null, line: null };
  const file = path[1] ?? null;
  if (path[2] !== undefined) return { file, line: Number(path[2]) };
  const line = /(?:라인|line|L)\s*(\d+)/i.exec(text.slice(path.index + (path[1]?.length ?? 0)));
  return { file, line: line === null ? null : Number(line[1]) };
}

/**
 * `_retry_state.json` 의 `session_dir` 에서 **브랜치를 되찾는다**.
 * clemvion 은 worktree 로 병행 작업을 돌렸고 그 경로에 이름이 남아 있다:
 * `.claude/worktrees/backend-typecheck-gap-3d7a91/review/...` → `backend-typecheck-gap-3d7a91`.
 * worktree 가 아니면 본류에서 돈 것이다.
 */
export function branchFromRetryState(json: string, fallback: string): string {
  try {
    const parsed = JSON.parse(json) as { session_dir?: unknown };
    const dir = typeof parsed.session_dir === 'string' ? parsed.session_dir : '';
    const found = /\.claude\/worktrees\/([^/]+)\//.exec(dir);
    return found === null ? fallback : found[1]!;
  } catch {
    return fallback;
  }
}
