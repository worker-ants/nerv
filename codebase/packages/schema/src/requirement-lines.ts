// 본문의 요구사항 줄 — `REQ-CWC-031 WHEN … THE SYSTEM SHALL …` (정본: api.md §2.2 REQ-API-046 · 검사기와 같은 모양)
//
// **서버와 화면이 같은 판정을 쓴다**(2026-09-28). 서버는 저장 응답의 델타 · 버전 비교 · 검색 스니펫이 이 함수로
// 본문을 읽는다. 화면은 한 번도 승인되지 않은 초안의 요구사항 탭에서 "승인되면 무엇이 생기나" 를 이것으로 센다 —
// 요구사항 행은 승인될 때 만들어져 그 전에는 셀 행이 없다. 두 벌이면 언젠가 한쪽만 고쳐진다(D-05).

/**
 * **요구사항 ID 의 모양 — 한 곳이다**(2026-09-28 · REQ-API-241). 첫 토막은 영문, 가운데는 영문으로 시작하는
 * 영문 · 숫자, 끝은 숫자다. 가운데 토막의 숫자(`REQ-C24NODE-001`)를 추출기가 모두 놓쳤다 — 다음 번호
 * 발급(EP-REQ-04)은 그 접두를 받아 주는데 읽는 쪽 여섯 자리가 영문만 봤다. 이 문자열을 모두가 쓴다.
 */
export const REQUIREMENT_REF_SOURCE = '[A-Z]+-[A-Z][A-Z0-9]*-\\d+';

/** ID 하나가 그 모양인가 */
export const REQUIREMENT_REF = new RegExp(`^${REQUIREMENT_REF_SOURCE}$`);

/** 요구사항 한 줄 — 목록 기호는 있어도 없어도 된다 */
const REQUIREMENT_LINE = new RegExp(`^[-*]?\\s*(${REQUIREMENT_REF_SOURCE})\\s+(.*)$`);

/** 글 속에서 언급한 요구사항 ID — 단어 경계가 있는 것만, 처음 나온 순서로 한 번씩 */
export function requirementRefsIn(text: string): string[] {
  return [...new Set(text.match(new RegExp(`\\b${REQUIREMENT_REF_SOURCE}\\b`, 'g')) ?? [])];
}

/** 본문에서 요구사항을 읽는다 — ref → 문장. 같은 ref 가 두 번 나오면 첫 줄이 그 요구사항이다(검사기가 잡는다) */
export function requirementsOf(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of body.split('\n')) {
    const match = REQUIREMENT_LINE.exec(line.trim());
    const ref = match?.[1];
    if (ref === undefined) continue;
    if (!found.has(ref)) found.set(ref, (match?.[2] ?? '').trim());
  }
  return found;
}
