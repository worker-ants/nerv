// 본문 축소 — 초안 저장이 덮어쓸 본문을 크게 줄였는가 (정본: api.md §2.2 REQ-API-270 · 271)
//
// **두 번 실측된 사고다**(2026-10-05 · 10-08 · clemvion). 용어 사전 v4 는 34.7KB 본문이 편집 스크립트의 결함으로
// 484바이트 조각이 된 채 저장되고 검토 요청 · 승인까지 지나갔다. 계정 · 워크스페이스 v4 는 생성 도중 끊긴 도구 호출이
// 86KB 본문의 앞 40줄만 담은 채 실행됐다. 서버는 둘 다 경고 없이 받았다 — 지문(`base_hash`)은 "무엇을 보고 썼는가" 만
// 묻고, 빈 본문 방어는 **빈** 본문만 막았다. 초안은 덮어써지므로 잃은 본문은 서버 어디에도 남지 않는다.
//
// **판정은 이 함수 한 곳이다**(D-05). 초안 저장의 거절 · 사전 검토의 지적 · 검토 요청 창과 승인 카드의 표시가 모두
// 이것으로 센다 — 두 벌이면 저장은 막는데 화면은 줄지 않았다고 말하는 날이 온다.
//
// 축은 셋이다. **크기**는 잘린 본문(앞부분만 남거나 꼬리 조각만 남은 것)을 잡는다. 크기만 보면 내용을 다른 글로
// 바꾼 저장도 걸리지만, 그것은 줄어든 것이 아니라 바뀐 것이라 걸리지 않는다. **제목 수**는 구조가 사라진 것을,
// **요구사항**은 약속이 사라진 것을 잡는다. 제목은 이름이 아니라 **수**로 센다 — 절 번호를 다시 매긴 문서는 제목이
// 전부 바뀌어도 줄어든 것이 아니다. 요구사항은 번호를 다시 쓰지 않으므로(EARS 규약) **같은 번호가 남았는가**로 센다.

import {
  BODY_SHRINK_MIN_BYTES,
  BODY_SHRINK_MIN_ITEMS,
  BODY_SHRINK_RATIO,
  BODY_SHRINK_REASONS,
} from './constants.js';
import { requirementsOf } from './requirement-lines.js';

export type BodyShrinkReason = (typeof BODY_SHRINK_REASONS)[number];

/** 본문 한 편의 크기 — 바이트(UTF-8) · 제목 수 · 요구사항 번호 */
export interface BodyShape {
  bytes: number;
  headings: number;
  requirements: string[];
}

/** 두 본문 사이의 변화 — 응답 · 이벤트에 그대로 들어가는 모양이다 */
export interface BodyChange {
  before: { bytes: number; headings: number; requirements: number };
  after: { bytes: number; headings: number; requirements: number };
  /** 앞 본문의 요구사항 가운데 뒤 본문에 같은 번호로 남은 수 */
  requirements_kept: number;
  /** 걸린 축 — 비어 있으면 축소가 아니다 */
  shrunk: BodyShrinkReason[];
}

/** 제목 줄 — 코드 펜스 안의 `#` 줄(셸 주석)은 제목이 아니다 */
const HEADING = /^#{1,6}\s+\S/;
const FENCE = /^\s*(```|~~~)/;

export function bodyShape(body: string): BodyShape {
  let headings = 0;
  let fenced = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && HEADING.test(line)) headings += 1;
  }
  return {
    bytes: new TextEncoder().encode(body).length,
    headings,
    requirements: [...requirementsOf(body).keys()],
  };
}

/**
 * 앞 본문 → 뒤 본문. 앞 본문이 작으면(`BODY_SHRINK_MIN_BYTES` 미만) 어느 축도 걸지 않는다 — 짧은 문서는
 * 통째로 다시 쓰는 일이 흔하고, 잃어도 다시 쓸 수 있는 크기다. 제목 · 요구사항 축은 앞 본문에 그것이
 * `BODY_SHRINK_MIN_ITEMS` 개 이상 있을 때만 본다 — 셋 가운데 둘을 지운 것을 "대부분 사라졌다" 고 부르지 않는다.
 */
export function bodyChange(previous: string, next: string): BodyChange {
  const before = bodyShape(previous);
  const after = bodyShape(next);
  const nextRefs = new Set(after.requirements);
  const kept = before.requirements.filter((ref) => nextRefs.has(ref)).length;

  const shrunk: BodyShrinkReason[] = [];
  if (before.bytes >= BODY_SHRINK_MIN_BYTES) {
    if (after.bytes < before.bytes * BODY_SHRINK_RATIO) shrunk.push('bytes');
    if (
      before.headings >= BODY_SHRINK_MIN_ITEMS &&
      after.headings < before.headings * BODY_SHRINK_RATIO
    ) {
      shrunk.push('headings');
    }
    if (
      before.requirements.length >= BODY_SHRINK_MIN_ITEMS &&
      kept < before.requirements.length * BODY_SHRINK_RATIO
    ) {
      shrunk.push('requirements');
    }
  }

  return {
    before: {
      bytes: before.bytes,
      headings: before.headings,
      requirements: before.requirements.length,
    },
    after: {
      bytes: after.bytes,
      headings: after.headings,
      requirements: after.requirements.length,
    },
    requirements_kept: kept,
    shrunk,
  };
}
