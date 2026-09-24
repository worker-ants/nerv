// 스펙이 없는 프로젝트 — **여기서 시작한다** (screens.md §2.3 · REQ-WEB-208)
//
// 빈 트리의 "첫 스펙 만들기" 는 스펙 목록(`/p/:proj/specs`)으로 갔고, 거기에는 만드는 문이 없어
// 같은 문장과 같은 링크를 다시 만났다 — 웹에서 만드는 문은 2026-09-22 에 걷혔는데(REQ-WEB-173)
// 빈 상태 문구만 그 전의 문을 가리키고 있었다(2026-09-24 UI/UX 검토 — SPEC-12 · SET-05).
//
// **실제로 시작하는 길을 말한다**: 스펙은 에이전트가 쓴다 — 터미널의 `/nerv:spec new`(스킬의 계약 ·
// `plugin/skills/spec/SKILL.md`), 에이전트가 아직 없으면 붙이는 길, 기존 문서가 있으면 CLI 임포터.
// 초안을 쓸 수 없는 역할(viewer)에게는 누가 쓰는지를 말한다 — 할 수 없는 명령을 내밀지 않는다.

import { rolesWithScope, scopesForRoles } from '@nerv/schema';
import { Link } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';
import { useMe } from '../lib/queries.js';
import { useScope } from '../lib/scope.js';
import { rolesInProject } from '../lib/session.js';
import { Card } from './ui/primitives.js';
import { ConnectAgentLinks } from './connect-agent-links.js';
import { CopyButton } from './copy-button.js';

const NEW_SPEC_COMMAND = 'claude "/nerv:spec new"';

export function SpecStartCard({ projectSlug }: { projectSlug: string }): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug } = useScope(projectSlug);
  const canDraft = scopesForRoles(rolesInProject(me.data, orgSlug, projectSlug)).has('spec:draft');

  return (
    <Card data-testid="spec-start" className="flex flex-col gap-3">
      <p className="font-medium">{t('specs.start.title')}</p>
      {canDraft ? (
        <>
          <div>
            <p className="text-sm text-text-mute">{t('specs.start.new')}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code
                data-testid="spec-start-command"
                className="min-w-0 flex-1 truncate rounded-nerv-sm bg-code-bg px-2 py-1 font-mono text-xs text-code-text"
              >
                {NEW_SPEC_COMMAND}
              </code>
              <CopyButton value={NEW_SPEC_COMMAND} testId="spec-start-copy" />
            </div>
          </div>
          <div className="text-sm text-text-mute">
            <p>{t('specs.start.no_agent')}</p>
            <div className="mt-1 flex justify-start">
              <ConnectAgentLinks />
            </div>
          </div>
          <p className="text-sm text-text-mute">
            {t('specs.start.import')}{' '}
            <Link
              to="/help/$chapter"
              params={{ chapter: 'agents' }}
              data-testid="spec-start-import"
              className="text-link hover:underline"
            >
              {t('specs.start.import_how')} ▸
            </Link>
          </p>
        </>
      ) : (
        <p data-testid="spec-start-ask" className="text-sm text-text-mute">
          {t('specs.start.ask', { roles: rolesWithScope('spec:draft').join(' · ') })}
        </p>
      )}
    </Card>
  );
}
