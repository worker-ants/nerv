// 터미널 이어쓰기 — 복사용 명령 한 줄 (screens.md §2.4 · §3.1 · ui-wireframes §2.3 (12))
//
// **웹에서 읽던 문서를 그 자리에서 에이전트에게 넘긴다.** 반대 방향은 이미 있었다 —
// `nerv_spec_draft_upsert` 응답의 `web_url` 이 이 화면으로 데려온다. 나가는 문만
// 없어서, 사람은 스펙 키를 손으로 옮겨 적고 있었다(그러면 오타가 세션 하나를 버린다).
//
// 카드가 명령을 **만들지 않는다** — 스킬 이름과 인자 모양은 플러그인의 계약이고
// (`plugin/skills/spec/SKILL.md`), 여기서는 그것을 그대로 조립해 보여 줄 뿐이다.

import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n.js';
import { CopyButton } from '../../components/copy-button.js';
import { helpLink } from '../../lib/manual-chapters.js';

export function TerminalHandoffCard({ specKey }: { specKey: string }): React.JSX.Element {
  const t = useT();
  const command = `claude "/nerv:spec edit ${specKey}"`;

  return (
    // 머리의 [에이전트에게 넘기기]가 이 카드로 데려온다(REQ-WEB-214) — 그 단추가 찾는 이름이다
    <section id="spec-handoff" className="mt-4 border-t border-border px-2 pt-3">
      <p className="text-2xs text-text-faint">{t('spec.handoff.title')}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <code
          data-testid="handoff-command"
          className="min-w-0 flex-1 truncate rounded-nerv bg-bg-elev px-2 py-1 font-mono text-2xs"
        >
          {command}
        </code>
        {/* 공용 복사 단추 — [에이전트에게 넘기기]가 포커스를 주는 자리라 쉴 때 단추로 보여야 한다(REQ-WEB-271).
            클립보드가 막힌 환경에서도 명령은 눈에 보이므로 손으로 옮겨 적을 수 있다 */}
        <CopyButton value={command} testId="handoff-copy" />
      </div>
      {/* 플러그인을 아직 깔지 않은 사람은 이 명령을 받아도 쓸 수 없다 — 설치 장으로 가는 길(SPEC-09) */}
      <Link
        {...helpLink('install', 'claude-code')}
        data-testid="handoff-install"
        className="mt-1 inline-block text-2xs text-link hover:underline"
      >
        {t('spec.handoff.install')} ▸
      </Link>
    </section>
  );
}

/**
 * **되돌리기도 터미널로 넘긴다**(2026-10-15 · 사람 결정 · REQ-WEB-312). 웹은 본문을 쓰지 않으므로(REQ-WEB-173) 옛 버전 보기에
 * 단추를 두지 않고, 에이전트에게 맡길 명령을 보인다 — 에이전트가 `nerv_spec_draft_upsert`(`revert_to_version`)로 그 버전의
 * 본문을 그대로 복사한 새 초안을 만들고, 그 초안은 다른 초안처럼 검토를 거친다.
 *
 * 열린 초안이나 검토 중인 버전이 있으면 서버가 거절한다(REQ-API-308) — 명령 대신 그 까닭과 할 일을 보인다.
 */
export function RevertHandoffCard({
  specKey,
  versionNo,
  blockedBy,
}: {
  specKey: string;
  /** 본문을 되살릴 옛 버전 */
  versionNo: number;
  /** 새 초안을 막는 버전 — 열린 초안 또는 검토 중 */
  blockedBy: { versionNo: number; status: 'draft' | 'in_review' } | null;
}): React.JSX.Element {
  const t = useT();
  const command = `claude "/nerv:spec revert ${specKey} ${String(versionNo)}"`;

  return (
    <section
      data-testid="revert-handoff"
      className="mb-2 rounded-nerv border border-border bg-bg-sunken px-3 py-2"
    >
      <p className="text-xs font-medium text-text">{t('spec.revert.title')}</p>
      {blockedBy === null ? (
        <>
          <p className="mt-0.5 text-2xs text-text-faint">
            {t('spec.revert.hint', { n: versionNo })}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <code
              data-testid="revert-command"
              className="min-w-0 flex-1 truncate rounded-nerv bg-bg-elev px-2 py-1 font-mono text-2xs"
            >
              {command}
            </code>
            <CopyButton value={command} testId="revert-copy" />
          </div>
        </>
      ) : (
        <p data-testid="revert-blocked" className="mt-0.5 text-2xs text-text-mute">
          {blockedBy.status === 'draft'
            ? t('spec.revert.blocked_draft', { n: blockedBy.versionNo, m: versionNo })
            : t('spec.revert.blocked_review', { n: blockedBy.versionNo })}
        </p>
      )}
    </section>
  );
}
