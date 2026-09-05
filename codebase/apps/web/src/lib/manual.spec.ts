// 매뉴얼 목차 — **썩는 것을 여기서 잡는다.**
//
// 매뉴얼의 실패는 조용하다: 링크 하나가 죽어도, 한 언어의 장 하나가 비어도 화면은 멀쩡히
// 뜨고 그 장을 연 사람만 빈 화면을 본다. 그래서 규약을 테스트로 못박는다 —
// 두 로케일이 같은 장을 갖는가, 장 안의 링크가 실재하는 장을 가리키는가.

import { describe, expect, it } from 'vitest';
import { ko } from '@nerv/schema';
import {
  chapterForRoute,
  chapterNeighbours,
  findChapter,
  FIRST_CHAPTER,
  MANUAL_CHAPTERS,
} from './manual.js';
import { renderDoc } from './markdown.js';

const LOCALES = ['ko', 'en'] as const;

describe('매뉴얼 목차', () => {
  it('장 id 는 유일하고 첫 장은 실재한다', () => {
    const ids = MANUAL_CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findChapter(FIRST_CHAPTER)).toBeDefined();
  });

  it('모든 장에 두 로케일의 본문이 있다 — 한 언어만 채운 장은 그 언어 사용자에게 빈 화면이다', () => {
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        expect(chapter.body[locale].trim().length, `${chapter.id}/${locale}`).toBeGreaterThan(200);
      }
    }
  });

  it('장 제목은 카탈로그에 있다', () => {
    for (const chapter of MANUAL_CHAPTERS) {
      expect(ko[chapter.titleKey], chapter.id).toBeDefined();
    }
  });

  it('본문은 `#` 로 시작하지 않는다 — 제목은 카탈로그의 것이고 화면이 h1 로 그린다', () => {
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        expect(chapter.body[locale].startsWith('# '), `${chapter.id}/${locale}`).toBe(false);
      }
    }
  });

  it('본문 안의 앱 링크는 실재하는 곳을 가리킨다 — 죽은 링크는 매뉴얼을 못 믿게 만든다', () => {
    const dead: string[] = [];
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        for (const [, href] of chapter.body[locale].matchAll(/\]\((\/[^)]*)\)/g)) {
          const chapterId = href?.replace('/help/', '') ?? '';
          if (href?.startsWith('/help/') !== true || findChapter(chapterId) === undefined) {
            dead.push(`${chapter.id}/${locale} → ${href ?? ''}`);
          }
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('본문에 렌더되지 않은 마크업이 남지 않는다 — 화면에 `**` 가 그대로 찍힌다', () => {
    // 실제로 한 번 새어 나갔다: `**"모른다"**입니다` 처럼 굵게가 **따옴표로 시작하고
    // 곧바로 글자로 이어지면** CommonMark 의 좌·우 인접 규칙에서 닫는 표시로 인정되지
    // 않아 별표가 글자로 남는다. 눈으로만 보던 것을 여기서 기계가 본다.
    const leaked: string[] = [];
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        const text = renderDoc(chapter.body[locale]).html.replace(/<[^>]*>/g, '');
        if (text.includes('**') || text.includes('](')) leaked.push(`${chapter.id}/${locale}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('이전·다음은 순환하지 않는다 — 끝에서 처음으로 돌아가면 끝이라는 것을 모른다', () => {
    const first = MANUAL_CHAPTERS[0];
    const last = MANUAL_CHAPTERS[MANUAL_CHAPTERS.length - 1];
    expect(chapterNeighbours(first?.id ?? '').previous).toBeUndefined();
    expect(chapterNeighbours(last?.id ?? '').next).toBeUndefined();
    expect(chapterNeighbours(first?.id ?? '').next?.id).toBe(MANUAL_CHAPTERS[1]?.id);
  });
});

describe('화면 → 장', () => {
  it.each([
    ['/p/clemvion/specs', 'specs'],
    ['/p/clemvion/specs/SPC-CWC-007', 'specs'],
    ['/p/clemvion/tasks', 'tasks'],
    ['/p/clemvion/sessions/S-b7e9', 'sessions'],
    ['/p/clemvion/reviews', 'reviews'],
    ['/inbox', 'inbox'],
    ['/notifications', 'inbox'],
    ['/settings/tokens', 'settings'],
    // 프로젝트 개요 — 그 화면의 구현 현황 다섯 숫자를 설명하는 자리가 스펙 장이다
    ['/p/clemvion', 'specs'],
  ])('%s → %s 장', (path, chapter) => {
    expect(chapterForRoute(path)).toBe(chapter);
    expect(findChapter(chapter)).toBeDefined();
  });

  it('짚어 줄 장이 없으면 null 이다 — 아무 데나 보내느니 그 항목을 안 보이는 편이 낫다', () => {
    // 홈은 첫 장이 곧 답이라 "제품 매뉴얼" 항목이 이미 같은 곳으로 간다
    expect(chapterForRoute('/')).toBeNull();
    expect(chapterForRoute('/login')).toBeNull();
  });

  it('하위 화면이 개요보다 먼저 맞는다 — 순서가 뒤집히면 전부 스펙 장으로 간다', () => {
    expect(chapterForRoute('/p/clemvion/tasks')).toBe('tasks');
    expect(chapterForRoute('/p/clemvion/sessions')).toBe('sessions');
  });
});
