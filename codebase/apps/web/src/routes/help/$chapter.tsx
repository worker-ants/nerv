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
          // 앵커로 뛰면 제목이 고정 헤더 밑으로 숨는다 — 뛰는 자리에 헤더만큼 여백을 준다
          className="prose-nerv max-w-[46rem] [&_h2]:scroll-mt-[calc(var(--spacing-header)+1.5rem)]"
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

      {doc.headings.length > 1 && (
        <aside className="sticky top-header hidden h-fit w-[196px] shrink-0 py-11 pr-6 xl:block">
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
