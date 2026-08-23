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
