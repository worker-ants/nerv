// 알림의 범위 칸 — 진짜 API 가 센 수로 칸을 그리고, 고르면 주소 · 머리 · 목록이 그 범위로 좁혀진다
// (2026-09-27 사람 결정 N1 · REQ-WEB-253 · REQ-API-214·215)
//
// 칸의 규칙(수를 어디에 · 무엇을 보내나)은 L1 이 가짜 응답으로 센다(`notifications-scope.spec.tsx`).
// 여기서만 볼 수 있는 것은 **서버의 범위별 수 · 좁힌 목록이 화면과 이어지는가**다 — 새 경로 둘
// (`/me/notifications/scopes` · `?org=&project=`)이 실제 스택에서 답하는지를 본다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('범위 칸에서 프로젝트를 고르면 주소 · 머리 · 목록 요청이 그 프로젝트로 좁혀진다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/notifications');
  const rail = page.getByTestId('scope-rail');
  await expect(rail).toBeVisible({ timeout: 15_000 });
  await expect(rail.getByTestId('scope-all')).toHaveAttribute('aria-current', 'true');

  // 내가 속한 프로젝트는 알림이 없어도 칸에 있다 — 시드의 clemvion
  const project = rail.locator('[data-testid^="scope-project-"][data-testid$="-clemvion"]');
  await expect(project).toHaveCount(1);
  const narrowed = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/me/notifications?') &&
      res.url().includes('project=clemvion') &&
      res.status() === 200,
  );
  await project.click();
  await narrowed;
  await expect(page).toHaveURL(/project=clemvion/);
  await expect(page.getByText(/의 알림입니다\. 왼쪽 칸에서/)).toBeVisible();
  await expect(project).toHaveAttribute('aria-current', 'true');

  // 다시 모든 조직으로 — 주소에서 범위가 빠진다
  await rail.getByTestId('scope-all').click();
  await expect(page).not.toHaveURL(/project=/);
});
