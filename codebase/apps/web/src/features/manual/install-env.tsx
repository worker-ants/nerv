// 설치 장 머리의 "이 배치의 값" (screens.md §2.10 · REQ-WEB-165)
//
// **주소를 사람에게 물어보게 두지 않는다.** 설치 장의 첫 표는 "NERV 서버 주소 — 관리자에게"
// 라고 적고 있었다. 그런데 그 값은 화면이 이미 들고 있다(`/config.json` 의 `api_url`) —
// 사람에게 묻게 한 것은 문서의 선택이었지 모르는 값이어서가 아니었다.
//
// 본문의 자리표시자는 `manual-vars.ts` 가 채운다. 이 카드는 **그 값들이 어디서 왔는지**를
// 한자리에서 말한다 — 채워진 값과 예시값이 같은 활자로 섞여 있으면, 복사해도 되는지
// 판단할 길이 없다.
//
// 그리고 **그 주소로 설치가 되는지도 여기서 말한다**(§1.8 — 화면은 서버가 허용할 것을
// 미리 말한다). `marketplace add` 는 http·루프백으로도 성공하고 `install` 만 거부하므로,
// 말해 주지 않으면 사람은 "추가는 됐는데 설치가 안 된다" 를 혼자 좇는다(실측 2026-09-04).
// 판정의 정본은 `@nerv/schema` 하나이고 서버도 같은 것을 본다(REQ-CB-006) — 두 벌이면
// 한쪽만 고쳐지고, 그때 어느 쪽이 맞는지는 아무도 모른다.

import { checkPluginInstallUrl } from '@nerv/schema';
import type { MessageKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import type { ManualVarName, ManualVars } from '../../lib/manual-vars.js';
import { Card } from '../../components/ui/primitives.js';
import { CopyButton } from '../../components/copy-button.js';

/**
 * 줄 이름 넷 — **`help.env.` 전체로 두지 않는다.** 이 접두사에는 `{detail}` 을 받는
 * `blocked_*` 도 있고, 합집합으로 두면 자리표시자도 합집합이 되어 `t(row.labelKey)` 가
 * "인자를 더 달라" 로 컴파일되지 않는다(`manual.ts` 의 `ManualTitleKey` 와 같은 함정).
 */
type EnvLabelKey = Extract<MessageKey, `help.env.${'server' | 'project' | 'role' | 'version'}`>;

/** 막힌 이유 → 문구. 이유가 늘면 여기서 컴파일이 막힌다 — 조용히 빈 줄이 되지 않는다. */
type BlockedKey = Extract<MessageKey, `help.env.blocked_${string}`>;
const BLOCKED: Readonly<Record<'unparsable' | 'not_https' | 'loopback', BlockedKey>> = {
  unparsable: 'help.env.blocked_unparsable',
  not_https: 'help.env.blocked_not_https',
  loopback: 'help.env.blocked_loopback',
};

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
  // **예시값은 판정하지 않는다** — 그 주소는 이 배치의 것이 아니라 문서의 글자다.
  const blocked = vars.known.server ? checkPluginInstallUrl(vars.values.server) : { ok: true };

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

      {/* 빨강이 아니라 주의다 — 이 배치가 고장 난 것이 아니라 **이 한 경로**가 막힌
          것이고, 개발 루프는 손으로 넣는 길을 쓰라고 명세가 적어 둔 자리다(4.6 §3.5). */}
      {!blocked.ok && blocked.reason !== undefined && (
        <p
          data-testid="manual-env-blocked"
          className="mt-2.5 rounded-nerv border border-status-waiting/30 bg-status-waiting-soft px-2.5
            py-1.5 text-xs text-status-waiting"
        >
          {t(BLOCKED[blocked.reason], { detail: blocked.detail ?? '' })}
        </p>
      )}
    </Card>
  );
}

// 복사 단추는 토큰 탭·스펙 시작 카드도 쓴다 — 공용 자리로 옮겼다(REQ-WEB-207·208)
export { COPIED_MS } from '../../components/copy-button.js';
