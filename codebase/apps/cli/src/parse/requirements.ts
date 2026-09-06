// 요구사항 추출 — 표의 행이 정의다 (importer.md §2.5)
//
// **정의는 표에만 있다.** 본문 산문에 적힌 `REQ-CWC-031` 은 그 요구사항을 *가리키는* 말이지
// 그것을 *정하는* 말이 아니다(§2.5 규칙 1). 이 구분을 하지 않고 "본문 어디든 처음 나온 줄"을
// 정의로 삼으면 참조가 전부 요구사항으로 승격되고, **요구사항 수 자체가 부풀어 오른다** —
// "추정하지 않는다"를 내건 문서(§2.5 규칙 4)의 정반대다.
//
// 그래서 이 파서는 마크다운 표만 읽는다. 표에서 얻는 것이 넷이다.
//   ref        — ID 토큰을 가진 셀
//   text       — 설명 셀 원문(규칙 2)
//   acceptance — 수용 기준 열이 따로 있으면 그 셀. **EARS 정규화는 하지 않는다**(규칙 2)
//   priority   — 필수→must · 권장→should. **미표기는 null 이고 추정하지 않는다**(규칙 4)
//
// 휴리스틱이라 100% 가 아니다 — 그래서 실패는 조용히 버리지 않고 리포트로 올린다(§4.1).

export type RequirementPriority = 'must' | 'should' | 'could';

export interface ExtractedRequirement {
  ref: string;
  text: string;
  /** 수용 기준 열이 따로 있을 때만. 없으면 null — 설명 셀을 복사해 두 벌로 만들지 않는다 */
  acceptance: string | null;
  /** **미표기는 null 이다**(규칙 4). 표기가 없다는 사실 자체가 수동 확인 큐의 근거다 */
  priority: RequirementPriority | null;
  /** 문서 내 정의 순서 — `requirement_version.ordinal` 이 된다(규칙 7). 표가 여럿이면 이어서 센다 */
  ordinal: number;
  /** 원본에서 발견된 줄 번호 — 리포트가 파일·줄·사유를 적어야 한다(§4.1) */
  line: number;
}

export interface ExtractionResult {
  requirements: ExtractedRequirement[];
  /** 같은 ref 의 두 번째 이후 정의 행 — 첫 행만 적재하고 나머지는 수동 확인 큐로(규칙 6) */
  duplicates: { ref: string; line: number }[];
}

/**
 * 필수/권장 어휘 — 데이터 모델 §2.2 의 매핑. 셋 밖의 값은 표기가 없는 것으로 친다.
 *
 * **이것은 읽는 사람의 말이 아니라 원본 문서의 말이다.** 카탈로그(REQ-CB-022)로 옮기면
 * 로케일을 바꾼 순간 같은 파일이 다르게 읽힌다 — 원본의 낱말은 독자를 따라 변하지 않는다.
 */
const PRIORITY_WORDS = new Map<string, RequirementPriority>([
  // eslint-disable-next-line no-restricted-syntax -- 원본 문서의 어휘다. 로케일을 따라가면 안 된다
  ['필수', 'must'],
  ['must', 'must'],
  // eslint-disable-next-line no-restricted-syntax -- 위와 같은 이유
  ['권장', 'should'],
  ['should', 'should'],
  // eslint-disable-next-line no-restricted-syntax -- 위와 같은 이유
  ['선택', 'could'],
  ['could', 'could'],
]);

const PRIORITY_HEADER = /우선\s*순위|priority/i;
const ACCEPTANCE_HEADER = /수용\s*기준|acceptance/i;

export function extractRequirements(body: string, idPattern: string): ExtractionResult {
  const pattern = new RegExp(idPattern);
  const requirements: ExtractedRequirement[] = [];
  const duplicates: { ref: string; line: number }[] = [];
  const seen = new Set<string>();

  for (const table of tablesOf(body)) {
    const roles = rolesOf(table.header);
    for (const row of table.rows) {
      const idIndex = row.cells.findIndex((cell) => pattern.test(stripMarkup(cell)));
      if (idIndex === -1) continue;
      const ref = pattern.exec(stripMarkup(row.cells[idIndex] ?? ''))?.[0];
      if (ref === undefined) continue;

      if (seen.has(ref)) {
        duplicates.push({ ref, line: row.line });
        continue;
      }
      seen.add(ref);

      const acceptanceIndex = pickOther(roles.acceptance, idIndex, row.cells.length);
      const priorityIndex = pickOther(roles.priority, idIndex, row.cells.length);
      const textIndex = row.cells.findIndex(
        (cell, i) => i !== idIndex && i !== acceptanceIndex && i !== priorityIndex && cell !== '',
      );

      // 설명 셀이 따로 없는 두 칸 표(`| ID | 수용 기준 |`)에서는 그 한 셀이 곧 설명이다.
      // 같은 값을 acceptance 에도 실으면 한 문장이 두 열에 앉는다.
      const text =
        textIndex === -1 ? (row.cells[acceptanceIndex ?? -1] ?? '') : row.cells[textIndex];
      const acceptance =
        textIndex === -1 || acceptanceIndex === undefined
          ? null
          : (row.cells[acceptanceIndex] ?? null);

      if (text === undefined || text === '') continue;

      requirements.push({
        ref,
        text,
        acceptance: acceptance === '' ? null : acceptance,
        priority: priorityOf(row.cells, priorityIndex),
        ordinal: requirements.length,
        line: row.line,
      });
    }
  }

  return { requirements, duplicates };
}

/** 열 이름이 알려 주는 역할. 이름이 없으면 undefined — 자리로 추측하지 않는다 */
function rolesOf(header: string[] | null): {
  acceptance: number | undefined;
  priority: number | undefined;
} {
  if (header === null) return { acceptance: undefined, priority: undefined };
  const find = (re: RegExp): number | undefined => {
    const i = header.findIndex((cell) => re.test(stripMarkup(cell)));
    return i === -1 ? undefined : i;
  };
  return { acceptance: find(ACCEPTANCE_HEADER), priority: find(PRIORITY_HEADER) };
}

function pickOther(index: number | undefined, idIndex: number, width: number): number | undefined {
  if (index === undefined || index === idIndex || index >= width) return undefined;
  return index;
}

/**
 * 우선순위 — 열 이름이 있으면 그 셀만 본다. 없으면 어휘가 통째로 든 셀을 찾는다
 * (`| REQ-A-1 | 필수 | … |` 처럼 머리글 없는 표가 실제로 있다). **어느 쪽도 아니면 null 이다.**
 */
function priorityOf(
  cells: string[],
  priorityIndex: number | undefined,
): RequirementPriority | null {
  if (priorityIndex !== undefined) {
    return PRIORITY_WORDS.get(stripMarkup(cells[priorityIndex] ?? '').toLowerCase()) ?? null;
  }
  for (const cell of cells) {
    const word = PRIORITY_WORDS.get(stripMarkup(cell).toLowerCase());
    if (word !== undefined) return word;
  }
  return null;
}

interface TableRow {
  cells: string[];
  line: number;
}

interface Table {
  header: string[] | null;
  rows: TableRow[];
}

/**
 * 본문에서 마크다운 표만 떼어낸다. 표의 표식은 **구분 행**(`| --- | --- |`)이다 —
 * 파이프가 든 줄은 산문에도 있지만 구분 행은 표에만 있다.
 */
function tablesOf(body: string): Table[] {
  const lines = body.split('\n');
  const tables: Table[] = [];
  let index = 0;

  while (index < lines.length) {
    const head = lines[index];
    const delimiter = lines[index + 1];
    if (head === undefined || delimiter === undefined || !isRow(head) || !isDelimiter(delimiter)) {
      index += 1;
      continue;
    }

    const rows: TableRow[] = [];
    let cursor = index + 2;
    for (let line = lines[cursor]; line !== undefined && isRow(line); line = lines[cursor]) {
      rows.push({ cells: splitRow(line), line: cursor + 1 });
      cursor += 1;
    }
    tables.push({ header: splitRow(head), rows });
    index = cursor;
  }

  return tables;
}

function isRow(line: string): boolean {
  return line.trim().startsWith('|');
}

function isDelimiter(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

/**
 * 한 행을 셀로 가른다. **이스케이프한 파이프(`\|`)는 가르지 않는다** — 표 셀 안의
 * 인라인 코드가 그것을 쓴다(`` `spec\|plan` ``). 가르면 셀 수가 어긋나 열 역할이 밀린다.
 */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      current += '|';
      i += 2;
      continue;
    }
    if (inner[i] === '|') {
      cells.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += inner[i];
    i += 1;
  }
  cells.push(current.trim());
  return cells;
}

/** 강조·코드 표식을 걷는다 — `**REQ-IMP-001**` 과 `REQ-IMP-001` 은 같은 ID 다 */
function stripMarkup(cell: string): string {
  return cell.replaceAll('*', '').replaceAll('`', '').replaceAll('~', '').trim();
}
