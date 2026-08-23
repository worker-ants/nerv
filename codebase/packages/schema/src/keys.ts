// 표시 키 발급 — 정본: docs/03-proposal/data-model.md §5.1
//
// **브라우저 배럴이 아니다.** `node:crypto` 를 쓰므로 `@nerv/schema` 본 배럴에 두면
// apps/web 번들이 그것을 끌고 들어가 페이지 로드에서 터진다(실측 2026-08-23 —
// `Module "node:crypto" has been externalized for browser compatibility`).
// `./migrate` 와 같은 이유의 같은 처방이다: **키를 발급하는 쪽은 서버와 CLI 뿐이다.**

import { createHash } from 'node:crypto';

/**
 * 표시 키 — `<project.key>-<타입>-<base32 6자>` (데이터 모델 §5.1 정본. 예: `CLV-T-7QF3K2`)
 *
 * UUID 는 FK 와 API 파라미터의 것이고, 이것은 **사람과 커밋 메시지와 대화의 것**이다.
 * 그래서 짧고, 그래서 폭이 문제가 된다.
 *
 * **알파벳은 혼동 문자를 뺀 base32**(Crockford — `I`·`L`·`O`·`U` 없음)다. 사람이 옮겨 적는
 * 것이 용도라 `0/O`·`1/I/L` 를 가르는 부담을 지우지 않는다. 32^6 ≈ 10.7억이라 프로젝트당
 * 4.8만 건에서도 충돌 기댓값이 1 이하다 — 이전 표기(16진 4자, 65,536)는 481건에서
 * 기댓값이 1.76 이었고 실제로 문서를 먹었다(실측 2026-08-23).
 *
 * `seed` 는 키를 **무엇에서 만들 것인가**다. 두 경로가 다른 것을 쓰는 데는 이유가 있다:
 *   - 일반 생성: Task 의 UUID — 새 행마다 새 키
 *   - 임포트: 원본 경로 — 재실행이 같은 키를 내야 멱등이 성립한다(4.7 §3.4)
 * 형식은 하나지만 씨앗은 용도가 정한다.
 */
export function displayKey(projectKey: string, type: DisplayKeyType, seed: string): string {
  return `${projectKey}-${type}-${displayKeySuffix(seed)}`;
}

/** 타입 문자 — 표시 키의 가운데 한 글자(§5.1 예시 `CLV-T-…`) */
export type DisplayKeyType = 'T' | 'S';

/**
 * 표시 키의 변하는 부분만. **충돌은 여기서만 일어난다** — 한 프로젝트 안에서 접두는 상수다.
 *
 * 따로 내보내는 이유는 임포터 CLI 다: 보내기 전에 키 충돌을 걸러야 하는데(REQ-IMP-020)
 * CLI 는 프로젝트 슬러그만 알고 `project.key` 를 모른다. 변하는 부분만 견주면 충분하다.
 */
export function displayKeySuffix(seed: string): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    // 바이트마다 하위 5비트 — 6자면 30비트다. 해시 출력이므로 어느 비트를 써도 균일하다.
    out += BASE32[digest[i]! & 31]!;
  }
  return out;
}

/** Crockford base32 — 숫자 10 + 문자 22(`I`·`L`·`O`·`U` 제외) */
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
