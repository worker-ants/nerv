// 키 → 경로 — **한 곳에서 정한다** (screens.md §1.2 · REQ-WEB-209)
//
// 작업·세션·리뷰가 서로를 **글자로만** 가리켰다(2026-09-24 UI/UX 검토 — NAV-07 · WORK-03). 세션 카드의
// 작업 키, 작업 상세의 세션 id, 리뷰 줄의 브랜치, 발견의 출처 작업이 전부 Mono 글자라 사람은 키를 옮겨
// 적어 ⌘K 에 붙였다 — ⌘K 는 세션을 찾지도 못한다. 시안의 첫 규칙("숫자를 누르면 그 숫자를 만든
// 레코드로 간다")이 이 영역에서는 거의 닫혀 있지 않았다.
//
// 경로를 자리마다 다시 적으면 그때마다 조금씩 다르게 틀린다 — 그래서 여기 하나에 둔다. 카드처럼
// 눌러서 고르는 상자 안에 설 때는 `stop` 으로 고르기와 겹치지 않게 한다.

import { Link } from '@tanstack/react-router';
import { cn } from '../lib/utils.js';

export type EntityRef =
  | { kind: 'task'; key: string }
  | { kind: 'session'; id: string }
  | { kind: 'spec'; key: string; rail?: 'requirements' }
  /** 리뷰 센터 — 한 브랜치의 발견 또는 발견 하나 */
  | { kind: 'findings'; branch?: string; finding?: string };

export interface EntityLinkProps {
  projectSlug: string;
  entity: EntityRef;
  /** 없으면 키를 Mono 로 그린다 */
  children?: React.ReactNode;
  className?: string;
  /** 눌러서 고르는 카드 안 — 링크가 카드 선택까지 부르지 않게 */
  stop?: boolean;
  testId?: string;
  /** 글자가 짧은 표식(AI 칩 등)일 때 무엇을 가리키는지 */
  title?: string | undefined;
}

export function EntityLink({
  projectSlug,
  entity,
  children,
  className,
  stop = false,
  testId,
  title,
}: EntityLinkProps): React.JSX.Element {
  const common = {
    className: cn('text-link hover:underline', className),
    'data-testid': testId,
    title,
    ...(stop ? { onClick: (e: React.MouseEvent) => e.stopPropagation() } : {}),
  };
  const mono = (text: string): React.ReactNode =>
    children ?? <span className="font-mono">{text}</span>;
  switch (entity.kind) {
    case 'task':
      return (
        <Link
          to="/p/$proj/tasks/$task"
          params={{ proj: projectSlug, task: entity.key }}
          {...common}
        >
          {mono(entity.key)}
        </Link>
      );
    case 'session':
      return (
        <Link
          to="/p/$proj/sessions/$session"
          params={{ proj: projectSlug, session: entity.id }}
          {...common}
        >
          {mono(entity.id)}
        </Link>
      );
    case 'spec':
      return (
        <Link
          to="/p/$proj/specs/$spec"
          params={{ proj: projectSlug, spec: entity.key }}
          search={entity.rail === undefined ? {} : { rail: entity.rail }}
          {...common}
        >
          {mono(entity.key)}
        </Link>
      );
    case 'findings':
      return (
        <Link
          to="/p/$proj/reviews"
          params={{ proj: projectSlug }}
          search={{
            ...(entity.branch === undefined ? {} : { branch: entity.branch }),
            ...(entity.finding === undefined ? {} : { finding: entity.finding }),
          }}
          {...common}
        >
          {mono(entity.branch ?? entity.finding ?? '')}
        </Link>
      );
  }
}
