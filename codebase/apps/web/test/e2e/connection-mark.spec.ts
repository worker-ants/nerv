// 헤더의 연결 표시 — 실시간만 끊긴 것은 배너가 아니다 (2026-09-26 — 사람 결정 D8 · screens.md §1.3 · REQ-WEB-002)
//
// 규칙(무엇을 세우나 · 누르면 무엇을 말하나 · 다시 붙으면 거두나)은 L1 이 가짜 소켓으로 센다
// (`connection-mark.spec.tsx`). 여기서만 볼 수 있는 것은 **진짜 브라우저의 진짜 소켓이 끊겼을 때** 그 표시가
// 서는가다 — 붙은 소켓을 길목(`routeWebSocket`)에서 끊고, 다시 붙으려는 시도를 막는다. REST 는 그대로 닿으므로
// 배너는 서지 않는다.
//
// 핸드셰이크 전에 닫으면 socket.io 는 오류도 끊김도 알리지 않고 붙는 중에 머문다(2026-09-26 실측) — 그래서 한 번
// 붙인 뒤에 끊는다. 서버가 아예 닿지 않는 경우(`connect_error`)는 L1 `ws.spec.ts` 가 본다.

import { expect, test } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('실시간 길이 끊기면 헤더에 "실시간 끊김" 이 서고 배너는 서지 않는다', async ({ page }) => {
  // 첫 연결은 서버로 보내 붙게 두고, 붙은 뒤 끊는다. 다시 붙으려는 시도는 길목에서 막는다
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\//, (ws) => {
    sockets.push(ws);
    if (sockets.length === 1) ws.connectToServer();
    else void ws.close();
  });
  await page.goto('/inbox');
  await expect.poll(() => sockets.length).toBe(1);
  // 붙어 있는 동안에는 아무것도 없다 — 정상은 조용하다
  await expect(page.getByTestId('approval-card').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('connection-mark')).toHaveCount(0);
  await sockets[0]!.close();

  const mark = page.getByTestId('connection-mark');
  await expect(mark).toHaveAttribute('data-level', 'ws', { timeout: 15_000 });
  await expect(mark).toHaveText('실시간 끊김');
  // 쓰기는 된다 — 오프라인 배너도, 잠긴 주 단추도 없다
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);

  await mark.click();
  const detail = page.getByTestId('connection-detail');
  await expect(detail).toContainText('15초마다 새로 받습니다');
  await expect(detail).toContainText('끊겼습니다');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(mark).toBeFocused();
});
