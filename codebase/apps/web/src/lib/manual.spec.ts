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
  helpForRoute,
  FIRST_CHAPTER,
  MANUAL_CHAPTERS,
} from './manual.js';
import {
  MANUAL_CHAPTER_IDS,
  MANUAL_SECTION_IDS,
  isManualChapter,
  helpHref,
  isManualSection,
} from './manual-chapters.js';
import type { ManualChapterId } from './manual-chapters.js';
import { SECTION_ID_PATTERN, renderDoc } from './markdown.js';

const LOCALES = ['ko', 'en'] as const;

/** 앞말(코드 · 영문 · 숫자 · 자리표시자 · 닫는 따옴표 · 글자로 끝나는 굵은 글씨)과 조사 사이의 빈칸 */
const PARTICLES =
  '은|는|이|가|을|를|의|에|에서|에게|와|과|로|으로|도|만|까지|부터|처럼|보다|이다|이고|이며|이면|인|입니다|이나|나|이라|라|이라는|라는|에는|에도|에서는|로는|으로는|이어야|여야';
const SPACED_PARTICLE = new RegExp(
  `(?:\`[^\`\\n]+\`|(?<![A-Za-z0-9])[A-Za-z0-9][A-Za-z0-9._+#/-]*|[}"”」]|[가-힣A-Za-z0-9]\\*\\*) (?:${PARTICLES})(?=$|[\\s.,)!?:·'"(」])`,
  'g',
);

describe('매뉴얼 목차', () => {
  /**
   * **id 의 정본은 `manual-chapters.ts` 다**(2026-09-10 · REQ-WEB-161). 본문 없이 목록만
   * 필요한 자리가 생겨(증적이 가리키는 장) 갈랐다 — `manual.ts` 를 import 하는 것은 매뉴얼
   * 전문을 그 청크로 끌고 오는 일이다. 두 목록이 갈리면 매뉴얼이 그 장을 못 찾거나 증적
   * 링크가 죽은 곳을 가리킨다. 타입은 한 방향만 막으므로 나머지는 여기서 본다.
   */
  it('id 목록과 목차가 같은 것을 같은 순서로 말한다', () => {
    expect(MANUAL_CHAPTERS.map((chapter) => chapter.id)).toEqual([...MANUAL_CHAPTER_IDS]);
    for (const id of MANUAL_CHAPTER_IDS) expect(isManualChapter(id)).toBe(true);
    expect(isManualChapter('onboarding')).toBe(false);
  });

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
    // 절까지 가리킬 수 있다(`/help/settings#gates` · 같은 장 안의 `#gates` — 2026-09-28 · REQ-WEB-268).
    // 절 이름이 그 장에 없으면 죽은 링크다 — 장만 맞고 절이 틀린 링크는 사람을 엉뚱한 자리에 둔다
    const dead: string[] = [];
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        for (const [, href] of chapter.body[locale].matchAll(/\]\(((?:\/|#)[^)]*)\)/g)) {
          const [path = '', section] = (href ?? '').split('#');
          const chapterId = path === '' ? chapter.id : path.replace('/help/', '');
          const alive =
            (path === '' || path.startsWith('/help/')) &&
            findChapter(chapterId) !== undefined &&
            (section === undefined ||
              (isManualChapter(chapterId) && isManualSection(chapterId, section)));
          if (!alive) dead.push(`${chapter.id}/${locale} → ${href ?? ''}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  /**
   * **절 이름은 로케일 공통이다**(2026-09-28 · 사람 결정 · REQ-WEB-268). 한국어로 복사한 링크가 영어
   * 화면에서도 같은 절로 가야 한다. 두 벌이 어긋나면 한쪽 언어의 링크만 죽는다 — 여기서 대조한다.
   */
  describe('절 이름', () => {
    const idsOf = (body: string): string[] =>
      [...body.matchAll(/^#{2,3} .*\{#([^}]*)\}\s*$/gm)].map(([, id]) => id ?? '');

    it('ko · en 이 같은 이름을 같은 순서로 갖고, 코드의 목록과 같다', () => {
      for (const chapter of MANUAL_CHAPTERS) {
        const expected = [...MANUAL_SECTION_IDS[chapter.id as ManualChapterId]];
        for (const locale of LOCALES) {
          expect(idsOf(chapter.body[locale]), `${chapter.id}/${locale}`).toEqual(expected);
        }
      }
    });

    it('`##` 는 모두 이름을 갖는다 — 이름 없는 절은 절을 넣을 때 밀린다', () => {
      const missing: string[] = [];
      for (const chapter of MANUAL_CHAPTERS) {
        for (const locale of LOCALES) {
          for (const [line] of chapter.body[locale].matchAll(/^## .*$/gm)) {
            if (!/\{#[^}]*\}\s*$/.test(line)) missing.push(`${chapter.id}/${locale}: ${line}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it('이름은 모양이 맞고 장 안에서 하나뿐이며, 순서 번호 · 셸의 id 와 겹치지 않는다', () => {
      // 셸이 쓰는 정적 id — 같은 이름이면 `#main` 이 본문이 아니라 셸의 <main> 으로 간다
      const reserved = ['root', 'main'];
      for (const [chapter, ids] of Object.entries(MANUAL_SECTION_IDS)) {
        const list = [...ids] as string[];
        expect(new Set(list).size, chapter).toBe(list.length);
        for (const id of list) {
          expect(SECTION_ID_PATTERN.test(id), `${chapter}#${id}`).toBe(true);
          expect(/^sec-\d+$/.test(id), `${chapter}#${id}`).toBe(false);
          expect(reserved, `${chapter}#${id}`).not.toContain(id);
        }
      }
    });

    it('렌더한 글자에 `{#` 가 남지 않는다 — 모양이 틀린 이름은 글자로 새어 나온다', () => {
      const leaked: string[] = [];
      for (const chapter of MANUAL_CHAPTERS) {
        for (const locale of LOCALES) {
          const text = renderDoc(chapter.body[locale]).html.replace(/<[^>]*>/g, '');
          if (text.includes('{#')) leaked.push(`${chapter.id}/${locale}`);
        }
      }
      expect(leaked).toEqual([]);
    });
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

  /**
   * **조사는 앞말에 붙인다. 코드 · 영문 뒤에서도 같다**(2026-09-27 · 사람 결정 · 용어 사전 §3.5).
   * 규칙이 없던 동안 한 장 안에서도 "`nerv` 이고"와 "`nerv`이고"가 섞였다. 굵은 글씨가 부호나
   * 기호로 끝나는 자리("**[검토 요청]** 을")만 띄운다. 붙이면 위 검사가 잡는 별표가 남는다.
   */
  it('코드 · 영문 뒤의 조사를 띄우지 않는다 (용어 사전 §3.5)', () => {
    const spaced: string[] = [];
    for (const chapter of MANUAL_CHAPTERS) {
      let fence = false;
      for (const line of chapter.body.ko.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) fence = !fence;
        if (fence) continue;
        for (const match of line.matchAll(SPACED_PARTICLE))
          spaced.push(`${chapter.id}: ${match[0]}`);
      }
    }
    expect(spaced).toEqual([]);
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
    // 토큰 탭은 설치 장 — 발급부터 연결까지의 절차가 거기 있다(SET-10)
    ['/settings/tokens', 'install'],
    ['/settings/members', 'settings'],
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

  /**
   * **절까지 간다**(2026-09-28 · 사람 결정 · REQ-WEB-268). 장 첫머리로만 가던 동안 게이트 정책 화면의
   * 도움말은 설정 장의 첫 절(조직 정보)을 열었고, 게이트 정책 절은 그 장의 마지막이었다.
   */
  it.each([
    ['/settings/gates', 'settings', 'gates'],
    ['/settings/members', 'settings', 'members'],
    ['/settings/account', 'settings', 'account'],
    ['/settings/projects', 'settings', 'projects'],
    ['/settings/org-tokens', 'settings', 'tokens'],
    ['/settings/org', 'settings', 'org'],
    ['/notifications', 'inbox', 'notifications'],
    ['/p/clemvion', 'specs', 'requirements'],
  ])('%s → %s#%s', (path, chapter, section) => {
    const target = helpForRoute(path);
    expect(target).toEqual({ chapter, section });
    expect(isManualSection(target!.chapter, section)).toBe(true);
    expect(helpHref(target!)).toBe(`/help/${chapter}#${section}`);
  });

  it('절이 없는 화면은 장 첫머리로 간다 — 토큰 탭은 설치 장의 처음부터 읽는다', () => {
    expect(helpForRoute('/settings/tokens')).toEqual({ chapter: 'install' });
    expect(helpHref(helpForRoute('/p/clemvion/tasks')!)).toBe('/help/tasks');
  });
});
