// 설치 가능한 주소인가 — 실측한 제약을 코드에 못박는다 (4.6 §3.5)
//
// 2026-09-04 실기기 실측: `claude plugin marketplace add http://localhost:8080/...` 는
// **성공한다**(카탈로그를 받아 검증까지 통과). 그런데 이어지는 `claude plugin install` 이
// 거부한다:
//
//   Archive URLs must use https:// and must not point at a loopback, link-local,
//   or cloud-metadata host
//
// 두 단계 사이에서 갈라지는 것이 이 제약의 성질이다 — 추가는 되고 설치가 안 된다. 그래서
// 운영자는 "마켓플레이스는 붙었는데 왜 설치가 안 되지" 를 혼자 좇게 된다. 서버가 먼저
// 말하게 하고, 그 판정을 여기서 지킨다.

import { describe, expect, it } from 'vitest';
import { installableFrom } from './plugin.service.js';

describe('installableFrom — 아카이브 URL 제약 (실측 2026-09-04)', () => {
  it('https 의 보통 호스트는 설치된다', () => {
    expect(installableFrom('https://nerv.example.com').ok).toBe(true);
    expect(installableFrom('https://nerv.corp.internal:8443').ok).toBe(true);
  });

  it('http 는 안 된다 — 개발 기본값이 정확히 이 자리다', () => {
    const verdict = installableFrom('http://nerv.example.com');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('https');
  });

  it.each([
    'https://localhost:8080',
    'https://127.0.0.1',
    'https://[::1]',
    'https://app.localhost',
    'https://169.254.169.254', // 클라우드 메타데이터
  ])('%s 는 루프백·링크로컬이라 안 된다', (url) => {
    expect(installableFrom(url).ok).toBe(false);
  });

  it('해석되지 않는 값도 거절이다 — 모르는 것을 통과시키지 않는다', () => {
    expect(installableFrom('nerv.example.com').ok).toBe(false);
    expect(installableFrom('').ok).toBe(false);
  });

  /**
   * 개발 기본값(`http://localhost:8080`)은 **의도적으로** 설치 불가다. 개발은 수동 경로를
   * 쓰므로(§3.5 표) 문제가 아니고, 이 테스트는 그 사실이 사고가 아니라 결정임을 적어 둔다.
   */
  it('개발 기본값은 설치 불가이고, 그것이 맞다', () => {
    expect(installableFrom('http://localhost:8080').ok).toBe(false);
  });
});
