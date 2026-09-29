// 내 계정 · 로그인 전 언어 — 실물 스택에서만 보이는 것 (2026-09-25 — 사람 결정 D10 · REQ-WEB-229 · 230)
//
// 이름·비밀번호를 **바꾸는** 흐름은 L2(`apps/api/test/integration/account.spec.ts`)와 L1 이 태운다 — 여기서
// 바꾸면 이 스위트가 함께 쓰는 시드 세션이 끊긴다("다른 기기의 로그인을 모두 끊습니다"). 여기서 보는 것은
// 조립이다: 셸 밖 화면에 언어 단추가 실제로 서고 누르면 화면이 바뀌는가 · 내 계정이 실제 /me 로 서는가 ·
// 로그인된 기기 탭이 실제 세션을 읽는가(2026-09-28).

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
    // 비밀번호는 자기 탭에 있다(2026-09-28 · REQ-WEB-283) — 탭은 주소에 남는다
    await page.getByTestId('account-tab-password').click();
    await expect(page).toHaveURL(/tab=password/);
    await expect(page.getByTestId('account-revoke-others')).toBeChecked();
    // 사용자 메뉴에서도 온다
    await page.getByTestId('user-menu').click();
    await expect(page.getByTestId('user-menu-account')).toHaveAttribute(
      'href',
      '/settings/account',
    );
  });

  test('로그인된 기기 탭이 실제 세션을 보인다 — 지금 쓰는 기기에는 [끊기]가 없다 (REQ-WEB-284)', async ({
    page,
  }) => {
    // [다른 기기 로그인 모두 끊기]는 누르지 않는다 — 같은 스택에서 도는 다른 스위트의 로그인까지 끊는다.
    // 끊는 흐름은 L2(`account.spec.ts` · EP-AUTH-04 · 05)와 L1 이 태운다
    await page.goto('/settings/account?tab=devices');
    const rows = page.getByTestId('account-device');
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    const current = rows.filter({ hasText: '이 기기' });
    await expect(current).toHaveCount(1);
    await expect(current.getByTestId('account-device-revoke')).toHaveCount(0);
    await expect(page.getByTestId('account-tab-devices')).toHaveAttribute('aria-current', 'page');
  });
});
