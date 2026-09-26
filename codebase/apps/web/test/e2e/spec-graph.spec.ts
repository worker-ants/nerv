// 관계 그래프 — 같은 데이터는 같은 그림 (screens.md §2.4a · REQ-WEB-245 · 246)
//
// **열 때마다 배치가 달라서 자리를 익힐 수 없었다**(2026-09-27 사람 보고). 판정은 캔버스 안을
// 들여다보지 않고 그래프 상자의 `data-layout`(잎 자리의 서명)으로 한다. 새로 계산한 그림과
// 적어 둔 그림이 같은지도 보아야 해서, 새로 고치기 전에 기억(`localStorage`)을 지운다 —
// 지우지 않으면 두 번째는 기억을 꺼내 쓰므로 "계산이 결정적인가" 를 재지 못한다.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

const CACHE = 'nerv.graph.layout.v1';

async function signature(page: Page): Promise<string> {
  const graph = page.getByTestId('spec-graph');
  await expect(graph).toHaveAttribute('data-layout', /.+/, { timeout: 15000 });
  return (await graph.getAttribute('data-layout')) ?? '';
}

async function reopen(page: Page, path: string): Promise<string> {
  await page.evaluate((key) => window.localStorage.removeItem(key), CACHE);
  await page.goto(path);
  return signature(page);
}

test('새로 고쳐도 같은 그림이다 — [다른 배치]는 번호를 주소에 남긴다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/specs?view=graph');
  const first = await signature(page);

  // 기억을 지우고 다시 연다 — **새로 계산해도** 같은 자리다
  expect(await reopen(page, '/p/clemvion/specs?view=graph')).toBe(first);

  // [다른 배치] — 다른 그림이고, 번호가 주소에 남는다
  await page.getByTestId('graph-relayout').click();
  await expect(page).toHaveURL(/layout=2/);
  await expect(page.getByTestId('graph-layout-n')).toContainText('2');
  const second = await signature(page);
  expect(second).not.toBe(first);

  // 그 주소를 건네받은 사람도 같은 그림을 본다
  expect(await reopen(page, '/p/clemvion/specs?view=graph&layout=2')).toBe(second);

  // [처음 배치] — 번호가 주소에서 빠지고 처음 그림으로 돌아온다
  await page.getByTestId('graph-layout-reset').click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect.poll(() => signature(page)).toBe(first);
});

test('WebGL 로 그릴 수 있으면 WebGL 로 그린다 — 도움말에서 캔버스로 되돌릴 수 있다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/specs?view=graph');
  await signature(page);
  const webgl2 = await page.evaluate(
    () => document.createElement('canvas').getContext('webgl2') !== null,
  );
  // WebGL 모드는 캔버스 한 겹을 더 둔다(cytoscape — 2D 셋 + WebGL 하나)
  const layers = (): Promise<number> => page.getByTestId('spec-graph').locator('canvas').count();
  expect(await layers()).toBe(webgl2 ? 4 : 3);

  await page.getByTestId('graph-help').click();
  const toggle = page.getByTestId('graph-webgl');
  if (!webgl2) {
    await expect(toggle).toBeDisabled();
    return;
  }
  await expect(toggle).toBeChecked();
  // 끄면 화면을 다시 불러와 캔버스로 그린다 — 같은 그림이다(렌더러는 자리를 바꾸지 않는다)
  const before = await signature(page);
  // `uncheck()` 는 체크가 풀리기를 기다리는데, 그 전에 화면이 다시 불러와져 요소가 사라진다
  await Promise.all([page.waitForEvent('load'), toggle.click()]);
  expect(await signature(page)).toBe(before);
  expect(await layers()).toBe(3);
  // 되돌려 둔다 — 같은 브라우저 상태를 쓰는 다음 검사가 캔버스로 그리지 않게
  await page.evaluate(() => window.localStorage.removeItem('nerv.graph.webgl'));
});
