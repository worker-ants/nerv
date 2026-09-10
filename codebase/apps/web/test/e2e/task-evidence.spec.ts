// 작업 상세의 증적 링크 — screens.md §2.5 ⑥ · REQ-WEB-159~162 · REQ-API-157
//
// **이 판정이 여기 있는 이유.** 링크의 규칙 자체는 L1 이 태운다(`lib/evidence.spec.ts`).
// 여기서 보는 것은 그 규칙이 **실제 서버가 준 값 위에서** 성립하는가다 — 프로젝트의
// `repo_url`·`default_branch`·`repo_host`, 증적의 `repo`, 그리고 EP-TASK-04 가 그 필드를
// 실제로 싣는가까지가 한 줄에 걸려 있고, 그중 하나만 빠져도 링크는 조용히 틀린 곳으로 간다.
//
// 2026-09-10 까지 이 판정을 쓸 수 없었다 — 시드의 `evidence` 가 0건이라 증적 카드가 늘
// 비어 있었다(database.md §4). 시드가 종류 여섯을 심고 나서야 길이 생겼다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

/** 시드의 프로젝트 저장소 — `.git` 꼬리가 붙어 있다(걷는지까지 함께 본다) */
const REPO = 'https://git.example.com/nerv/clemvion';

test('증적은 종류마다 갈 곳으로 새 탭에서 열린다', async ({ page }) => {
  await page.goto('/p/clemvion/tasks/CLV-T-1KTDCK');
  const rows = page.getByTestId('task-evidence');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });

  const links = await page.getByTestId('evidence-link').evaluateAll((els) =>
    els.map((el) => ({
      text: (el.textContent ?? '').trim(),
      href: el.getAttribute('href'),
      target: el.getAttribute('target'),
      rel: el.getAttribute('rel'),
    })),
  );
  const hrefOf = (text: string): string | null | undefined =>
    links.find((l) => l.text === text)?.href;

  // PR 은 locator 자체가 주소다
  expect(hrefOf('https://git.example.com/nerv/clemvion/pull/481')).toBe(
    'https://git.example.com/nerv/clemvion/pull/481',
  );
  // 커밋·코드 경로는 프로젝트 저장소 위에 선다 — `.git` 꼬리는 걷는다
  expect(hrefOf('7b22ce90aa')).toBe(`${REPO}/commit/7b22ce90aa`);
  // `:88` 은 앵커로 옮긴다
  expect(hrefOf('codebase/frontend/src/widget/session.ts:88')).toBe(
    `${REPO}/blob/main/codebase/frontend/src/widget/session.ts#L88`,
  );
  // 리뷰 증적은 리뷰 센터의 그 발견으로(REQ-WEB-120 이 거기서 받는다)
  expect(hrefOf('01990a66-0000-7000-8000-0000000000f8')).toBe(
    '/p/clemvion/reviews?finding=01990a66-0000-7000-8000-0000000000f8',
  );
  // 매뉴얼의 장 — 실재하는 장일 때만
  expect(hrefOf('/help/tasks')).toBe('/help/tasks');

  // **테스트 이름은 링크가 아니다** — 짐작해서 만든 주소는 틀린 곳으로 데려간다
  expect(hrefOf('widget/session.spec.ts > 이전 대화를 복원한다')).toBeUndefined();
  await expect(page.getByTestId('evidence-link')).toHaveCount(5);

  // 전부 새 탭이다 — 이 화면에서 done 전이를 채우는 중일 수 있다
  for (const link of links) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer');
  }

  // 저장소 주소가 있으므로 없는 문제를 말하지 않는다
  await expect(page.getByTestId('evidence-no-repo')).toHaveCount(0);
});

test('다른 저장소에 선 증적은 그쪽으로 간다 — 호스트만 프로젝트에서 빌린다', async ({ page }) => {
  await page.goto('/p/clemvion/tasks/CLV-T-TRA25N');
  await expect(page.getByTestId('task-evidence').first()).toBeVisible({ timeout: 15000 });

  // `evidence.repo` 가 `nerv/clemvion-api` 다 — 경로만 갈아 끼우고 호스트는 그대로다
  await expect(page.getByTestId('evidence-link')).toHaveAttribute(
    'href',
    'https://git.example.com/nerv/clemvion-api/commit/5c31aa7b02',
  );
});

test('리뷰 증적을 누르면 그 발견이 리뷰 센터에 펴진다 — 링크가 실제로 닿는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 새 탭으로 열리므로 주소를 따라간다 — 여기서 보는 것은 **그 주소가 닿는가** 다
  await page.goto('/p/clemvion/reviews?finding=01990a66-0000-7000-8000-0000000000f8');
  await expect(page.getByTestId('review-rail')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('finding-rail')).toContainText('세션 토큰');
});
