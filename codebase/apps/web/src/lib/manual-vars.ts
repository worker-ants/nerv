// 매뉴얼의 자리표시자 — 문서가 **이 배치의 값**으로 말한다 (screens.md §2.10 · REQ-WEB-165)
//
// 설치 장은 서버 주소와 프로젝트 slug 를 열 자리에서 말한다(표 · `.mcp.json` · `.nerv/env` ·
// codex `config.toml`). 그 값이 예시(`https://api.nerv.example.com` · `clemvion`)로 박혀
// 있으면 **읽은 사람이 열 번 고쳐 넣어야 하고**, 하나라도 빠뜨리면 그 자리에서 조용히
// 다른 서버를 가리킨다. 도메인이 갈린 뒤로는 "주소창에 있는 그것" 도 답이 아니다 —
// 주소창은 화면(`NERV_WEB_URL`)이고 에이전트가 붙는 곳은 API(`NERV_API_URL`)다.
//
// **값은 화면이 이미 들고 있다.** 새로 물어보는 것은 플러그인 버전 하나뿐이다:
//   server  — `/config.json` 의 `api_url`(앞문이 `NERV_API_URL` 을 그 자리에서 내어 준다)
//   project — 헤더에서 고른 프로젝트(`useScope`)
//   role    — 그 프로젝트에서의 내 역할
//   version — `/plugin/marketplace.json` (**덤이다** — 아래 "서버를 타지 않는다")
//
// **모르면 예시값이 선다.** 빈칸이나 `{{server}}` 가 보이는 것이 더 나쁘고, 예시값은
// 지금까지 그 자리에 있던 바로 그 글자다. 대신 **무엇이 예시인지는 화면이 말한다**
// (`known` — 설치 장 머리의 값 카드가 그것을 읽는다).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiBase } from './config.js';
import { useMe } from './queries.js';
import { queryKeys } from './query-keys.js';
import { useScope } from './scope.js';
import { rolesInProject } from './session.js';

export const MANUAL_VAR_NAMES = ['server', 'project', 'role', 'version'] as const;
export type ManualVarName = (typeof MANUAL_VAR_NAMES)[number];

/**
 * 값을 모를 때 서는 자리 — **지금까지 문서가 보여 주던 예시값 그대로다.**
 *
 * `version` 만 성격이 다르다: 나머지 셋은 영원히 예시지만 이것은 이 이미지가 실제로
 * 배달하는 버전이라, 어긋나면 `plugin-package.spec.ts` 가 잡는다(REQ-PLG-017).
 */
export const MANUAL_EXAMPLE: Readonly<Record<ManualVarName, string>> = {
  server: 'https://api.nerv.example.com',
  project: 'clemvion',
  role: 'developer',
  version: '0.3.0',
};

export interface ManualVars {
  readonly values: Readonly<Record<ManualVarName, string>>;
  /** 이 배치가 실제로 말해 준 값인가 — `false` 면 그 자리에 예시값이 서 있다 */
  readonly known: Readonly<Record<ManualVarName, boolean>>;
}

/** 빈 문자열은 값이 아니다 — 서버가 `""` 를 주는 자리가 실제로 있다(`api_url`). */
function pick(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** 받은 값으로 채우고 나머지는 예시로 — **판정은 여기 한 곳이다.** */
export function manualVars(
  input: Partial<Record<ManualVarName, string | null | undefined>> = {},
): ManualVars {
  const values: Record<ManualVarName, string> = { ...MANUAL_EXAMPLE };
  const known: Record<ManualVarName, boolean> = {
    server: false,
    project: false,
    role: false,
    version: false,
  };
  for (const name of MANUAL_VAR_NAMES) {
    const given = pick(input[name]);
    if (given === null) continue;
    values[name] = given;
    known[name] = true;
  }
  return { values, known };
}

/**
 * `{{이름}}` 을 값으로 바꾼다.
 *
 * **모르는 이름은 그대로 둔다** — 조용히 지우면 오타가 빈칸이 되어 문장이 멀쩡해 보인다.
 * 남은 자리표시자는 테스트가 잡는다(`manual-vars.spec.ts` — 매뉴얼 본문 전수).
 */
export function fillManualVars(source: string, vars: ManualVars): string {
  return source.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    (MANUAL_VAR_NAMES as readonly string[]).includes(name)
      ? vars.values[name as ManualVarName]
      : whole,
  );
}

/**
 * 에이전트가 붙는 주소 — **화면 주소가 아니다.**
 *
 * `apiBase()` 가 비면 화면과 API 가 한 호스트인 배치이고(`config.ts`), 그때는 지금 뜬
 * 오리진이 곧 그 주소다. 개발 루프(Vite)도 여기로 떨어지고 그 값으로 실제 `/mcp` 가
 * 닿는다 — 프록시가 같은 오리진에서 API 로 넘긴다(`vite.config.ts`).
 */
export function deployedServerOrigin(): string | null {
  const base = apiBase();
  if (base !== '') return base;
  return typeof window === 'undefined' ? null : window.location.origin;
}

/** 카탈로그에서 읽는 것은 버전 하나다 — 나머지는 설치 명령이 알아서 받는다. */
interface MarketplaceCatalog {
  plugins?: { name?: string; version?: string }[];
}

/**
 * 이 서버가 배달하는 플러그인 버전.
 *
 * **매뉴얼은 서버를 타지 않는다**(§2.10) — 그 계약은 그대로다. 장 본문과 나머지 세 값은
 * 서버 없이 서고, 이것만 **덤**이라 실패하면 조용히 번들 값으로 떨어진다. 그래서 재시도도
 * 하지 않는다: 답이 없으면 없는 대로 문서가 완성돼 있어야 한다.
 */
export function usePluginVersion(enabled: boolean): string | null {
  const origin = deployedServerOrigin() ?? '';
  const query = useQuery({
    queryKey: queryKeys.pluginCatalog(),
    queryFn: async (): Promise<string | null> => {
      const res = await fetch(`${origin}/plugin/marketplace.json`, { credentials: 'omit' });
      if (!res.ok) return null;
      // 개발 루프의 `/plugin` 은 프록시에 없어 여기로 SPA 의 index.html 이 200 으로 온다 —
      // `config.ts` 가 겪은 그 함정이라 **파싱까지 해 보고** 실패는 폴백으로 간다.
      const body = (await res.json()) as MarketplaceCatalog;
      const found = body.plugins?.find((p) => p.name === 'nerv') ?? body.plugins?.[0];
      return pick(found?.version);
    },
    enabled,
    retry: false,
    staleTime: Infinity,
  });
  return query.data ?? null;
}

/**
 * 지금 화면이 아는 값으로 매뉴얼의 자리표시자를 채운다.
 *
 * @param withVersion 버전까지 물을 것인가 — 설치 장에서만 켠다. 다른 장은 `{{version}}`
 *   을 쓰지 않으므로 물을 이유도 없다.
 */
export function useManualVars(withVersion = false): ManualVars {
  const me = useMe();
  const { orgSlug, projectSlug } = useScope();
  const version = usePluginVersion(withVersion);
  const server = deployedServerOrigin();
  // 역할이 여럿이면 **넓은 쪽을 고르지 않는다** — 토큰 권한은 합집합이라 한 이름으로
  // 줄이는 순간 거짓이 된다. 있는 대로 적는다.
  const roles = rolesInProject(me.data, orgSlug, projectSlug);
  const role = roles.length === 0 ? null : roles.join(' · ');
  // **값이 아니라 문자열 넷에 묶는다.** 매번 새 객체를 내면 그것을 받는 쪽의 `useMemo`
  // 가 렌더마다 문서를 다시 파싱한다 — 스크롤 한 번에 매뉴얼 한 장씩이다.
  return useMemo(
    () => manualVars({ server, project: projectSlug, role, version }),
    [server, projectSlug, role, version],
  );
}
