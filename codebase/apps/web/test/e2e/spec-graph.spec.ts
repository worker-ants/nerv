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

const CACHE = 'nerv.graph.layout.v2';

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

test('그래프 위에서 포인터가 움직여도 장면이 빠지지 않는다 — WebGL', async ({ page }) => {
  // **연 직후 빈 채로 있다가 휠 · 터치 뒤에야 그려졌다**(2026-10-05 사람 보고). WebGL 렌더러는 포인터
  // 아래를 찾으려고 판정용 버퍼에 그리면서 화면의 "다시 그려라" 표시까지 지운다(`keepScreenRedraw`).
  // 그래프가 생긴 뒤 1.5초 동안 그래프 위에서 포인터가 움직이게 하고, 멈춘 뒤 그림이 남아 있는지
  // 본다. 고치기 전에는 빈 캔버스였다(점 0개).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const move = (canvas: Element): void => {
      const box = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: box.x + box.width / 2,
          clientY: box.y + box.height / 2,
        }),
      );
    };
    const canvasOf = (): Element | null =>
      document.querySelector('[data-testid="spec-graph"] canvas');
    // **매 장면 바로 앞에서** 포인터가 움직인다 — cytoscape 는 장면을 `requestAnimationFrame` 으로
    // 그리므로 그 콜백 앞에 끼운다. 타이머로 흉내 내면 다시 그리는 때를 가끔 놓쳐 결함을 못 잡았다
    // (3번 중 1번 통과). 캔버스가 생긴 뒤 1.5초 동안만 그렇게 한다.
    let since = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const canvas = canvasOf();
        if (canvas !== null) {
          if (since === 0) since = performance.now();
          if (performance.now() - since < 1500) move(canvas);
          else document.documentElement.dataset['movesDone'] = '1';
        }
        callback(time);
      });
  });
  await page.goto('/p/clemvion/specs?view=graph');
  await signature(page);
  const webgl2 = await page.evaluate(
    () => document.createElement('canvas').getContext('webgl2') !== null,
  );
  // WebGL 이 없으면 이 검사는 아무것도 재지 않는다 — 조용히 넘기지 않고 실패로 알린다
  expect(webgl2).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-moves-done', '1', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 캔버스 위에 얹은 조종기 · 범례 · 건수는 잠시 가린다 — 캔버스에 그린 것만 센다
  await page.addStyleTag({
    content: '[data-testid="spec-graph"] ~ * { visibility: hidden !important; }',
  });
  const graph = page.getByTestId('spec-graph');
  const box = await graph.boundingBox();
  if (box === null) throw new Error('그래프 상자가 없다');
  const shot = await page.screenshot({
    clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 },
  });
  const ink = await page.evaluate(async (b64) => {
    const background = getComputedStyle(
      document.querySelector('[data-testid="spec-graph"]')!,
    ).backgroundColor.match(/\d+/g)!;
    const [br, bg, bb] = background.map(Number);
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const far =
        Math.abs(data[i]! - br!) + Math.abs(data[i + 1]! - bg!) + Math.abs(data[i + 2]! - bb!);
      if (far > 30) count += 1;
    }
    return count;
  }, shot.toString('base64'));
  // 관계 그래프는 간선이 수백 개다 — 그려졌으면 수천 점을 넘는다(빈 캔버스는 0)
  expect(ink).toBeGreaterThan(2000);
});
