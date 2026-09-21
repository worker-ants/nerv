// 매뉴얼의 자리표시자 — **되박히는 것을 여기서 잡는다** (REQ-WEB-165)
//
// 이 기능의 실패는 둘 다 조용하다.
//   ① 오타 난 자리표시자(`{{sever}}`)는 그대로 화면에 찍힌다 — 문법 오류가 아니다.
//   ② 예시 주소를 본문에 **다시 박는 것**은 아무것도 깨뜨리지 않는다. 화면은 멀쩡히
//      뜨고, 그 자리를 복사한 사람만 남의 서버를 가리킨다.
// ②가 이 파일의 이유다: 설치 장은 열 자리에서 같은 값을 말하므로, 한 자리만 되박혀도
// 나머지 아홉이 맞다는 사실이 그 한 자리를 더 믿게 만든다.

import { describe, expect, it } from 'vitest';
import { MANUAL_CHAPTERS } from './manual.js';
import { MANUAL_EXAMPLE, fillManualVars, manualVars } from './manual-vars.js';

const LOCALES = ['ko', 'en'] as const;

describe('자리표시자 채우기', () => {
  it('아는 이름은 값으로, 모르는 이름은 그대로 둔다 — 조용히 지우면 오타가 빈칸이 된다', () => {
    const vars = manualVars({ server: 'https://api.acme.test', project: 'acme' });
    expect(fillManualVars('{{server}}/mcp · {{project}} · {{sever}}', vars)).toBe(
      'https://api.acme.test/mcp · acme · {{sever}}',
    );
  });

  it('값이 없거나 비면 예시값이 서고, 예시라는 사실이 함께 온다', () => {
    const vars = manualVars({ server: '   ', project: null });
    expect(vars.values.server).toBe(MANUAL_EXAMPLE.server);
    expect(vars.known.server).toBe(false);
    expect(vars.known.project).toBe(false);

    const filled = manualVars({ server: 'https://api.acme.test' });
    expect(filled.known.server).toBe(true);
    expect(filled.known.project).toBe(false);
  });

  it('값은 앞뒤 공백 없이 들어간다 — 주소 끝의 공백은 붙여 넣는 순간 다른 URL 이다', () => {
    expect(manualVars({ project: ' acme ' }).values.project).toBe('acme');
  });
});

describe('매뉴얼 본문', () => {
  it('모든 장에서 자리표시자가 남김없이 채워진다 — 오타는 화면에 그대로 찍힌다', () => {
    const vars = manualVars({
      server: 'https://api.acme.test',
      project: 'acme',
      role: 'developer',
      version: '9.9.9',
    });
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        const left = fillManualVars(chapter.body[locale], vars).match(/\{\{\w+\}\}/g);
        expect(left, `${chapter.id}/${locale} 에 모르는 자리표시자가 남았다`).toBeNull();
      }
    }
  });

  /**
   * **예시 주소·슬러그는 본문에 없어야 한다.** 이 둘은 자리표시자가 채우는 값이고,
   * 본문에 글자로 박히는 순간 그 자리만 이 배치를 가리키지 않게 된다. 예시값 자체는
   * `MANUAL_EXAMPLE` 한 곳에 있고, 값을 모를 때 그쪽에서 온다.
   */
  it('예시 주소·슬러그가 본문에 글자로 박혀 있지 않다', () => {
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        const body = chapter.body[locale];
        for (const example of [MANUAL_EXAMPLE.server, MANUAL_EXAMPLE.project]) {
          expect(body, `${chapter.id}/${locale} 에 ${example} 가 박혀 있다`).not.toContain(example);
        }
      }
    }
  });
});
