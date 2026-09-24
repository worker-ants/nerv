// 초대 메일이 **실제로 도착하는가** (2026-09-22 · 사람 결정 · 4.3 §2.17)
//
// L2 는 아웃박스에 줄이 섰는지까지 본다. 그런데 줄이 선 것과 사람이 받은 것은 **다른 일**이다 —
// 그 사이에 워커·SMTP·From 헤더가 있고, 셋 중 하나만 틀려도 아무도 받지 못하면서 DB 에는
// `sent_at` 이 선다. 그래서 여기서는 받은 편지함(mailpit)을 직접 읽는다.
//
// 이 저장소가 바로 이번 주에 배운 것이기도 하다: 그림으로 남은 적이 없는 화면은 깨진 채로
// 산다(REQ-WEB-164 계열). 사람이 받는 **메일**도 같은 부류다.
import { expect, test } from '@playwright/test';
import { ADMIN_STORAGE_STATE } from './global-setup.js';

test.use({ storageState: ADMIN_STORAGE_STATE, locale: 'ko-KR' });

/** 받은 편지함 — compose 가 연 포트는 세션마다 다르다(`e2e-stack.mjs` 가 슬롯을 잡는다) */
const MAILPIT = `http://localhost:${process.env['NERV_E2E_MAIL_PORT'] ?? '19003'}`;

interface Inbox {
  messages: { ID: string; Subject: string; To: { Address: string }[] }[];
}

test('초대를 만들면 그 주소로 메일이 도착한다 — 본문에 수락 링크가 있다', async ({
  page,
  request,
}) => {
  // **테스트 시한이 기다림보다 길어야 한다**(2026-09-24 — CI 실측). 아래 폴링은 워커의 한 틱
  // (60초)을 넘겨 90초까지 기다리는데, 테스트 기본 시한이 60초라 **폴링이 끝나기 전에 테스트가
  // 먼저 끊겼다** — 틱이 늦게 걸린 러너에서만 빨간 검사였고(규약 7), 그동안은 운으로 통과했다.
  // 초대를 만드는 데 드는 시간 + 폴링 90초 + 본문 확인을 담는다.
  test.setTimeout(150_000);

  // 같은 주소로 두 번 돌면 앞의 초대가 회수되고 메일이 두 통이 된다 — 매 실행을 갈라 둔다
  const to = `invitee-${Date.now()}@e2e.invalid`;

  await page.goto('/settings/members');
  await page.getByTestId('invite-new').click();
  await page.getByTestId('invite-email').fill(to);
  await page.getByRole('button', { name: /초대/ }).last().click();

  // 화면은 **보냈다**고 말해야 한다 — 링크 복사 경로도 함께 남는다(REQ-WEB-087)
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 15_000 });

  // 워커는 하트비트 간격(60초)으로 돈다. 그 한 틱을 기다린다 — 여기서 짧게 끊으면
  // "느린 러너에서만 빨간" 검사가 된다(규약 7).
  const message = await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/messages?limit=50`);
        if (!res.ok()) return null;
        const inbox = (await res.json()) as Inbox;
        return inbox.messages.find((m) => m.To.some((t) => t.Address === to)) ?? null;
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .not.toBeNull()
    .then(async () => {
      const res = await request.get(`${MAILPIT}/api/v1/messages?limit=50`);
      const inbox = (await res.json()) as Inbox;
      return inbox.messages.find((m) => m.To.some((t) => t.Address === to))!;
    });

  // 제목은 **누가 불렀는지**를 말한다 — 받는 사람이 스팸과 가르는 단서다
  expect(message.Subject).toContain('NERV');

  const body = await request.get(`${MAILPIT}/api/v1/message/${message.ID}`);
  const detail = (await body.json()) as { Text: string; From: { Address: string } };
  // **수락 링크가 이 메일의 전부다.** 없으면 받은 사람이 할 수 있는 일이 없다.
  expect(detail.Text).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}/);
  // 그리고 화면 주소로 서 있어야 한다 — API 주소를 실으면 사람이 여는 순간 404 다
  // (이 저장소가 첨부에서 겪은 그 자리다 · REQ-WEB-166)
  expect(detail.Text).not.toContain('/api/');
  expect(detail.From.Address).toBe('no-reply@e2e.invalid');
});
