// 가입 → 인증 메일 → 확인 → 로그인 (2026-09-22 · 사람 결정 "강제")
//
// **이 한 줄이 못 돌면 아무도 가입하지 못한다.** 강제를 켠 배치에서 가입은 절반이고, 나머지
// 절반은 메일이다 — 메일이 안 가거나 링크가 틀리면 그 사람은 영영 들어오지 못하고, DB 에는
// 멀쩡한 계정이 남아 "가입은 됐다" 고 말한다. L2 는 그 절반을 볼 수 없다.
//
// 그래서 여기서 셋을 본다: **가입 직후 로그인이 막히는가** · **확인 메일이 도착하는가** ·
// **링크를 열면 실제로 들어가지는가**.
import { expect, test } from '@playwright/test';

// 저장된 세션을 쓰지 **않는다** — 가입은 익명으로 시작하는 유일한 경로다.
// 로케일은 못 박는다: 안 박으면 러너의 기본값(en)으로 떠서 한국어 라벨을 못 찾는다.
test.use({ locale: 'ko-KR' });

const MAILPIT = `http://localhost:${process.env['NERV_E2E_MAIL_PORT'] ?? '19003'}`;

interface Inbox {
  messages: { ID: string; Subject: string; To: { Address: string }[] }[];
}

test('가입하면 확인 메일이 오고, 링크를 열면 들어간다', async ({ page, request }) => {
  const email = `newbie-${Date.now()}@e2e.invalid`;
  const password = 'nerv-e2e-1234';

  await page.goto('/signup');
  await page.getByLabel('이름').fill('새 사람');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: /가입/ }).click();

  // 폼이 치워지고 안내가 선다 — 같은 값을 다시 칠 일이 없다(REQ-WEB-180)
  await expect(page.getByTestId('signup-check-mail')).toBeVisible({ timeout: 20_000 });

  // 메일이 도착할 때까지 — 워커는 하트비트 간격(60초)으로 돈다
  const found = await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/messages?limit=100`);
        if (!res.ok()) return null;
        const inbox = (await res.json()) as Inbox;
        return inbox.messages.find((m) => m.To.some((t) => t.Address === email))?.ID ?? null;
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .not.toBeNull()
    .then(async () => {
      const res = await request.get(`${MAILPIT}/api/v1/messages?limit=100`);
      const inbox = (await res.json()) as Inbox;
      return inbox.messages.find((m) => m.To.some((t) => t.Address === email))!;
    });

  const detail = (await (await request.get(`${MAILPIT}/api/v1/message/${found.ID}`)).json()) as {
    Text: string;
  };
  const link = /https?:\/\/\S*verify-email\S+/.exec(detail.Text)?.[0];
  expect(link, '인증 메일에 확인 링크가 있어야 한다').toBeTruthy();

  // **링크는 API 주소로 서고 callbackURL 이 화면 주소다** — 확인이 끝나면 앱으로 돌아온다.
  // 그 한 칸이 비면 사람은 API 호스트의 빈 페이지에 떨어진다.
  expect(link).toContain('callbackURL=');

  await page.goto(link!.replaceAll('&amp;', '&'));
  // `autoSignInAfterVerification` 이라 확인과 동시에 들어간다 — 로그인 화면이 아니다
  await page.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 30_000 });
  await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible({ timeout: 20_000 });
});

test('확인하지 않은 계정은 로그인이 막히고, 다시 보낼 길이 열린다', async ({ page }) => {
  const email = `unverified-${Date.now()}@e2e.invalid`;
  const password = 'nerv-e2e-1234';

  await page.goto('/signup');
  await page.getByLabel('이름').fill('미확인');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: /가입/ }).click();
  await expect(page.getByTestId('signup-check-mail')).toBeVisible({ timeout: 20_000 });

  // 로그인 화면에서 같은 계정으로 들어가려 하면 **자격증명 오류가 아니라** 미확인이다 —
  // 비밀번호를 다시 치라고 하면 이 사람은 영영 못 들어온다
  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: /^로그인$/ }).click();
  await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('login-resend')).toBeVisible();
});
