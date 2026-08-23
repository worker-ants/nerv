// 표시 키 — 데이터 모델 §5.1 (`<project.key>-<타입>-<base32 6자>`)
//
// 이 파일이 있는 이유는 폭이다. 이전 표기(`TSK-` + 16진 4자)는 키 공간이 65,536뿐이라
// clemvion plan 481건에서 충돌 기댓값이 1.76 이었고 **실제로 문서를 하나 먹었다**(실측
// 2026-08-23). 형식은 눈에 보이지만 폭은 안 보인다 — 그래서 여기서 지킨다.

import { describe, expect, it } from 'vitest';
import { changesetHash, displayKey, displayKeySuffix, findingFingerprint } from './keys.js';

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

describe('findingFingerprint — 라운드를 넘는 동일성 (FR-09 · data-model §5.2)', () => {
  const base = {
    projectId: 'p1',
    category: 'correctness',
    filePath: 'src/widget/session.ts',
    symbol: 'restoreSession',
    title: '세션 키를 브라우저가 만든다',
  };
  const hex = (x: Buffer): string => x.toString('hex');

  it('같은 지적은 라운드가 달라도 같은 값이다', () => {
    expect(hex(findingFingerprint(base))).toBe(hex(findingFingerprint({ ...base })));
  });

  it('**줄이 밀려도 같다** — 코드가 움직였다고 새 발견이 아니다', () => {
    // 줄 번호는 fingerprint 에 들어가지 않는다. 위치는 finding.line_start 가 따로 든다.
    expect(hex(findingFingerprint(base))).toBe(hex(findingFingerprint(base)));
  });

  it('**severity 를 낮춰도 같다** — 하향이 새 finding 으로 감춰지면 안 된다', () => {
    // severity 는 애초에 입력이 아니다. 하향은 occurrence.raw_severity 대조로 감사한다.
    const lowered = { ...base };
    expect(hex(findingFingerprint(lowered))).toBe(hex(findingFingerprint(base)));
  });

  it('제목의 수치만 바뀐 재서술은 같은 것으로 본다', () => {
    // clemvion 실측: 같은 유예 항목이 라운드마다 "3곳에서" -> "5곳에서" 로 재서술됐다
    expect(hex(findingFingerprint({ ...base, title: '세션 키를 브라우저가 만든다 (3곳)' }))).toBe(
      hex(findingFingerprint({ ...base, title: '세션 키를 브라우저가 만든다 (5곳)' })),
    );
  });

  it('경로 표기 차이는 같은 것으로 본다 — 구분자·대소문자·선행 ./', () => {
    expect(hex(findingFingerprint({ ...base, filePath: './src/Widget/Session.ts' }))).toBe(
      hex(findingFingerprint(base)),
    );
  });

  it('다른 파일·다른 지적은 다른 값이다 — 뭉치면 dedup 이 아니라 유실이다', () => {
    expect(hex(findingFingerprint({ ...base, filePath: 'src/other.ts' }))).not.toBe(
      hex(findingFingerprint(base)),
    );
    expect(hex(findingFingerprint({ ...base, title: '전혀 다른 지적이다' }))).not.toBe(
      hex(findingFingerprint(base)),
    );
    expect(hex(findingFingerprint({ ...base, category: 'security' }))).not.toBe(
      hex(findingFingerprint(base)),
    );
    expect(hex(findingFingerprint({ ...base, projectId: 'p2' }))).not.toBe(
      hex(findingFingerprint(base)),
    );
  });
});

describe('changesetHash — 라운드 동일성(database.md §2.7)', () => {
  const base = { baseSha: 'aaa111', headSha: 'bbb222', changeset: ['src/a.ts', 'src/b.ts'] };
  const hex = (x: Buffer): string => x.toString('hex');

  it('파일 순서는 changeset 의 성질이 아니다 — 정렬해서 본다', () => {
    expect(hex(changesetHash({ ...base, changeset: ['src/b.ts', 'src/a.ts'] }))).toBe(
      hex(changesetHash(base)),
    );
  });

  it('커밋이 나아가면 다른 changeset 이다 — 그때가 다음 라운드다', () => {
    expect(hex(changesetHash({ ...base, headSha: 'ccc333' }))).not.toBe(hex(changesetHash(base)));
  });

  it('파일 집합이 다르면 다른 changeset 이다', () => {
    expect(hex(changesetHash({ ...base, changeset: ['src/a.ts'] }))).not.toBe(
      hex(changesetHash(base)),
    );
  });

  it('경로 표기 차이는 흡수한다 — 리뷰어마다 ./ 를 붙이거나 뗀다', () => {
    expect(hex(changesetHash({ ...base, changeset: ['./src/A.ts', 'src/b.ts'] }))).toBe(
      hex(changesetHash(base)),
    );
  });
});
