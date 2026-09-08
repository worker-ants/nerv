// /help/:chapter — 매뉴얼 한 장 (screens.md §2.10)
//
// 본문은 md 한 벌을 그대로 렌더한다(`prose-nerv` — REQ-WEB-047). 오른쪽 "이 문서 안"은
// `##` 만 담는다: `###` 까지 담으면 목차가 본문만큼 길어져 훑는 도구가 아니게 된다.

import { useLocale, useT } from '../../lib/i18n.js';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { chapterNeighbours, findChapter } from '../../lib/manual.js';
import { renderDoc } from '../../lib/markdown.js';
import { EmptyState, PageBody } from '../../components/ui/primitives.js';

export const Route = createFileRoute('/help/$chapter')({ component: ManualChapterScreen });

function ManualChapterScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { chapter: chapterId } = Route.useParams();
  const chapter = findChapter(chapterId);
  const source = chapter?.body[locale] ?? '';
  // 장이나 언어가 바뀔 때만 다시 판다 — 스크롤 한 번에 문서를 다시 파싱할 이유가 없다
  const doc = useMemo(() => renderDoc(source), [source]);
  const { previous, next } = chapterNeighbours(chapterId);

  if (chapter === undefined) {
    return (
      <PageBody>
        <EmptyState icon="?" title={t('help.not_found')} />
      </PageBody>
    );
  }

  /**
   * 매뉴얼 안의 링크는 **앱 안에서 옮겨 간다.** md 가 낸 것은 평범한 `<a href="/help/…">`
   * 라, 그대로 두면 장을 넘길 때마다 페이지가 통째로 새로 뜬다. 라우터의 history 로
   * 밀어 넣으면 앱 셸과 캐시가 그대로 살아 있다. 앵커(`#…`)와 외부 링크는 건드리지 않는다.
   */
  const onBodyClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (!href.startsWith('/')) return;
    event.preventDefault();
    router.history.push(href);
  };

  return (
    <div className="flex">
      <PageBody>
        <h1 className="mb-5 text-2xl font-bold tracking-[-0.02em]">{t(chapter.titleKey)}</h1>
        <div
          data-testid="manual-body"
          onClick={onBodyClick}
          // 앵커로 뛰면 제목이 위에 붙은 것 밑으로 숨는다 — 뛰는 자리에 그만큼 여백을 준다.
          // 그 "위에 붙은 것" 이 폭에 따라 다르다(2026-09-08 · REQ-WEB-157): 본문이 자기
          // 상자 안에서 흐르는 폭(`md`)에서는 상자 위가 곧 헤더 아래라 페이지 여백만큼이면
          // 되고, 페이지가 흐르는 좁은 화면에서는 셸 헤더가 그 자리를 덮는다.
          className="prose-nerv max-w-[46rem] [&_h2]:scroll-mt-[calc(var(--spacing-header)+1.5rem)]
            md:[&_h2]:scroll-mt-6"
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />

        {/* 이전·다음 — 다 읽은 사람이 다음 장을 찾아 차례로 되돌아가지 않게 한다 */}
        <nav className="mt-10 flex gap-3 border-t border-border pt-4 text-sm">
          {previous !== undefined && (
            <Link
              to="/help/$chapter"
              params={{ chapter: previous.id }}
              className="text-text-mute hover:text-link"
            >
              ← {t(previous.titleKey)}
            </Link>
          )}
          {next !== undefined && (
            <Link
              to="/help/$chapter"
              params={{ chapter: next.id }}
              className="ml-auto text-text-mute hover:text-link"
            >
              {t(next.titleKey)} →
            </Link>
          )}
        </nav>
      </PageBody>

      {/* "이 문서 안" 은 본문 칸 **안에** 있다 — 붙는 자리도 그 상자의 꼭대기다
          (2026-09-08 · REQ-WEB-157). 이 목차가 보이는 폭(`xl`)은 본문이 자기 안에서
          흐르는 폭(`md`)보다 넓으므로, 여기서 셸 헤더를 기준으로 붙일 일은 없다. */}
      {doc.headings.length > 1 && (
        <aside className="sticky top-0 hidden h-fit w-[196px] shrink-0 py-11 pr-6 xl:block">
          <p className="mb-2 text-2xs font-semibold tracking-[0.07em] text-text-faint uppercase">
            {t('help.on_this_page')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {doc.headings.map((heading) => (
              <li key={heading.id}>
                <a href={`#${heading.id}`} className="text-sm text-text-mute hover:text-link">
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
