// 받은 요청의 조직 · 프로젝트 칸 — 진짜 API 가 센 결정 수로 칸을 그리고, 고르면 목록이 그 프로젝트로 좁혀진다
// (2026-09-27 사람 결정 N1 · N2 · REQ-WEB-256 · REQ-API-217·218)
//
// 칸의 규칙은 L1 이 가짜 응답으로 센다(`inbox-scope.spec.tsx`). 여기서 보는 것은 새 경로
// (`/approvals/scopes` — `:id` 보다 먼저 선언해야 한다)와 `?org=&project=` 가 실제 스택에서 답하는가다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('받은 요청의 칸에서 프로젝트를 고르면 그 프로젝트의 카드만 남는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const scopes = page.waitForResponse(
    (res) => res.url().includes('/api/v1/approvals/scopes') && res.status() === 200,
  );
  await page.goto('/inbox');
  await scopes;
  const rail = page.getByTestId('scope-rail');
  await expect(rail).toBeVisible({ timeout: 15_000 });

  const project = rail.locator('[data-testid^="scope-project-"][data-testid$="-clemvion"]');
  await expect(project).toHaveCount(1);
  const narrowed = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/approvals?') &&
      res.url().includes('project=clemvion') &&
      res.status() === 200,
  );
  await project.click();
  await narrowed;
  await expect(page).toHaveURL(/project=clemvion/);
  await expect(page.getByText(/의 받은 요청입니다\. 왼쪽 칸에서/)).toBeVisible();
  // 남은 카드는 모두 그 프로젝트의 것이다 — 줄의 프로젝트 표시가 말한다
  const badges = page.getByTestId('approval-card').getByTestId('scope-badge');
  const count = await badges.count();
  for (let i = 0; i < count; i += 1) {
    await expect(badges.nth(i)).toContainText(/clemvion/i);
  }
});
