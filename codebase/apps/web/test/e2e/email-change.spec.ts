// 이메일 바꾸기 — 내 계정의 양식 → 옛 주소의 승인 → 새 주소의 확인 (2026-10-15 · 사람 결정 · REQ-WEB-229 · 314)
//
// L2(`apps/api/test/integration/email-change.spec.ts`)는 인증 스택의 응답과 아웃박스, 세션 행까지 본다. 사람이 겪는
// 것은 그 사이의 **배관**이다 — 양식이 보낸 요청이 승인 메일이 되고, 워커가 보내고, 메일의 링크가 API 를 거쳐 결과 화면
// 으로 돌아오고, 내 계정이 새 주소를 보인다. 어느 한 칸이 틀려도 DB 는 멀쩡하고 사람만 길을 잃는다
// (`password-reset.spec.ts` 와 같은 까닭).
//
// 새로 가입한 계정으로 돈다 — 시드 계정의 주소를 바꾸면 다른 스위트가 로그인하지 못한다. 로그인 요청은 보내지 않는다:
// 확인 링크가 자동으로 로그인시킨다(로그인 한도가 스위트 전체에 걸쳐 쌓이는 까닭은 `password-reset.spec.ts` 머리 주석).
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

test.use({ locale: 'ko-KR' });

const MAILPIT = `http://localhost:${process.env['NERV_E2E_MAIL_PORT'] ?? '19003'}`;

interface Inbox {
  messages: { ID: string; Subject: string; To: { Address: string }[] }[];
}

/** 그 주소로 온 메일 가운데 제목에 `subject` 가 든 것의 링크 — 워커는 하트비트 간격(60초)으로 돈다 */
async function linkFrom(
  request: APIRequestContext,
  to: string,
  subject: string,
  pattern: RegExp,
): Promise<string> {
  const pick = (inbox: Inbox) =>
    inbox.messages.find((m) => m.To.some((t) => t.Address === to) && m.Subject.includes(subject)) ??
    null;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/messages?limit=200`);
        return res.ok() ? pick((await res.json()) as Inbox) : null;
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .not.toBeNull();
  const inbox = (await (await request.get(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as Inbox;
  const detail = (await (
    await request.get(`${MAILPIT}/api/v1/message/${pick(inbox)!.ID}`)
  ).json()) as { Text: string };
  const link = pattern.exec(detail.Text)?.[0];
  expect(link, `${subject} 메일에 링크가 있어야 한다`).toBeTruthy();
  return link!.replaceAll('&amp;', '&');
}

test('내 계정에서 이메일을 바꾼다 — 옛 주소의 승인과 새 주소의 확인을 거친다', async ({
  page,
  request,
}) => {
  // 메일 세 통(가입 확인 · 승인 · 확인)을 차례로 기다린다 — 한 통에 90초까지
  test.setTimeout(360_000);

  const stamp = Date.now();
  const oldEmail = `change-old-${stamp}@e2e.invalid`;
  const newEmail = `change-new-${stamp}@e2e.invalid`;
  const password = 'nerv-e2e-1234';

  await page.goto('/login');
  const signedUp = await page.evaluate(
    async ({ email, password }) => {
      const config = (await fetch('/config.json')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))) as { apiBase?: string };
      const res = await fetch(`${config.apiBase ?? ''}/api/auth/sign-up/email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: '주소를 바꿀 사람' }),
      });
      return res.status;
    },
    { email: oldEmail, password },
  );
  expect(signedUp).toBe(200);
  // 확인 링크를 열면 그대로 로그인된다
  await page.goto(
    await linkFrom(request, oldEmail, '이메일 주소를 확인', /https?:\/\/\S*verify-email\S+/),
  );
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  // 양식 — 새 주소와 지금 비밀번호
  await page.goto('/settings/account');
  await page.getByTestId('account-email-new').fill(newEmail);
  await page.getByTestId('account-email-password').fill(password);
  await page.getByTestId('account-email-submit').click();
  const pending = page.getByTestId('account-email-pending');
  await expect(pending).toBeVisible({ timeout: 20_000 });
  await expect(pending).toHaveAttribute('data-stage', 'approve');
  await expect(page.getByTestId('account-email')).toHaveText(oldEmail);

  // 옛 주소의 승인 → 결과 화면
  await page.goto(await linkFrom(request, oldEmail, '승인', /https?:\/\/\S*verify-email\S+/));
  await expect(page.getByTestId('email-change-approved')).toBeVisible({ timeout: 20_000 });

  // 새 주소의 확인 — 이 브라우저는 그 사람으로 로그인해 있으니 로그인이 그대로 남는다
  const confirm = await linkFrom(request, newEmail, '새 이메일', /https?:\/\/\S*verify-email\S+/);
  await page.goto(confirm);
  await expect(page.getByTestId('email-change-done')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-change-to-account').click();
  await expect(page.getByTestId('account-email')).toHaveText(newEmail, { timeout: 20_000 });
  await expect(page.getByTestId('account-email-pending')).toHaveCount(0);

  // 같은 확인 링크는 다시 쓰이지 않는다
  await page.goto(confirm);
  await expect(page.getByTestId('email-change-invalid')).toBeVisible({ timeout: 20_000 });
});
