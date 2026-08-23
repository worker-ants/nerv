// Playwright 전역 준비 — **로그인을 한 번만 한다**.
//
// 테스트마다 로그인하면 스위트 자신이 무차별 대입 방어(api.md §1.8 IP당 30 req/min)에 걸린다.
// 실측으로 그걸 확인했다: 전 스위트 재실행이 429 를 만들었다. 한도를 낮추는 대신 테스트를
// 고치는 쪽이 맞다 — 사람도 화면을 볼 때마다 로그인하지 않는다.
//
// 로그인 경로 자체를 검증하는 테스트(REQ-WEB-001·005·006)는 이 상태를 쓰지 않고 직접 로그인한다.

import { chromium } from '@playwright/test';
import type { FullConfig } from '@playwright/test';

export const SEEDED_EMAIL = 'jimin@example.com';
export const SEEDED_PASSWORD = 'nerv-dev-1234';
export const STORAGE_STATE = 'test-results/.auth/seeded.json';

/**
 * **개발 스택을 향해 돌지 않는다.** E2E 는 가입·로그인·스펙 수정을 실제로 하므로, 개발
 * 스택을 가리킨 채 돌면 사람이 쓰던 데이터가 조용히 바뀐다(그 사고가 이 분리의 계기였다).
 * 의도적으로 그렇게 하려면 `NERV_E2E_ALLOW_DEV_STACK=1` 을 명시해야 한다.
 */
const DEV_STACK_PORT = '8080';

function assertNotDevStack(baseURL: string): void {
  if (process.env['NERV_E2E_ALLOW_DEV_STACK'] === '1') return;
  if (new URL(baseURL).port !== DEV_STACK_PORT) return;
  throw new Error(
    [
      `E2E 대상이 개발 스택(${baseURL})입니다 — 테스트가 개발 데이터를 고칩니다.`,
      'E2E 전용 스택을 쓰세요:  pnpm e2e:up  (포트는 세션마다 할당된다)',
      '정말 개발 스택을 쓰려면 NERV_E2E_ALLOW_DEV_STACK=1 을 명시하세요.',
    ].join('\n'),
  );
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:19000';
  assertNotDevStack(baseURL);
  const browser = await chromium.launch();
  // 로그인 폼의 라벨이 화면 언어를 따른다 — 준비 절차는 한국어로 못 박는다.
  // 그러지 않으면 이 스크립트가 실행 기계의 locale 에 따라 다른 화면을 찾게 된다.
  const page = await browser.newPage({ baseURL, locale: 'ko-KR' });

  // 스택이 안 떠 있으면 여기서 바로 알려준다 — 12개 테스트가 각자 타임아웃으로 죽는 것보다 낫다
  try {
    await page.goto('/login', { timeout: 15_000 });
  } catch {
    await browser.close();
    throw new Error(`E2E 스택에 연결할 수 없습니다(${baseURL}). 먼저 기동하세요:  pnpm e2e:up`);
  }
  await page.getByLabel('이메일').fill(SEEDED_EMAIL);
  await page.getByLabel('비밀번호').fill(SEEDED_PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
