// 설치 가능한 아카이브 주소인가 — 실측한 제약 (정본: docs/04-mvp/plugin.md §3.5)
//
// 2026-09-04 실기기 실측: `claude plugin marketplace add http://localhost:8080/...` 는
// **성공한다**(카탈로그를 받아 검증까지 통과). 그런데 이어지는 `claude plugin install` 이
// 거부한다:
//
//   Archive URLs must use https:// and must not point at a loopback, link-local,
//   or cloud-metadata host
//
// 두 단계 사이에서 갈라지는 것이 이 제약의 성질이다 — **추가는 되고 설치가 안 된다.**
// 그래서 운영자는 "마켓플레이스는 붙었는데 왜 설치가 안 되지" 를 혼자 좇게 된다.
//
// **두 표면이 같은 판정을 봐야 한다**(REQ-CB-006). 서버는 카탈로그를 내주면서 운영자 로그에
// 남기고, 화면은 설치 장의 값 카드에서 같은 사실을 미리 말한다(§1.8 — 화면은 서버가 허용할
// 것을 미리 말한다). 판정이 두 벌이면 한쪽만 고쳐지고, 그때 둘 중 어느 쪽이 맞는지는
// 아무도 모른다. `evidence-locator.ts` 와 같은 자리다.
//
// 판정만 하고 던지지 않는 이유도 그 파일과 같다: 이 패키지는 `NervError` 를 모르고 화면
// 문구도 모른다. 무엇이 왜 막혔는지를 **코드로** 돌려주고, 그것을 로그나 화면 문구로
// 옮기는 것은 표면의 일이다.

export interface PluginInstallVerdict {
  ok: boolean;
  /** 무엇이 막았는가 — 메시지 키를 고르는 값이다 */
  reason?: 'unparsable' | 'not_https' | 'loopback';
  /** 문구에 끼워 보일 값 — 해석 못 한 원문 · 현재 스킴 · 그 호스트 */
  detail?: string;
}

/**
 * 루프백·링크로컬 — 클라우드 메타데이터 주소(`169.254.169.254`)가 링크로컬에 든다.
 * 대괄호는 URL 의 IPv6 표기라 호스트 이름의 일부가 아니다.
 */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fe80:/.test(host)
  );
}

export function checkPluginInstallUrl(apiUrl: string): PluginInstallVerdict {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    // 스킴 없는 값(`nerv.example.com`)이 여기로 온다 — 모르는 것을 통과시키지 않는다.
    return { ok: false, reason: 'unparsable', detail: apiUrl };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'not_https', detail: `${url.protocol}//` };
  }
  if (isLoopback(url.hostname)) {
    return { ok: false, reason: 'loopback', detail: url.hostname };
  }
  return { ok: true };
}
