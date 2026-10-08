// 본문 축소 판정 — clemvion 두 사고의 모양을 재현한다 (api.md REQ-API-270 · 271)
//
// 본문은 합성한다. 실제 문서는 그 프로젝트의 것이라 여기 두지 않는다 — 재현에 필요한 것은 **모양**(크기 · 제목 수 ·
// 요구사항 수 · 어디가 잘렸나)이고, 그 수치는 2026-10-08 clemvion 실측 그대로다.

import { describe, expect, it } from 'vitest';
import { bodyChange, bodyShape } from './body-shrink.js';
import { BODY_SHRINK_MIN_BYTES } from './constants.js';
import { bodyChangeDetail, createTranslator } from './i18n/index.js';

/** 문서 제목 하나 + 절 `sections` 개 · 절마다 문단 하나와 요구사항 `reqsPer` 줄 — 한 절이 1.3KB 남짓이다 */
function specBody(
  sections: number,
  reqsPer = 0,
  prefix = 'REQ-WSPACE',
): { body: string; refs: string[] } {
  const lines: string[] = ['> 구현 상태: 구현됨', '', '# 문서', ''];
  const refs: string[] = [];
  for (let s = 1; s <= sections; s += 1) {
    lines.push(`## ${s}. 절 ${s}`, '');
    lines.push(`이 절은 ${s}번째 규칙을 적는다. `.repeat(30), '');
    for (let r = 0; r < reqsPer; r += 1) {
      const ref = `${prefix}-${String(refs.length + 1).padStart(3, '0')}`;
      refs.push(ref);
      lines.push(`- ${ref} WHEN 조건 ${ref} 이 맞으면 THE SYSTEM SHALL 그 일을 한다.`);
    }
    lines.push('');
  }
  return { body: lines.join('\n'), refs };
}

describe('bodyShape', () => {
  it('제목을 세되 코드 펜스 안의 `#` 줄은 세지 않는다 — 셸 주석은 제목이 아니다', () => {
    const shape = bodyShape(
      ['# 제목', '', '```bash', '# 주석', '```', '', '## 절', '#해시태그'].join('\n'),
    );
    expect(shape.headings).toBe(2);
  });

  it('크기는 UTF-8 바이트다 — 한글 한 글자는 3바이트', () => {
    expect(bodyShape('가나다').bytes).toBe(9);
  });
});

describe('bodyChange — 사고 둘을 잡는다', () => {
  it('꼬리 조각만 남은 저장(용어 사전 v4 — 34.7KB · 제목 27 → 484바이트 · 제목 1)', () => {
    const { body } = specBody(26);
    const fragment =
      '\n\n### 상태값 표의 건강도 행을 둘로 나눴다 (2026-10-05)\n\n' +
      '「발송·채널 건강도」 한 행을 두 행으로 나눴다. 사전에 없는 합성어였다.\n';
    const change = bodyChange(body, fragment);
    expect(change.shrunk).toEqual(['bytes', 'headings']);
    expect(change.after.headings).toBe(1);
  });

  it('앞부분만 남은 저장(계정 · 워크스페이스 v4 — 86KB · 제목 47 · 요구사항 59 → 앞 40줄)', () => {
    const { body } = specBody(46, 2);
    const cut = body.split('\n').slice(0, 40).join('\n').slice(0, -12); // 줄 가운데서 끊긴 호출
    const change = bodyChange(body, cut);
    expect(change.shrunk).toEqual(['bytes', 'headings', 'requirements']);
    expect(change.requirements_kept).toBeLessThan(change.before.requirements / 2);
  });
});

describe('bodyChange — 정상 저장은 걸지 않는다', () => {
  it('정리로 14% 줄인 저장(clemvion 에서 두 번째로 많이 줄인 정상 저장)', () => {
    const { body } = specBody(30);
    const trimmed = body.replace(/이 절은 (\d+)번째 규칙을 적는다\. /g, (m, n: string) =>
      Number(n) % 7 === 0 ? '' : m,
    );
    expect(bodyChange(body, trimmed).shrunk).toEqual([]);
  });

  it('절 번호를 다시 매긴 문서 — 제목이 모두 바뀌어도 수는 그대로라 줄지 않았다', () => {
    const { body } = specBody(12);
    const renumbered = body.replace(/^## (\d+)\. /gm, (_m, n: string) => `## ${Number(n) + 1}. `);
    expect(bodyChange(body, renumbered).shrunk).toEqual([]);
  });

  it('통째로 다시 썼지만 크기가 그대로인 저장 — 줄어든 것이 아니라 바뀐 것이다', () => {
    const { body } = specBody(10);
    expect(bodyChange(body, body.replaceAll('규칙', '약속')).shrunk).toEqual([]);
  });

  it(`덮어쓸 본문이 ${BODY_SHRINK_MIN_BYTES}바이트 미만이면 어느 축도 보지 않는다 — 자리표시 본문은 통째로 다시 쓴다`, () => {
    const small = '# 영역\n\n## 하위 문서\n\n- 하나\n- 둘\n';
    expect(bodyChange(small, '# 영역\n').shrunk).toEqual([]);
  });

  it('요구사항이 셋뿐인 문서에서 둘을 지운 것은 "대부분 사라졌다" 가 아니다 — 최소 개수 4', () => {
    const { body } = specBody(6);
    const withReqs = `${body}\n- REQ-A-001 WHEN a THE SYSTEM SHALL b\n- REQ-A-002 WHEN a THE SYSTEM SHALL b\n- REQ-A-003 WHEN a THE SYSTEM SHALL b\n`;
    const dropped = withReqs.replace(/- REQ-A-00[12].*\n/g, '');
    expect(bodyChange(withReqs, dropped).shrunk).toEqual([]);
  });
});

describe('bodyChangeDetail — 사전 검토 · 화면이 같은 한 줄을 쓴다', () => {
  it('준 축만 적고, 주지 않으면 요구사항이 있을 때만 요구사항을 적는다', () => {
    const t = createTranslator('ko');
    const { body } = specBody(26);
    const change = bodyChange(body, '\n\n### 한 절\n\n짧다.\n');
    expect(bodyChangeDetail(t, change, change.shrunk)).toMatch(
      /^크기 \d+\.\dKB → 0\.0KB · 제목 27 → 1개$/,
    );
    expect(bodyChangeDetail(t, change)).not.toContain('요구사항');
  });
});
