// 내 계정 · 로그인 전 언어 — 실물 스택에서만 보이는 것 (2026-09-25 — 사람 결정 D10 · REQ-WEB-229 · 230)
//
// 이름·비밀번호를 **바꾸는** 흐름은 L2(`apps/api/test/integration/account.spec.ts`)와 L1 이 태운다 — 여기서
// 바꾸면 이 스위트가 함께 쓰는 시드 세션이 끊긴다("다른 기기의 로그인을 모두 끊습니다"). 여기서 보는 것은
// 조립이다: 셸 밖 화면에 언어 단추가 실제로 서고 누르면 화면이 바뀌는가 · 내 계정이 실제 /me 로 서는가.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test('로그인 화면에서 언어를 바꾼다 — 로그인하기 전이다', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/login');
  const switcher = page.getByTestId('locale-switch');
  await expect(switcher.getByTestId('locale-en')).toHaveAttribute('aria-pressed', 'true');
  await switcher.getByTestId('locale-ko').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByTestId('signup-link')).toHaveText(/계정/);
  await context.close();
});

test.describe('시드 세션', () => {
  test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

  test('내 계정이 실제 /me 로 선다 — 이메일은 보기만, 바꾸기 전에는 [저장]이 꺼져 있다', async ({
    page,
  }) => {
    await page.goto('/settings/account');
    const name = page.getByTestId('account-name');
    await expect(name).not.toHaveValue('', { timeout: 15000 });
    await expect(page.getByTestId('account-email')).toContainText('@');
    await expect(page.getByTestId('account-name-save')).toBeDisabled();
    await expect(page.getByTestId('account-revoke-others')).toBeChecked();
    // 사용자 메뉴에서도 온다
    await page.getByTestId('user-menu').click();
    await expect(page.getByTestId('user-menu-account')).toHaveAttribute(
      'href',
      '/settings/account',
    );
  });
});
