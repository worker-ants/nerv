// 스펙 사이를 옮길 때 화면이 앞 문서를 들고 있지 않은지 — E2E 여야 하는 이유가 있다.
//
// 이 결함은 **실제 편집기와 실제 라우팅이 함께 있어야** 재현된다: 문서가 도착하기 전
// `doc_status` 기본값이 `draft` 라 편집기가 잠깐 편집 가능 상태가 되고, 그 사이 TipTap 이
// 울린 갱신이 부모의 `draft` 를 채운다. 라우트 파라미터만 바뀌면 그 `draft` 가 살아남아
// 다음 문서 위에 앞 문서의 본문이 그대로 남는다(실측 2026-08-23).
//
// jsdom 단위 테스트로 먼저 써 봤더니 **수정을 빼도 통과했다** — 잡지 못하는 테스트는
// 없는 것보다 나쁘다. 그래서 여기로 옮겼다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 로그인 세션을 실어야 한다 — 빠뜨리면 테스트가 로그인 화면에서 조용히 실패한다(실측)
test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('다른 스펙으로 옮기면 본문이 그 문서 것으로 바뀐다', async ({ page }) => {
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  const body = page.getByTestId('editor-content');
  await expect(body).toContainText('위젯', { timeout: 15000 });
  const first = (await body.textContent()) ?? '';

  // 사이드바 트리로 이동 — 새로고침이 아니라 **SPA 내비게이션**이어야 한다
  await page.getByTestId('spec-tree').first().getByText('세션 복원 API').first().click();
  await expect(page).toHaveURL(/SPC-CWC-012/);

  // 제목만 바뀌고 본문이 앞 문서로 남는 것이 이 결함이었다
  await expect(body).not.toHaveText(first, { timeout: 15000 });
  await expect(body).toContainText('세션 복원');
});

// 레일 탭 다섯(관계·요구사항·버전·첨부·코멘트)은 17rem 레일보다 넓다 — 그 자체는 정상이고,
// 문제는 **무엇이 밀리느냐**였다: 세로만 흐르게 하려던 `overflow-y-auto` 가 CSS 규칙상
// 가로도 `auto` 로 만들어(한 축이 visible 이 아니면 다른 축도 auto 다) 레일 전체가 가로
// 스크롤 상자가 됐고, 바닥의 막대를 밀면 탭 줄과 목록이 **함께** 옆으로 갔다(사람 보고
// 2026-09-08). 이 판정은 실제 폭이 있어야 성립한다 — jsdom 은 scrollWidth 를 재지 않아
// 클래스 이름밖에 못 본다(이 파일 머리의 이유와 같다).
test('레일이 좁아도 옆으로 미는 것은 탭 줄뿐이고, 마지막 탭에 닿는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  const tabs = page.getByTestId('rail-tabs');
  await expect(tabs).toBeVisible({ timeout: 15000 });

  const overflow = await tabs.evaluate((el) => ({
    tabs: el.scrollWidth - el.clientWidth,
    rail: ((r) => (r === null ? -1 : r.scrollWidth - r.clientWidth))(el.closest('aside')),
  }));
  // 넘치지 않으면 이 테스트가 검사할 것이 없다 — 전제부터 확인한다(시드 실측 37px)
  expect(overflow.tabs).toBeGreaterThan(0);
  // 레일은 옆으로 밀리지 않는다: 목록이 탭을 따라 움직이면 고정된 탭 줄이 아니다
  expect(overflow.rail).toBeLessThanOrEqual(1);

  // 그리고 밀면 끝에 닿아야 한다 — 스크롤 상자인데 마지막 탭이 잘려 있으면 고친 것이 아니다
  await tabs.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const last = page.getByTestId('rail-tab-comments');
  const [box, strip] = [await last.boundingBox(), await tabs.boundingBox()];
  expect(box).not.toBeNull();
  expect(strip).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(strip!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
});

// 상한이 두 겹이었다 — 컨테이너 80rem 과 본문 44rem. 그래서 창을 1512px 위로 넓혀도
// 늘어나는 것은 좌우 여백뿐이었고 레일은 오른쪽 끝에서 한참 떨어져 섰다(사람 지시
// 2026-09-08 · 4.5 §2.4d 점화 기록). 상한을 걷었다는 것은 **폭을 재야** 확인된다 —
// 클래스 이름만 보는 검사는 격자가 실제로 자라는지 말하지 못한다.
test('창을 넓히면 본문이 따라 넓어지고 레일은 오른쪽 끝에 붙어 있다', async ({ page }) => {
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  await expect(page.getByTestId('spec-body')).toBeVisible({ timeout: 15000 });

  const measure = async (width: number): Promise<Record<string, number>> => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const at = (sel: string): DOMRect =>
        (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
      const rail = (document.querySelector('[data-testid="rail-tabs"]') as HTMLElement).closest(
        'aside',
      ) as HTMLElement;
      const doc = document.documentElement;
      return {
        body: Math.round(at('[data-testid="spec-body"]').width),
        railRightGap: Math.round(doc.clientWidth - rail.getBoundingClientRect().right),
        docOverflow: doc.scrollWidth - doc.clientWidth,
      };
    });
  };

  const narrow = await measure(1280);
  const wide = await measure(1920);

  // 레일은 페이지 좌우 여백(px-6 = 24px)만 남기고 오른쪽 끝에 붙는다
  expect(narrow['railRightGap']).toBeLessThanOrEqual(26);
  expect(wide['railRightGap']).toBeLessThanOrEqual(26);
  // 창이 640px 넓어지면 본문도 그만큼 넓어진다 — 상한이 남아 있으면 여기서 멈춘다
  expect(wide['body'] - narrow['body']).toBeGreaterThan(500);
  // 그리고 어느 폭에서도 문서가 가로로 밀리지 않는다(REQ-WEB-151)
  expect(narrow['docOverflow']).toBeLessThanOrEqual(1);
  expect(wide['docOverflow']).toBeLessThanOrEqual(1);
});

// 레일 머리(탭 줄 + 방향 하위 탭)는 레일을 내려도 위에 붙어 있어야 한다 — 관계 93건짜리
// 문서에서 목록을 내리면 "지금 어느 탭인가" 와 "방향을 바꾸려면 어디로" 가 함께 사라졌다
// (사람 지시 2026-09-08 · REQ-WEB-153). `position: sticky` 는 **스크롤 상자 기준**이라
// 실제로 붙는지는 스크롤이 일어나야 보인다 — jsdom 이 못 보는 자리다.
//
// 시드 문서는 관계 0건이라 레일이 넘치지 않는다(사람이 본 것은 93건짜리 문서다). 그래서
// 높이를 만들어 준 뒤 스크롤한다 — 여기서 재는 것은 목록의 내용이 아니라 **레일이
// 스크롤될 때 머리가 제자리에 있는가** 라는 배치의 사실이다.
test('레일을 내려도 탭 줄과 방향 하위 탭은 위에 붙어 있다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  await expect(page.getByTestId('rail-head')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('rail-body').evaluate((body) => {
    const filler = document.createElement('div');
    filler.style.height = '1200px';
    body.appendChild(filler);
  });

  const pinned = await page.getByTestId('rail-head').evaluate((head) => {
    const rail = head.parentElement as HTMLElement;
    rail.scrollTop = 400;
    return {
      scrolled: Math.round(rail.scrollTop),
      // 붙지 않으면 머리는 스크롤한 만큼 **위로**(음수) 밀려난다 — 절댓값으로 잰다
      gap: Math.abs(
        Math.round(head.getBoundingClientRect().top - rail.getBoundingClientRect().top),
      ),
      subTabs: document.querySelector('[data-testid="rel-tab-all"]') !== null,
    };
  });

  // 전제 — 레일이 실제로 스크롤됐고, 방향 하위 탭도 머리에 있다
  expect(pinned.scrolled).toBeGreaterThan(0);
  expect(pinned.subTabs).toBe(true);
  // 그리고 머리는 레일 꼭대기에 그대로 있다(붙지 않으면 스크롤한 만큼 위로 밀려난다)
  expect(pinned.gap).toBeLessThanOrEqual(1);
});

// 페이드는 "이쪽에 더 있다" 는 신호다 — 실제 폭이 있어야 판정이 성립하므로 여기서 잰다
// (판정 자체는 `lib/scroll-edges.ts` 가, 배선은 L1 이 태운다 · REQ-WEB-154).
test('잘린 쪽만 흐리다 — 끝까지 밀면 그쪽 페이드는 사라진다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  const tabs = page.getByTestId('rail-tabs');
  await expect(tabs).toBeVisible({ timeout: 15000 });

  // 전제 — 탭 줄이 실제로 넘친다(넘치지 않으면 흐릴 것도 없다)
  expect(await tabs.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);

  // 처음에는 오른쪽만
  await expect(page.getByTestId('rail-tabs-fade-end')).toBeVisible();
  await expect(page.getByTestId('rail-tabs-fade-start')).toHaveCount(0);

  // 끝까지 밀면 왼쪽만 — 닿았는데 오른쪽이 남으면 "더 있다" 는 거짓말이 된다
  await tabs.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByTestId('rail-tabs-fade-start')).toBeVisible();
  await expect(page.getByTestId('rail-tabs-fade-end')).toHaveCount(0);
});
