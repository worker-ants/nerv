// 값 한 칸을 클립보드로 — 설치 장의 환경 카드 · 토큰 탭의 연결 3단계 · 스펙 시작 카드가 같이 쓴다
//
// 본문 코드블록의 단추(`markdown.ts` + 위임 핸들러)와 **같은 일을 다르게 한다** — 저쪽은
// `dangerouslySetInnerHTML` 이 낸 HTML 이라 React 가 쥘 수 없고, 이쪽은 평범한 컴포넌트다.
// 글자는 같은 두 키를 쓴다.

import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Button } from './ui/primitives.js';

export function CopyButton({
  value,
  testId,
}: {
  value: string;
  testId?: string | undefined;
}): React.JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      className="shrink-0"
      data-testid={testId}
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
