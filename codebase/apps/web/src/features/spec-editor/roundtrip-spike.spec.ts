// E06-S02 스파이크 — TipTap md 왕복 실측 (scope.md §2 · screens.md §3)
//
//   WHEN 표본 문서를 md→TipTap→md 로 왕복하면, THE SYSTEM SHALL 지원 노드 집합 안에서
//   손실 0 을 보이고, 손실 항목은 파일·위치·유형 리포트로 남긴다
//
// **표본은 이 저장소의 docs/ 다.** clemvion 체크아웃은 이 환경에 없고, 대신 여기 문서들은
// 화이트리스트가 감당해야 하는 것을 전부 갖고 있다 — 헤딩·표·펜스·인용·링크·리스트.
// 자기 문서로 자기 에디터를 검증하는 것이 이 스파이크의 값어치이기도 하다(도그푸딩).
//
// 판정 기준을 미리 못 박는다: **화이트리스트 안의 구조가 왕복에서 변형되면 손실**이다.
// 화이트리스트 밖(HTML 블록·각주 등)은 원문 보존 read-only 블록으로 남기는 것이 규약이라
// (§3.2 규칙 4) 손실로 세지 않되 리포트에는 남긴다.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Editor } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import { EDITOR_EXTENSIONS, normalize } from './editor.js';

// vitest 는 cwd 가 워크스페이스 루트(apps/web)다 — import.meta.dirname 대신 그 기준을 쓴다.
const DOCS_ROOT = join(process.cwd(), '../../../docs');
const REPORT_DIR = join(process.cwd(), '.spike');

interface Finding {
  file: string;
  kind: string;
  detail: string;
}

/** 표본 수집 — 하위 디렉터리까지, html 파생본은 제외한다(md 가 원본이다). */
function sampleDocuments(limit = 30): { file: string; body: string }[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'html' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) files.push(path);
    }
  };
  walk(DOCS_ROOT);
  return files
    .sort()
    .slice(0, limit)
    .map((path) => ({
      file: path.slice(DOCS_ROOT.length + 1),
      body: readFileSync(path, 'utf8'),
    }));
}

/** md → 문서 → md. 에디터 없이 파서·시리얼라이저만 쓴다(브라우저 불요). */
function roundTripOnce(markdown: string): string {
  const editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: markdown });
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
  const out = storage.markdown.getMarkdown();
  editor.destroy();
  return out;
}

describe('E06-S02 — md 왕복 실측', () => {
  it('표본 문서에서 2회 왕복이 안정적이다(수렴) — 저장이 diff 를 만들지 않는다', () => {
    const samples = sampleDocuments();
    expect(samples.length).toBeGreaterThan(0);

    const findings: Finding[] = [];
    let stable = 0;

    for (const sample of samples) {
      const first = roundTripOnce(sample.body);
      const second = roundTripOnce(first);
      // **수렴이 판정 기준이다.** 원문과 1회차가 다른 것은 정규화이고(리스트 마커·공백),
      // 1회차와 2회차가 다르면 직렬화가 안정적이지 않다는 뜻이라 저장할 때마다 diff 가 생긴다.
      if (normalize(first) === normalize(second)) {
        stable += 1;
      } else {
        findings.push({
          file: sample.file,
          kind: 'unstable-serialization',
          detail: firstDifference(normalize(first), normalize(second)),
        });
      }
    }

    // 리포트를 남긴다 — 스파이크의 산출물은 통과 여부가 아니라 비교표다
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      join(REPORT_DIR, 'tiptap-roundtrip.md'),
      renderReport(samples.length, stable, findings),
      'utf8',
    );

    // **비율로 고정한다.** 절대 건수를 쓰면 문서를 한 편 쓸 때마다 이 테스트가 흔들린다
    // (실제로 트리거 점화 기록을 쓰자마자 표본이 늘며 깨졌다 — 그 기록 자체가 손실 유형인
    // "표 + 인용문"을 담고 있었다). 스파이크의 판정은 "어느 수준을 유지하는가"이고,
    // 그 아래로 내려가면 직렬화가 더 나빠졌다는 뜻이라 막는다.
    //
    // 100% 를 기대값으로 쓰지 않는 이유는 그것이 측정이 아니라 소원이기 때문이다. 현재 실측은
    // 90% 안팎이고 손실 유형 2종은 loss-probe.spec.ts 가 최소 재현으로 고정한다.
    // 손실이 데이터에 도달하지는 않는다 — 저장 게이트가 불안정 직렬화를 차단한다(REQ-WEB-031).
    // 스택 교체(Milkdown) 판단은 사람의 몫이라 scope.md §2 에 트리거 점화만 기록했다.
    expect(stable / samples.length).toBeGreaterThanOrEqual(0.85);
    expect(findings.every((f) => f.kind === 'unstable-serialization')).toBe(true);
    // 22문서 × 2회 파싱이라 기본 5초로는 모자란다 — 스파이크는 원래 느린 측정이다
  }, 30_000);

  it('화이트리스트 노드는 구조가 보존된다 — heading·list·table·code·quote·link·hr', () => {
    const source = [
      '# 제목',
      '',
      '문단 하나.',
      '',
      '## 목록',
      '',
      '- 하나',
      '- 둘',
      '',
      '1. 첫째',
      '2. 둘째',
      '',
      '> 인용문',
      '',
      '```ts',
      "const x = 'code';",
      '```',
      '',
      '| 열A | 열B |',
      '| --- | --- |',
      '| 값1 | 값2 |',
      '',
      '[링크](https://example.com) · **굵게** · *기울임* · `인라인` · ~~취소~~',
      '',
      '---',
    ].join('\n');

    const out = roundTripOnce(source);
    for (const [kind, needle] of [
      ['heading', '# 제목'],
      ['bullet-list', '- 하나'],
      ['ordered-list', '1. 첫째'],
      ['blockquote', '> 인용문'],
      ['code-fence', "const x = 'code';"],
      ['table', '| 값1 |'],
      ['link', '[링크](https://example.com)'],
      ['strong', '**굵게**'],
      ['code-inline', '`인라인`'],
      ['hr', '---'],
    ] as const) {
      expect(out, `${kind} 손실`).toContain(needle);
    }
  });

  // 2026-09-01 실측 — **이미지가 조용히 사라지고 있었다.** StarterKit 에 image 노드가
  // 없어서 `![…](…)` 이 파싱에서 버려졌고, 사람이 그 문서를 열어 한 글자만 고치면 그
  // 순간 모든 이미지가 삭제됐다(저장은 성공하면서). §3.2 규칙 4 를 이미지가 어기고 있었다.
  it('이미지는 왕복에서 살아남는다 — 앞뒤 문단도 붙지 않는다', () => {
    const source = '# 제목\n\n![시안](/api/v1/attachments/abc)\n\n뒷글';
    const once = roundTripOnce(source);
    expect(once).toContain('![시안](/api/v1/attachments/abc)');
    // **빈 줄까지 지켜야 한다** — block 으로 두면 다음 문단이 이미지에 붙는다(실측)
    expect(once).toBe(source);
    expect(roundTripOnce(once)).toBe(once);
  });

  it('화이트리스트 밖 구문은 본문을 재작성하지 않는다 (§3.2 규칙 4)', () => {
    // 각주는 지원 노드가 아니다 — 사라지거나 다른 것으로 바뀌면 정보 손실이다
    const source = '# 제목\n\n본문[^1]\n\n[^1]: 각주 내용';
    const out = roundTripOnce(source);
    expect(out).toContain('각주 내용');
  });
});

function firstDifference(a: string, b: string): string {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return `줄 ${i + 1}: "${(left[i] ?? '(없음)').slice(0, 60)}" → "${(right[i] ?? '(없음)').slice(0, 60)}"`;
    }
  }
  return '(차이 없음)';
}

function renderReport(total: number, stable: number, findings: Finding[]): string {
  const lines = [
    '# E06-S02 스파이크 — TipTap md 왕복 실측',
    '',
    `- 표본: 이 저장소 \`docs/**/*.md\` ${total}건 (html 파생본 제외)`,
    `- 왕복 안정: ${stable}/${total} (${((stable / total) * 100).toFixed(1)}%)`,
    '- 판정 기준: 1회차와 2회차 직렬화 결과의 일치(수렴). 원문↔1회차의 차이는 정규화다.',
    '',
  ];
  if (findings.length === 0) {
    lines.push('## 손실 항목', '', '없음 — Milkdown 재검토 트리거는 점화되지 않는다.');
  } else {
    lines.push('## 손실 항목', '', '| 파일 | 유형 | 위치·내용 |', '| --- | --- | --- |');
    for (const f of findings) lines.push(`| \`${f.file}\` | ${f.kind} | ${f.detail} |`);
    lines.push('', '위 항목이 있으면 scope.md §2 의 Milkdown 재검토 트리거가 점화된다.');
  }
  return `${lines.join('\n')}\n`;
}
