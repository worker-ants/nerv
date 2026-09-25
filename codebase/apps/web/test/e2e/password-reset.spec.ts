// 비밀번호를 잊었을 때 — 로그인 화면 → 메일 → 링크 → 새 비밀번호 (2026-09-25 — 사람 결정 D10 · REQ-WEB-231)
//
// L2 는 아웃박스에 줄이 섰는지와 인증 스택의 응답까지 본다. 사람이 겪는 것은 그 사이의 **배관**이다 — 워커가
// 보내고, 메일의 링크가 API 를 거쳐 화면으로 돌아오고, 화면이 그 토큰으로 비밀번호를 정한다. 어느 한 칸이
// 틀려도 DB 는 멀쩡하고 사람만 못 들어온다(`signup-verify.spec.ts` 와 같은 까닭).
//
// 새로 가입한 계정으로 돈다 — 시드 계정의 비밀번호를 바꾸면 다른 스위트의 세션이 끊긴다.
//
// **로그인 요청을 한 번도 보내지 않는다**(2026-09-25 실측). 인증 스택의 로그인 한도는 "분당 10회" 라 적혀 있지만
// 실제로는 **마지막 요청 뒤 60초 동안 조용해야** 셈이 비워진다 — 한 IP 로 도는 이 스위트에서는 로그인이 스위트
// 전체에 걸쳐 쌓이고, 이 파일이 가입(자동 로그인)과 마지막 로그인으로 둘을 더하자 뒤에 도는
// `signup-verify.spec.ts` 가 429 를 받았다. 그래서 가입은 API 로 직접 하고(확인 전이라 로그인되지 않는다),
// "새 비밀번호로 들어가진다" 와 "확인하지 않은 계정도 들어간다" 는 L2(`password-reset.spec.ts`)가 태운다.
import { expect, test } from '@playwright/test';

test.use({ locale: 'ko-KR' });

const MAILPIT = `http://localhost:${process.env['NERV_E2E_MAIL_PORT'] ?? '19003'}`;

interface Inbox {
  messages: { ID: string; Subject: string; To: { Address: string }[] }[];
}

test('비밀번호를 잊으면 메일의 링크로 새로 정한다 — 링크는 한 번뿐이다', async ({
  page,
  request,
}) => {
  // 메일 폴링(90초)보다 시한이 길어야 한다 — invite-mail.spec 과 같은 결함이다(2026-09-24 CI 실측)
  test.setTimeout(180_000);

  const email = `forgot-${Date.now()}@e2e.invalid`;
  const first = 'nerv-e2e-1234';
  const next = 'nerv-e2e-5678';

  await page.goto('/login');
  // 가입은 화면이 아니라 API 로 — 가입 화면은 끝에 로그인을 한 번 부른다(위 머리 주석)
  const signedUp = await page.evaluate(
    async ({ email, password }) => {
      const config = (await fetch('/config.json')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))) as { apiBase?: string };
      const res = await fetch(`${config.apiBase ?? ''}/api/auth/sign-up/email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: '잊은 사람' }),
      });
      return res.status;
    },
    { email, password: first },
  );
  expect(signedUp).toBe(200);

  // 로그인 화면의 길 — 친 이메일을 들고 간다
  await page.getByLabel('이메일').fill(email);
  await page.getByTestId('forgot-link').click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByTestId('forgot-email')).toHaveValue(email);
  await page.getByTestId('forgot-submit').click();
  await expect(page.getByTestId('forgot-sent')).toBeVisible({ timeout: 20_000 });

  // 이 주소에는 확인 메일도 와 있다 — 제목으로 가른다. 워커는 하트비트 간격(60초)으로 돈다
  const pick = (inbox: Inbox) =>
    inbox.messages.find(
      (m) => m.To.some((t) => t.Address === email) && m.Subject.includes('비밀번호'),
    ) ?? null;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/messages?limit=100`);
        return res.ok() ? pick((await res.json()) as Inbox) : null;
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .not.toBeNull();
  const inbox = (await (await request.get(`${MAILPIT}/api/v1/messages?limit=100`)).json()) as Inbox;
  const detail = (await (
    await request.get(`${MAILPIT}/api/v1/message/${pick(inbox)!.ID}`)
  ).json()) as { Text: string };
  const link = /https?:\/\/\S*\/api\/auth\/reset-password\/\S+/.exec(detail.Text)?.[0];
  expect(link, '재설정 메일에 링크가 있어야 한다').toBeTruthy();

  // 링크는 API 가 토큰을 보고 화면으로 돌려보낸다 — 폼이 서야 한다
  await page.goto(link!.replaceAll('&amp;', '&'));
  await expect(page).toHaveURL(/\/reset-password\?token=/, { timeout: 20_000 });
  await page.getByTestId('reset-new').fill(next);
  await page.getByTestId('reset-confirm').fill(next);
  await page.getByTestId('reset-submit').click();
  await expect(page.getByTestId('reset-done')).toBeVisible({ timeout: 20_000 });

  // 한 번뿐이다 — 같은 링크를 다시 열면 폼이 아니라 "새 링크를 받으세요" 다
  await page.goto(link!.replaceAll('&amp;', '&'));
  await expect(page.getByTestId('reset-invalid')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reset-request-again')).toHaveAttribute('href', '/forgot-password');
});
