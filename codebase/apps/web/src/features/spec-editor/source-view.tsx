// 소스 보기 — read-only md (screens.md §2.4 본문 탭 · §3.1 개정)
//
// **저장이 막혔을 때 사람이 볼 수 있는 것이 있어야 한다.** REQ-WEB-031 은 왕복 검증이
// 실패하면 "저장을 차단하고 **소스 보기와 함께** 실패 리포트를 표시한다" 고 적는데,
// 2026-09-06 까지 그 소스 보기가 저장소에 없었다 — 차단만 있고 볼 것이 없는 화면이었다.
//
// **2026-09-22 부터 이것은 토글이 아니라 탭이다**(사람 결정 · REQ-WEB-173). 웹에서 본문을
// 고치는 경로를 걷어냈으므로 막을 저장도, 왕복 경고도 없다 — 남은 역할은 원본이 필요한
// 사람에게 **바이트를 그대로 주는 것**이다. 에디터가 못 그리는 것(화이트리스트 밖 노드 ·
// 표 안의 파이프)을 확인하는 자리도 여전히 여기다.
//
// **복사 단추가 있다.** 이 글을 가져가는 곳은 대개 에이전트에게 주는 프롬프트인데,
// 드래그로 긁으면 줄바꿈과 들여쓰기가 섞인다 — 본문은 md 라 그 차이가 그대로 뜻이다.

import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { Button } from '../../components/ui/primitives.js';

export function SourceView({ body }: { body: string }): React.JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {/* 오른쪽 위 모서리 — 글의 첫 줄을 가리지 않는 자리이고, mermaid 블록의
          컨트롤과 같은 규칙이다(보는 것을 돕는 단추는 내용 위에 얹지 않는다) */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="source-copy"
        className="absolute top-1.5 right-1.5 z-10 bg-bg-elev"
        onClick={() => {
          // 클립보드가 막힌 환경도 있다 — 실패해도 글은 화면에 그대로 있다
          void navigator.clipboard?.writeText(body).catch(() => undefined);
          setCopied(true);
        }}
      >
        {copied ? t('spec.source_copied') : t('spec.source_copy')}
      </Button>
      {/* **줄 번호가 있다**(2026-09-24 · SPEC-05 · REQ-WEB-215). 이 탭은 "거기 원문 몇 번째 줄" 을
          주고받으려고 만든 자리인데 번호가 없었다. 번호는 CSS 카운터라 **글자가 아니다** — 복사와
          `textContent` 에 섞이지 않는다. 줄마다 `L<n>` 이 있어 `?body=source#L120` 이 그 줄로 간다 */}
      <pre
        data-testid="source-view"
        className="overflow-x-auto rounded-nerv border border-border bg-bg-elev p-3 pr-20 font-mono text-xs whitespace-pre-wrap [counter-reset:line]"
      >
        {body.split('\n').map((line, i) => (
          <span
            key={i}
            id={`L${String(i + 1)}`}
            className="block min-h-[1lh] scroll-mt-24 pl-12 -indent-12 [counter-increment:line] before:inline-block before:w-10 before:pr-3 before:text-right before:text-text-ghost before:content-[counter(line)] target:bg-status-waiting-soft"
          >
            {line}
          </span>
        ))}
      </pre>
    </div>
  );
}
