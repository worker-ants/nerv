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

/** 커밋 SHA — 짧은 해시(7)부터 전체(40)까지. */
const COMMIT = /^[0-9a-f]{7,40}$/i;

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
