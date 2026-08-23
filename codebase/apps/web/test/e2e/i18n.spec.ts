// i18n — 화면과 응답이 **같은 언어**로 오는가.
//
// 단위 테스트는 카탈로그와 전환 기구를 본다. 여기서만 볼 수 있는 것은 조립된 상태다:
// 브라우저가 고른 언어가 화면에 적용되고, 그 언어가 API 로 넘어가 봉투의 message 까지
// 바뀌는가. 버튼은 영어인데 에러 토스트만 한국어인 상태가 바로 여기서 잡힌다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE });

test('브라우저 언어가 영어면 화면이 영어로 뜬다', async ({ browser }) => {
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    locale: 'en-US',
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('header').getByRole('link', { name: /Inbox/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await context.close();
});

test('브라우저 언어가 한국어면 화면이 한국어로 뜬다', async ({ browser }) => {
  const context = await browser.newContext({ storageState: STORAGE_STATE, locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('header').getByRole('link', { name: /승인함/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await context.close();
});

test('사용자가 고른 언어가 브라우저 언어를 이기고, 다시 열어도 남는다', async ({ browser }) => {
  const context = await browser.newContext({ storageState: STORAGE_STATE, locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto('/');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('locale-en').click();
  await expect(page.locator('header').getByRole('link', { name: /Inbox/ })).toBeVisible();

  // 새로 열어도 고른 값이 살아 있다 — 매번 다시 고르게 만들지 않는다
  const again = await context.newPage();
  await again.goto('/');
  await expect(again.locator('header').getByRole('link', { name: /Inbox/ })).toBeVisible();
  await context.close();
});

test('화면이 영어면 서버 응답도 영어다 — 절반만 번역된 화면을 막는다', async ({ browser }) => {
  const context = await browser.newContext({ storageState: STORAGE_STATE, locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/');

  // 화면이 실제로 보내는 헤더로 부른다(fetch 가 apiFetch 와 같은 규칙을 쓰게)
  const message = await page.evaluate(async () => {
    const res = await fetch('/api/v1/projects/no-such-project', {
      headers: { 'accept-language': document.documentElement.lang },
    });
    return ((await res.json()) as { message?: string }).message;
  });
  expect(message).toMatch(/[A-Za-z]/);
  expect(message).not.toMatch(/[가-힣]/);
  await context.close();
});
