// 설치 장 머리의 "이 배치의 값" (screens.md §2.10 · REQ-WEB-165)
//
// **주소를 사람에게 물어보게 두지 않는다.** 설치 장의 첫 표는 "NERV 서버 주소 — 관리자에게"
// 라고 적고 있었다. 그런데 그 값은 화면이 이미 들고 있다(`/config.json` 의 `api_url`) —
// 사람에게 묻게 한 것은 문서의 선택이었지 모르는 값이어서가 아니었다.
//
// 본문의 자리표시자는 `manual-vars.ts` 가 채운다. 이 카드는 **그 값들이 어디서 왔는지**를
// 한자리에서 말한다 — 채워진 값과 예시값이 같은 활자로 섞여 있으면, 복사해도 되는지
// 판단할 길이 없다.

import { useState } from 'react';
import type { MessageKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import type { ManualVarName, ManualVars } from '../../lib/manual-vars.js';
import { Button, Card } from '../../components/ui/primitives.js';

/** 이 카드가 부르는 이름들 — 전부 자리표시자가 없어 `t()` 가 인자를 요구하지 않는다. */
type EnvLabelKey = Extract<MessageKey, `help.env.${string}`>;

/** 카드가 싣는 넷 — 순서가 설치 장이 묻는 순서다(주소 → 프로젝트 → 역할, 그리고 버전). */
const ROWS: readonly { name: ManualVarName; labelKey: EnvLabelKey }[] = [
  { name: 'server', labelKey: 'help.env.server' },
  { name: 'project', labelKey: 'help.env.project' },
  { name: 'role', labelKey: 'help.env.role' },
  { name: 'version', labelKey: 'help.env.version' },
];

export function InstallEnvCard({ vars }: { vars: ManualVars }): React.JSX.Element {
  const t = useT();
  // 하나라도 예시가 섞였으면 그 사실을 문장으로 말한다 — 배지만으로는 "예시" 가 무슨
  // 뜻인지(내가 뭘 해야 채워지는지) 알 수 없다.
  const anyExample = ROWS.some((row) => !vars.known[row.name]);

  return (
    <Card data-testid="manual-env-card" className="mb-6">
      <p className="mb-2.5 text-sm font-semibold">{t('help.env.title')}</p>
      <dl className="flex flex-col gap-1.5">
        {ROWS.map((row) => (
          <div key={row.name} className="flex items-center gap-2 text-sm">
            <dt className="w-28 shrink-0 text-text-mute">{t(row.labelKey)}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
              <code className="min-w-0 truncate rounded-nerv-sm bg-code-bg px-1.5 py-0.5 font-mono text-xs text-code-text">
                {vars.values[row.name]}
              </code>
              {!vars.known[row.name] && (
                <span className="shrink-0 text-2xs text-text-faint">{t('help.env.example')}</span>
              )}
              {/* 단추는 값 **옆에** 붙는다 — 칸 오른쪽 끝으로 밀면 짧은 값(버전)에서
                  손이 900px 를 건너간다. 네 줄짜리 카드에 그만한 이동은 정렬값이 없다. */}
              <CopyButton value={vars.values[row.name]} />
            </dd>
          </div>
        ))}
      </dl>
      {anyExample && <p className="mt-2.5 text-xs text-text-faint">{t('help.env.hint')}</p>}
    </Card>
  );
}

/**
 * 값 한 칸을 클립보드로.
 *
 * 본문 코드블록의 단추(`markdown.ts` + 위임 핸들러)와 **같은 일을 다르게 한다** — 저쪽은
 * `dangerouslySetInnerHTML` 이 낸 HTML 이라 React 가 쥘 수 없고, 이쪽은 평범한 컴포넌트다.
 * 글자는 같은 두 키를 쓴다.
 */
function CopyButton({ value }: { value: string }): React.JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      className="shrink-0"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), COPIED_MS);
        });
      }}
    >
      {copied ? t('help.copied') : t('help.copy')}
    </Button>
  );
}

/** 복사했다는 표시가 남아 있는 시간 — 본문 코드블록도 같은 값을 쓴다. */
export const COPIED_MS = 1500;
