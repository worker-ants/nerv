// 불러오는 중 · 실패 · 없음을 **비어 있음과 가른다** (screens.md §1.5 · REQ-WEB-198)
//
// 2026-09-24 까지 화면 대부분이 `!isLoading && 0건` 이면 빈 상태를 그렸다 — 그 조건은
// 실패를 거르지 않는다. 받은 요청을 불러오지 못해도 홈은 "밀린 결정이 없어요" 라고 말했고,
// 받은 요청·알림·작업 보드는 실패를 빈 목록으로 그렸다. 없는 문서·작업·프로젝트를 연 사람은
// 키만 적힌 빈 머리를 봤다. "없다" 와 "모른다" 는 사람에게 정반대의 행동을 시킨다 —
// 앞의 것은 넘어가라는 말이고 뒤의 것은 다시 보라는 말이다.
//
// §1.5 의 약속은 셋이다: 로딩은 골격 · 에러는 인라인 카드 + [다시 시도] · 빈 것은 다음 행동.
// 이 파일은 둘째와 "없다" 를 한 모양으로 그린다. 골격과 빈 상태는 primitives 에 있다.

import { NERV_ERROR } from '@nerv/schema';
import { NervApiError } from '../lib/api.js';
import { describeApiError } from '../lib/api-errors.js';
import { useT } from '../lib/i18n.js';
import { Button, EmptyState } from './ui/primitives.js';

/** 대상이 없다 — 서버는 409 `NERV_PRECONDITION` + `kind: not_found` 로 말한다(api.md §1.4) */
export function isNotFound(error: unknown): boolean {
  return (
    error instanceof NervApiError &&
    (error.status === 404 ||
      (error.code === NERV_ERROR.PRECONDITION && error.body.details['kind'] === 'not_found'))
  );
}

/** 멤버가 아니다 — 있기는 하지만 내 것이 아니다 */
export function isNotMember(error: unknown): boolean {
  return (
    error instanceof NervApiError &&
    error.code === NERV_ERROR.FORBIDDEN &&
    error.body.details['kind'] === 'no_membership'
  );
}

/**
 * 불러오지 못했다 — 인라인 카드와 [다시 시도](§1.5).
 *
 * 문장은 표를 거친다(`describeApiError`) — 부류 · 이 건 · 재시도 시각. 토스트로 한 번 더
 * 말하지 않는다: 읽기는 이 카드가 말하고, 쓰기의 실패만 토스트가 말한다(REQ-WEB-196).
 */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  return (
    <div role="alert" data-testid="error-state" className={className}>
      <EmptyState
        icon="⚠"
        title={title ?? t('state.load_failed')}
        hint={describeApiError(t, error).message}
        action={
          <Button size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        }
      />
    </div>
  );
}

/** 찾을 수 없다 — 무엇이 없는지와 갈 곳(§1.5 막다른 길 금지) */
export function NotFoundState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: React.ReactNode;
  action: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div data-testid="not-found" className={className}>
      <EmptyState icon="?" title={title} hint={hint} action={action} />
    </div>
  );
}

/**
 * 한 번도 받아 오지 못한 채 실패했는가. 받아 둔 값이 있으면 그것을 보인다 —
 * 재조회 한 번의 실패로 멀쩡한 목록을 지우면 그것도 거짓이다.
 */
export function failedWithoutData(query: { isError: boolean; data: unknown }): boolean {
  return query.isError && query.data === undefined;
}
