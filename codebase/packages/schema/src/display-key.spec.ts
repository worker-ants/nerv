// 표시 키 — 데이터 모델 §5.1 (`<project.key>-<타입>-<base32 6자>`)
//
// 이 파일이 있는 이유는 폭이다. 이전 표기(`TSK-` + 16진 4자)는 키 공간이 65,536뿐이라
// clemvion plan 481건에서 충돌 기댓값이 1.76 이었고 **실제로 문서를 하나 먹었다**(실측
// 2026-08-23). 형식은 눈에 보이지만 폭은 안 보인다 — 그래서 여기서 지킨다.

import { describe, expect, it } from 'vitest';
import { displayKey, displayKeySuffix } from './ids.js';

describe('displayKey — §5.1 형식', () => {
  it('정본 예시와 같은 모양이다', () => {
    expect(displayKey('CLV', 'T', 'x')).toMatch(/^CLV-T-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('혼동 문자를 쓰지 않는다 — 사람이 옮겨 적는 것이 용도다', () => {
    // `I`·`L`·`O`·`U` 가 나오면 0/O·1/I/L 을 가르는 부담이 사람에게 간다.
    let seen = '';
    for (let i = 0; i < 4000; i += 1) seen += displayKeySuffix(`seed-${i}`);
    expect(seen).not.toMatch(/[ILOU]/);
    // 32글자를 실제로 다 쓰는지도 본다 — 알파벳이 좁으면 폭 계산이 거짓이 된다
    expect(new Set(seen).size).toBe(32);
  });

  it('같은 씨앗은 같은 키다 — 임포트 멱등의 축이다', () => {
    expect(displayKeySuffix('plan/complete/a.md')).toBe(displayKeySuffix('plan/complete/a.md'));
    expect(displayKeySuffix('plan/complete/a.md')).not.toBe(displayKeySuffix('plan/complete/b.md'));
  });

  it('프로젝트가 다르면 키가 다르다 — 접두가 프로젝트 것이기 때문', () => {
    expect(displayKey('CLV', 'T', 'same')).not.toBe(displayKey('NRV', 'T', 'same'));
  });

  it('1만 건에서 충돌이 없다 — 옛 표기는 481건에서 하나를 먹었다', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) keys.add(displayKeySuffix(`plan/complete/t${i}.md`));
    expect(keys.size).toBe(10_000);
  });

  it('실측 충돌 쌍이 갈린다', () => {
    // 16진 4자일 때 두 파일이 함께 `TSK-25b4` 를 받아 상태가 다른 티켓 하나가 사라졌다.
    expect(displayKeySuffix('plan/complete/swagger-double-wrap-fix.md')).not.toBe(
      displayKeySuffix('plan/in-progress/spec-draft-eia-notification-payload-contract.md'),
    );
  });
});
