// 요구사항 추출 — 고정 ID 휴리스틱 (importer.md §2.5)
//
// 원본에는 EARS 문형도 요구사항 테이블도 없을 수 있다. 있는 것은 본문 여기저기 흩어진
// `REQ-CWC-031` 같은 **고정 ID** 뿐이다. 그것을 앵커로 문장을 떼어낸다.
//
// 휴리스틱이라 100% 가 아니다 — 그래서 실패는 조용히 버리지 않고 리포트로 올린다(§4.1).

export interface ExtractedRequirement {
  ref: string;
  text: string;
  /** 본문에서 발견된 줄 번호 — 리포트가 파일·줄·사유를 적어야 한다(§4.1) */
  line: number;
}

export function extractRequirements(body: string, idPattern: string): ExtractedRequirement[] {
  const pattern = new RegExp(idPattern, 'g');
  const found = new Map<string, ExtractedRequirement>();

  body.split('\n').forEach((line, index) => {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match !== null) {
      const ref = match[0];
      if (!found.has(ref)) {
        found.set(ref, {
          ref,
          // ID 뒤의 문장을 요구사항 본문으로 본다. 없으면 줄 전체다.
          text:
            line
              .slice(match.index + ref.length)
              .replace(/^[\s:—-]+/, '')
              .trim() || line.trim(),
          line: index + 1,
        });
      }
      match = pattern.exec(line);
    }
  });

  return [...found.values()];
}
