// L3 웹 — compose 스택 상대의 브라우저 시나리오 (codebase.md §4.3 · backlog.md §5.4)
//
// 여기서만 확인할 수 있는 것을 확인한다: **빌드된 SPA 가 실제 브라우저에서 서고**, 인증
// 리다이렉트·쿠키·프록시가 운영과 같은 조립에서 동작하는가. jsdom 단위 테스트가 다 통과해도
// 번들·라우터 초기화·nginx 폴백에서 깨지는 일이 있고, 그건 사용자가 첫 화면에서 만난다.

import { expect, test } from '@playwright/test';

const EMAIL = `e2e-${Date.now()}@example.com`;
const PASSWORD = 'nerv-e2e-password';

test.describe.configure({ mode: 'serial' });

test('미인증 사용자는 /login 으로 가고 원래 경로가 보존된다 (REQ-WEB-001)', async ({ page }) => {
  await page.goto('/p/clemvion/tasks');
  await page.waitForURL(/\/login/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/p/clemvion/tasks');
  await expect(page.getByText('스펙 단일 진실')).toBeVisible();
});

test('로그인 실패 사유는 폼 안에 뜨고 비밀번호만 지워진다 (REQ-WEB-005)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill('nobody@example.com');
  await page.getByLabel('비밀번호').fill('wrong-password-1234');
  await page.getByRole('button', { name: /로그인/ }).click();

  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page.getByLabel('비밀번호')).toHaveValue('');
  // 이메일은 지우지 않는다 — 다시 타이핑하게 만들지 않는다
  await expect(page.getByLabel('이메일')).toHaveValue('nobody@example.com');
});

test('가입 → 로그인 → 셸 진입 · ⌘K 퀵 스위처 (REQ-WEB-006 · REQ-WEB-040)', async ({
  page,
  request,
}) => {
  // better-auth 핸들러로 계정을 만든다 — 화면의 가입 경로는 MVP 에 없다(초대는 기존 사용자 배정)
  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { email: EMAIL, password: PASSWORD, name: 'E2E 사용자' },
  });
  expect(signUp.ok()).toBe(true);

  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();

  // 조직 0개 → 온보딩으로 착지한다(REQ-WEB-006)
  await page.waitForURL(/\/onboarding|\/inbox|\/$/);
  await expect(page.getByText('⬢ NERV')).toBeVisible();

  // ⌘K — 전 라우트 공통. 마우스 없이 열고 닫힌다
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quick-switcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-switcher')).toHaveCount(0);
});

test('로그아웃하면 세션이 끊기고 보호 경로가 다시 막힌다', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await expect(page.getByText('⬢ NERV')).toBeVisible();

  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL(/\/login/);

  await page.goto('/inbox');
  await page.waitForURL(/\/login/);
});
