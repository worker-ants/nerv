// 증적 locator 의 형식 — 정본: docs/04-mvp/api.md §2.4 (REQ-API-147)
//
// **형식 규칙을 표면마다 다시 쓰면 갈라진다**(REQ-CB-006). 여기 한 벌을 두고 REST·MCP 가
// 같은 함수를 부른다.
//
// 판정만 하고 던지지 않는 이유: 이 패키지는 `NervError` 를 모른다(브라우저도 읽는 배럴이다).
// 무엇이 틀렸는지 돌려주고, 그것을 400 으로 옮기는 것은 서비스의 일이다.
//
// **GitHub 를 박지 않는다.** `evidence.repo` 열이 있는 것은 저장소가 여럿일 수 있다는 뜻이라,
// `pr` 은 "절대 URL" 까지만 본다 — 호스트를 검사하면 자체 호스팅 GitLab 이 막힌다.

import { EVIDENCE_NOTE_MAX } from './constants.js';

/**
 * 커밋 SHA 의 모양 — 짧은 해시(7)부터 전체(40)까지, 대소문자를 가리지 않는다. 정규식 원문을 내보내는 것은 SQL(`~*`)도
 * 같은 규칙을 쓰기 때문이다 — done 게이트의 커밋 신선도와 구현 축의 커밋 범위가 이 모양으로 "커밋을 아는가" 를 본다
 * (2026-10-15 · api.md REQ-API-314 · 315). 리뷰 제출의 `head_sha` · `base_sha` 도 이 모양이어야 받는다(REQ-API-321 ·
 * `ReviewSnapshotInput`).
 */
export const COMMIT_SHA_PATTERN = '^[0-9a-f]{7,40}$';
const COMMIT = new RegExp(COMMIT_SHA_PATTERN, 'i');

/**
 * **전체 커밋 SHA**(40자 16진수)만 — 브랜치 면제를 커밋 하나로 좁히는 `head_sha` 가 쓴다(2026-10-16 · 사람 결정 D4 · api.md
 * REQ-API-338). 면제는 지워지지 않는 기록이라 짧은 SHA 처럼 나중에 다른 커밋과 겹칠 수 있는 값을 남기지 않는다. 대소문자는
 * 받는 쪽이 소문자로 맞춘다 — DB 의 CHECK 도 같은 모양을 본다(`approval_head_sha_ck`).
 */
export const FULL_COMMIT_SHA_PATTERN = '^[0-9a-f]{40}$';

export interface LocatorVerdict {
  ok: boolean;
  /** 무엇이 틀렸는가 — 메시지 키의 보간값으로 쓴다 */
  reason?: 'empty' | 'commit_shape' | 'pr_url';
}

export function checkEvidenceLocator(kind: string, locator: string): LocatorVerdict {
  const value = locator.trim();
  if (value === '') return { ok: false, reason: 'empty' };
  if (kind === 'commit') {
    return COMMIT.test(value) ? { ok: true } : { ok: false, reason: 'commit_shape' };
  }
  if (kind === 'pr') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: 'pr_url' };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'pr_url' };
    }
  }
  // code_path · test · review · user_guide — 비어 있지 않으면 통과한다.
  // 파일 경로와 테스트 이름은 저장소마다 모양이 달라, 좁히면 정직한 증적이 막힌다.
  return { ok: true };
}

/**
 * **증적 설명을 정리한다**(2026-09-28 · 사람 결정 · 4.4 REQ-API-229). 앞뒤 공백을 걷고, 비었으면 없음(`null`)이다.
 * 상한(`EVIDENCE_NOTE_MAX`)을 넘거나 문자열이 아니면 무엇이 틀렸는지 돌려준다 — 400 으로 옮기는 것은 서비스의 일이다.
 */
export function normalizeEvidenceNote(
  note: unknown,
): { ok: true; value: string | null } | { ok: false; reason: 'note_type' | 'note_too_long' } {
  if (note === undefined || note === null) return { ok: true, value: null };
  if (typeof note !== 'string') return { ok: false, reason: 'note_type' };
  const value = note.trim();
  if (value === '') return { ok: true, value: null };
  if (value.length > EVIDENCE_NOTE_MAX) return { ok: false, reason: 'note_too_long' };
  return { ok: true, value };
}
