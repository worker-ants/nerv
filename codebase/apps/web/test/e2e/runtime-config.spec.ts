// L3 웹 — 런타임 설정 (4.1 §2.3 3단계 · docs/04-mvp/codebase.md §5.2d)
//
// **여기서만 확인할 수 있는 것은 "앞문이 실제로 그 응답을 내어 주는가" 다.** 로더의 판정은
// L1 이 전수로 세지만(`lib/config.spec.ts`), 그 로더가 읽는 파일은 nginx 템플릿의 치환이
// 만든다 — 이미지의 `ENV` 기본값이 없으면 `${NERV_API_URL}` 이 문자 그대로 실려 나가고,
// 화면은 그것을 오리진으로 읽지 못해 조용히 같은 오리진으로 폴백한다. 주소를 설정한 줄
// 아는 운영자만 남는 종류의 침묵이라, 실물 응답을 여기서 본다.

import { expect, test } from '@playwright/test';

// 화면 문구를 보는 검사가 하나 있어 로케일을 못 박는다 — 기계의 locale 에 따라 대상이
// 바뀌면 같은 코드가 어떤 기계에서만 빨갛다(shell.spec 이 같은 이유로 그렇게 한다).
test.use({ locale: 'ko-KR' });

test('앞문이 `/config.json` 을 내어 준다 — 화면이 부팅 때 읽는 그 파일이다', async ({
  request,
  baseURL,
}) => {
  const res = await request.get('/config.json');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/json');

  // **치환이 실제로 일어났는가.** 여기 `${`가 남아 있으면 이미지의 ENV 기본값이 없는 것이다.
  const raw = await res.text();
  expect(raw).not.toContain('${');

  // 이 스택은 앞문 하나라 화면 주소와 API 주소가 같다 — 값은 그 오리진이다.
  const body = JSON.parse(raw) as { api_url?: string };
  expect(body.api_url).toBe(new URL(baseURL ?? '').origin);
});

test('설정은 캐시하지 않는다 — 옛 사본을 쥔 탭은 옛 API 로 간다', async ({ request }) => {
  const res = await request.get('/config.json');
  expect(res.headers()['cache-control']).toContain('no-store');
});

test('설정을 읽은 뒤 화면이 선다 — 부팅이 그 값을 기다린다', async ({ page }) => {
  // 로더가 던지거나 매달리면 첫 화면이 뜨지 않는다(`main.tsx` 가 await 한다).
  // **같은 오리진 배치에서는 절대 주소와 상대 경로의 결과가 같아서** 브라우저 밖에서는
  // 둘을 구별할 수 없다 — 그래서 여기서 세는 것은 "설정을 읽고도 화면이 선다" 까지다.
  await page.goto('/login');
  await expect(page.getByLabel('이메일')).toBeVisible();
});
