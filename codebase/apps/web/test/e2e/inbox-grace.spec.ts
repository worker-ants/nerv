// 보내기 전 5초 — 결정을 무를 길 (2026-09-25 · 사람 결정 D7 · screens.md §2.7 · REQ-WEB-237)
//
// 규칙(무엇을 언제 보내는가 · 무름 · 사라지면 곧장 보냄)은 L1 이 실제 5초로 센다
// (`decision-grace.spec.tsx`). 여기서만 볼 수 있는 것은 둘이다 — 진짜 브라우저에서 [취소]로
// 포커스가 가는가, 그리고 **줄어드는 막대가 정말 움직이는가**: 막대의 keyframes 는 테마
// (`tokens.css` 의 `--animate-grace`)에 있어 빌드가 그것을 싣지 않으면 막대는 가만히 선 줄이다.
//
// **이 스위트는 시드를 고치지 않는다** — 무르기만 한다. 결정이 나가면 뒤에 도는
// `shots.spec.ts` 의 받은 요청 그림이 바뀐다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('누른 승인은 5초 들고 있다가 나간다 — [취소]면 아무것도 나가지 않는다', async ({ page }) => {
  await page.goto('/inbox');
  const cards = page.locator('[data-testid="approval-card"][data-kind="approval"]');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });
  // 승인할 수 있는 카드 하나 — 앞선 스위트가 무엇을 가져갔든 남은 것 가운데서. **자리로** 집는다:
  // 단추로 거르면 누른 뒤 단추가 사라져 그 거름이 다른 카드를 가리킨다
  const index = await cards.evaluateAll((els) =>
    els.findIndex((el) => {
      const approve = el.querySelector('[data-testid="approve"]');
      return approve !== null && approve.getAttribute('aria-disabled') !== 'true';
    }),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const target = cards.nth(index);

  const decisions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/decision$/.test(request.url())) {
      decisions.push(request.url());
    }
  });

  await target.getByTestId('approve').click();
  const strip = target.getByTestId('decision-grace');
  await expect(strip).toContainText('승인: 5초 뒤에 보냅니다.');
  // 누른 단추가 사라졌다 — 포커스가 body 로 떨어지지 않고 [취소]에 선다
  await expect(target.getByTestId('decision-cancel')).toBeFocused();
  // 막대가 움직인다 — 테마의 keyframes 가 빌드에 실렸다
  const bar = strip.locator('[aria-hidden="true"]');
  await expect(bar).toHaveCount(1);
  expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe('grace');
  expect(await bar.evaluate((el) => getComputedStyle(el).animationDuration)).toBe('5s');

  await target.getByTestId('decision-cancel').click();
  await expect(strip).toHaveCount(0);
  await expect(target.getByTestId('approve')).toBeVisible();
  // 5초를 넘겨 기다려도 아무것도 나가지 않았다
  await page.waitForTimeout(5_500);
  expect(decisions).toEqual([]);
});
