// 값 한 칸을 클립보드로 — 설치 장의 환경 카드 · 토큰 탭의 연결 3단계 · 스펙 시작 카드 · 터미널 이어쓰기 카드 ·
// 원문 보기가 같이 쓴다(2026-09-28 — 이어쓰기와 원문 보기는 ghost 단추를 따로 짜서 쉴 때 글자로 보였다 · REQ-WEB-271)
//
// 본문 코드블록의 단추(`markdown.ts` + 위임 핸들러)와 **같은 일을 다르게 한다** — 저쪽은
// `dangerouslySetInnerHTML` 이 낸 HTML 이라 React 가 쥘 수 없고, 이쪽은 평범한 컴포넌트다.
// 글자는 같은 두 키를 쓴다.

import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';
import { Button } from './ui/primitives.js';

export function CopyButton({
  value,
  testId,
  label,
  className,
}: {
  value: string;
  testId?: string | undefined;
  /** 무엇을 복사하는지 — 없으면 "복사" (값이 곁에 보이는 자리) */
  label?: string | undefined;
  /** 자리 — 원문 보기처럼 글 위 모서리에 얹을 때 */
  className?: string | undefined;
}): React.JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      className={cn('shrink-0', className)}
      data-testid={testId}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), COPIED_MS);
        });
      }}
    >
      {copied ? t('help.copied') : (label ?? t('help.copy'))}
    </Button>
  );
}

/** 복사했다는 표시가 남아 있는 시간 — 본문 코드블록도 같은 값을 쓴다. */
export const COPIED_MS = 1500;
