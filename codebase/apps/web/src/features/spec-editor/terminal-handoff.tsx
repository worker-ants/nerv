// 터미널 이어쓰기 — 복사용 명령 한 줄 (screens.md §2.4 · §3.1 · ui-wireframes §2.3 (12))
//
// **웹에서 읽던 문서를 그 자리에서 에이전트에게 넘긴다.** 반대 방향은 이미 있었다 —
// `nerv_spec_draft_upsert` 응답의 `web_url` 이 이 화면으로 데려온다. 나가는 문만
// 없어서, 사람은 스펙 키를 손으로 옮겨 적고 있었다(그러면 오타가 세션 하나를 버린다).
//
// 카드가 명령을 **만들지 않는다** — 스킬 이름과 인자 모양은 플러그인의 계약이고
// (`plugin/skills/spec/SKILL.md`), 여기서는 그것을 그대로 조립해 보여 줄 뿐이다.

import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { Button } from '../../components/ui/primitives.js';

export function TerminalHandoffCard({ specKey }: { specKey: string }): React.JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const command = `claude "/nerv:spec edit ${specKey}"`;

  return (
    <section className="mt-4 border-t border-border px-2 pt-3">
      <p className="text-2xs text-text-faint">{t('spec.handoff.title')}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <code
          data-testid="handoff-command"
          className="min-w-0 flex-1 truncate rounded-nerv bg-bg-elev px-2 py-1 font-mono text-2xs"
        >
          {command}
        </code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="handoff-copy"
          onClick={() => {
            // 클립보드가 막힌 환경(비 https·권한 거부)에서도 화면은 그대로 돈다 —
            // 명령은 눈에 보이므로 손으로 옮겨 적을 수 있다.
            void navigator.clipboard?.writeText(command).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
    </section>
  );
}
