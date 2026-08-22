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

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:8080';
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  await page.goto('/login');
  await page.getByLabel('이메일').fill(SEEDED_EMAIL);
  await page.getByLabel('비밀번호').fill(SEEDED_PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
