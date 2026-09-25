// 로그인 전 화면의 틀 — 로그인·가입·초대·비밀번호 찾기·새 비밀번호가 같이 쓴다 (screens.md §2.1 · 2026-09-25)
//
// 셸 밖이라 화면 전체가 카드 하나다 — 가운데에 두고 나머지는 비운다. 머리(표지·한 줄)와 발(언어 단추 ·
// REQ-WEB-230)이 다섯 화면에 똑같이 서야 한 번 찾은 자리를 다시 찾는다. 같은 틀이 세 벌 복사돼 있었고, 두 화면을
// 더하면 다섯 벌이 된다 — 한 곳만 고치는 날이 온다.

import { LocaleSwitch } from './locale-switch.js';

/** 폼·안내가 앉는 카드 — 다섯 화면이 같은 모양이다 */
export const AUTH_CARD = 'flex flex-col gap-3 rounded-nerv-lg border border-border bg-bg-elev p-6';

export function AuthFrame({
  lead,
  children,
}: {
  /** 표지 아래 한 줄 — 이 화면이 무엇을 하는 자리인가 */
  lead: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight">
            <span aria-hidden="true" className="text-status-action">
              ⬢
            </span>{' '}
            NERV
          </div>
          <p className="mt-1 text-sm text-text-mute">{lead}</p>
        </div>
        {children}
        {/* 로그인 전에도 언어를 바꾼다 — 사용자 메뉴는 셸 안에만 있다(REQ-WEB-230) */}
        <LocaleSwitch labelled={false} className="mt-6 flex justify-center" />
      </div>
    </div>
  );
}
