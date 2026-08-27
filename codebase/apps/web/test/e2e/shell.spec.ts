// L3 웹 — compose 스택 상대의 브라우저 시나리오 (codebase.md §4.3 · backlog.md §5.4)
//
// 여기서만 확인할 수 있는 것을 확인한다: **빌드된 SPA 가 실제 브라우저에서 서고**, 인증
// 리다이렉트·쿠키·프록시가 운영과 같은 조립에서 동작하는가. jsdom 단위 테스트가 다 통과해도
// 번들·라우터 초기화·nginx 폴백에서 깨지는 일이 있고, 그건 사용자가 첫 화면에서 만난다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 이 스펙은 한국어 화면을 검사한다 — 기계의 locale 에 따라 대상이 바뀌지 않게 못 박는다
test.use({ locale: 'ko-KR' });

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
  // 셸이 떴다는 것만 본다 — 로고 **글리프**를 문자로 못 박으면 조형을 바꿀 때마다
  // 깨진다(실측 2026-08-23: 글리프를 사각형 마크로 바꾸며 깨졌다). 이 테스트가 지키려는
  // 것은 브랜드 표기가 아니라 "가입 뒤 셸에 착지한다"이다.
  await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();

  // ⌘K — 전 라우트 공통. 마우스 없이 열고 닫힌다
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quick-switcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-switcher')).toHaveCount(0);
});

test('로그인 화면을 거쳐 들어와도 실시간이 붙는다 (D-14 배너가 걸린 채로 남지 않는다)', async ({
  page,
}) => {
  // **저장된 세션으로 시작하지 않는다**는 것이 이 테스트의 전부다.
  // 다른 E2E 는 storageState 로 이미 로그인된 채 시작해서 첫 WS 핸드셰이크가 성공한다 —
  // 그래서 "로그인 화면에서 붙었다가 거절당한 소켓은 다시 붙지 않는다"를 아무도 못 봤다.
  // socket.io 는 **서버가 끊은 연결**을 자동 재연결하지 않는다(`io server disconnect`).
  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  // 연결 배너는 끊겼을 때만 뜬다(§1.4) — 붙었으면 없어야 한다
  await expect(page.getByTestId('connection-banner')).toHaveCount(0, { timeout: 15_000 });
});

test('로그아웃하면 세션이 끊기고 보호 경로가 다시 막힌다', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();

  // 로그아웃은 사용자 메뉴 안에 있다(§1.3 "[사용자 메뉴 ▾]") — 헤더에 평문 버튼으로
  // 늘어놓지 않는 이유는 자주 쓰지 않는 항목이 자주 쓰는 항목의 자리를 먹기 때문이다.
  await page.getByTestId('user-menu').click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL(/\/login/);

  await page.goto('/inbox');
  await page.waitForURL(/\/login/);
});

test.describe('시드 세션', () => {
  // 저장된 세션을 쓴다 — 조직 스위처는 소속이 있어야 뜨므로 멤버십 있는 계정이어야 하고,
  // 매 테스트 로그인하면 스위트가 자기 인증 쿼터를 먹는다(§1.8).
  test.use({ storageState: STORAGE_STATE });

  test('헤더에 조직 스위처와 사용자 메뉴가 있다 (§1.3 레이아웃)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();

    // 헤더는 **조직 스코프**다 — 어느 조직을 보고 있는지가 화면에 없으면 다중 조직에서 길을 잃는다
    await expect(page.getByTestId('org-switcher')).toBeVisible();

    await page.getByTestId('user-menu').click();
    await expect(page.getByRole('link', { name: '설정' })).toBeVisible();
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();

    // 바깥을 누르면 닫힌다 — 열린 채로 남으면 다음 클릭이 먹히지 않는다
    await page.mouse.click(400, 400);
    await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0);
  });

  test('프로젝트 사이드바는 /p/:proj/* 에서만 나온다 (§1.3)', async ({ page }) => {
    // 받은 요청은 조직 스코프 화면이라 사이드바가 없는 것이 맞다
    await page.goto('/inbox');
    await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();
    await expect(page.locator('aside')).toHaveCount(0);

    // 프로젝트에 들어가면 탭과 스펙 트리가 함께 선다
    await page.goto('/p/clemvion');
    await expect(page.locator('aside')).toHaveCount(1);
    await expect(page.getByTestId('spec-tree')).toHaveCount(1);

    // S3 도 마찬가지다 — 좌측 트리는 셸이 소유하므로 중복 렌더가 없어야 한다(대조에서 발견)
    await page.goto('/p/clemvion/specs/SPC-CWC-007');
    await expect(page.getByTestId('spec-tree')).toHaveCount(1);

    // 예외는 스펙 목록 하나다 — 그 화면은 "사이드바 트리의 전체 화면 판"이라고
    // 문서가 규정한다(§2.4). 그래서 여기서만 둘이고, 그건 의도다.
    await page.goto('/p/clemvion/specs');
    await expect(page.getByTestId('spec-tree')).toHaveCount(2);
  });
});
