// 상세 화면이 "지금 무엇을 보는가" 를 셸에 알린다 (2026-09-25 — 사람 결정 D1 · UI/UX 검토 NAV-13 · REQ-WEB-228)
//
// 탭 제목과 헤더의 브레드크럼은 셸이 **경로만 보고** 정한다(REQ-WEB-194 · 225). 그래서 스펙 세 편을 탭으로 열어
// 두면 셋 다 "스펙 · clemvion · default — NERV" 였고, 헤더도 "스펙" 에서 멈췄다 — 어느 탭이 어느 문서인지
// 가를 길이 없었다. 경로에는 키만 있고 제목은 상세 화면이 받아 온 뒤에야 안다: 그 화면이 이 작은 통로로
// 알리고 셸이 조립한다.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export interface TitleDetail {
  /** 짧은 이름 — 문서·작업의 키, 세션의 기계 이름. 브레드크럼 끝에 선다 */
  key: string;
  /** 긴 이름 — 제목. 탭 제목에만 붙는다(헤더에는 길다) */
  title?: string | null;
}

const Ctx = createContext<{
  detail: TitleDetail | null;
  set: (detail: TitleDetail | null) => void;
} | null>(null);

export function TitleDetailProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [detail, set] = useState<TitleDetail | null>(null);
  const value = useMemo(() => ({ detail, set }), [detail]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 셸이 읽는다 — 상세 화면이 아니면(또는 통로 밖이면) null */
export function useTitleDetailValue(): TitleDetail | null {
  return useContext(Ctx)?.detail ?? null;
}

/**
 * 상세 화면이 부른다. 떠나면 비운다 — 남겨 두면 목록으로 돌아온 뒤에도 탭 제목이 그 문서를 말한다.
 * `null` 이면 아직 모른다는 뜻이다(받아 오는 중) — 그동안은 키만이라도 넘기는 편이 낫다.
 */
export function useTitleDetail(detail: TitleDetail | null): void {
  const set = useContext(Ctx)?.set;
  const key = detail?.key ?? null;
  const title = detail?.title ?? null;
  useEffect(() => {
    set?.(key === null ? null : { key, title });
  }, [set, key, title]);
  useEffect(() => () => set?.(null), [set]);
}
