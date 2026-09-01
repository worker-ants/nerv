// 저장 응답의 델타 요약 — 정본: api.md §2.2(REQ-API-046) · 카탈로그 3.4 §2.3
//
// 카탈로그는 `nerv_spec_draft_upsert` 의 출력에 **델타 요약(ADDED/MODIFIED/REMOVED)** 을
// 적어 두었고 스킬은 "사람에게 보여준다"고 지시하는데, 응답에 그런 값이 없었다(실측
// 2026-08-30). 그래서 에이전트가 사람에게 보고하는 것은 "저장했습니다" 한 줄뿐이었다.
//
// **draft 는 덮어써진다.** 버전이 쌓이지 않으므로 나중에 되짚을 diff 도 없다 — 저장하는
// 그 순간이 "무엇이 바뀌었나"를 말할 수 있는 유일한 시점이다.
//
// 축은 둘이다. 요구사항은 리뷰가 실제로 묻는 것이고(EP-SPEC-06 도 그 순서다), 줄 수는
// 요구사항이 없는 문서에서도 변화의 크기를 말해 준다 — 이 프로젝트의 스펙 다수가 그렇다.

/** 요구사항 한 줄 — `REQ-CWC-031 WHEN … THE SYSTEM SHALL …` (검사기와 같은 모양을 본다) */
const REQUIREMENT_LINE = /^[-*]?\s*([A-Z]+-[A-Z]+-\d+)\s+(.*)$/;

export interface SpecDelta {
  requirements: { added: string[]; modified: string[]; removed: string[] };
  lines: { added: number; removed: number };
}

/** 본문에서 요구사항을 읽는다 — 행이 없는 문서의 diff 가 이것을 쓴다(EP-SPEC-06) */
export function requirementsOf(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of body.split('\n')) {
    const match = REQUIREMENT_LINE.exec(line.trim());
    const ref = match?.[1];
    if (ref === undefined) continue;
    // 같은 ref 가 두 번 나오면 검사기가 잡는다 — 여기서는 첫 줄을 그 요구사항으로 본다
    if (!found.has(ref)) found.set(ref, (match?.[2] ?? '').trim());
  }
  return found;
}

/**
 * 이전 본문 → 새 본문의 델타. 이전이 없으면(새 문서) 전부 added 다.
 *
 * 줄 수는 **집합이 아니라 개수**로 센다: 어느 줄이 바뀌었는지는 본문 diff(EP-SPEC-06)의
 * 몫이고, 저장 응답이 답해야 하는 것은 "얼마나 바뀌었나"다.
 */
export function specDelta(previous: string | null, next: string): SpecDelta {
  const before = requirementsOf(previous ?? '');
  const after = requirementsOf(next);

  const added: string[] = [];
  const modified: string[] = [];
  for (const [ref, statement] of after) {
    const old = before.get(ref);
    if (old === undefined) added.push(ref);
    else if (old !== statement) modified.push(ref);
  }
  const removed = [...before.keys()].filter((ref) => !after.has(ref));

  // 없는 문서는 **줄이 없다**(빈 문자열 한 줄이 아니다). 그러지 않으면 새 문서에서
  // 본문 끝의 빈 줄이 "이전에도 있던 줄"로 세어져 removed 가 음수가 된다(실측 2026-08-30).
  const beforeLines = previous === null ? [] : previous.split('\n');
  const afterLines = next.split('\n');
  const beforeCount = new Map<string, number>();
  for (const line of beforeLines) beforeCount.set(line, (beforeCount.get(line) ?? 0) + 1);
  let unchanged = 0;
  for (const line of afterLines) {
    const left = beforeCount.get(line) ?? 0;
    if (left > 0) {
      beforeCount.set(line, left - 1);
      unchanged += 1;
    }
  }

  return {
    requirements: { added: added.sort(), modified: modified.sort(), removed: removed.sort() },
    lines: { added: afterLines.length - unchanged, removed: beforeLines.length - unchanged },
  };
}
