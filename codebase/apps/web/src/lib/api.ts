// REST 클라이언트 — base path /api/v1 (docs/04-mvp/api.md §1.2)
//
// 에러 본문은 MCP 와 같은 봉투다(§1.4). 여기서는 그 봉투를 NervApiError 로 되살려
// 화면이 `code` 로 분기할 수 있게 한다 — 화면별 UI 매핑은 screens.md §1.5 표가 정본이다.
// 인증은 세션 쿠키라 credentials: 'include' 면 충분하다(웹은 PAT 를 쓰지 않는다).

import { acceptLanguageHeader } from './i18n.js';
import type { NervErrorCode } from '@nerv/schema';

export interface NervErrorBody {
  ok: false;
  code: NervErrorCode | null;
  message: string;
  details: Record<string, unknown>;
  retry_after_s: number | null;
  next_actions: string[];
}

export class NervApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: NervErrorBody,
  ) {
    super(body.message);
    this.name = 'NervApiError';
  }

  get code(): NervErrorCode | null {
    return this.body.code;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 상태를 바꾸는 요청에 붙인다 — 재전송이 한 번만 실행되게(api.md §1.5) */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const BASE = '/api/v1';

/**
 * 플랫폼에 닿는가 — 배너 2단계의 ②를 켜는 스위치다(screens.md §1.3 · NFR-05).
 *
 * **판정의 축은 "서버가 답했는가" 다.** 4xx·5xx 는 서버가 *답한* 것이므로 닿은 것이고,
 * `fetch` 가 거절하는 것(네트워크 단절·프록시 다운)만 못 닿은 것이다. 상태 코드로
 * 판정하면 403 하나가 화면 전체를 오프라인으로 만든다.
 *
 * 구독자는 `RealtimeProvider` 하나다 — 배너는 앱 셸에 하나뿐이라 상태도 하나여야 한다.
 * 배너 문구·분기·폴백 폴링은 2026-09-06 까지 전부 있었고 **켜는 곳만 없었다**: REST 가
 * 죽어도 화면은 "실시간 갱신 중단" 만 말하고 캐시된 읽기 전용이라는 사실을 알리지 않았다.
 */
type ReachabilityListener = (reachable: boolean) => void;
const reachabilityListeners = new Set<ReachabilityListener>();
let lastReachable: boolean | null = null;

export function onReachabilityChange(listener: ReachabilityListener): () => void {
  reachabilityListeners.add(listener);
  return () => reachabilityListeners.delete(listener);
}

/** 값이 바뀔 때만 알린다 — 매 요청마다 setState 를 부르면 화면이 통째로 다시 그려진다 */
function reportReachable(reachable: boolean): void {
  if (lastReachable === reachable) return;
  lastReachable = reachable;
  for (const listener of reachabilityListeners) listener(reachable);
}

/** 테스트가 모듈 상태를 되돌린다 — 남으면 다음 테스트가 앞 테스트의 판정을 물려받는다 */
export function resetReachabilityForTesting(): void {
  lastReachable = null;
  reachabilityListeners.clear();
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, signal } = options;

  // 화면과 응답이 같은 언어여야 한다 — 봉투의 message 는 서버가 이 헤더를 보고 만든다
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-language': acceptLanguageHeader(),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    // **취소는 단절이 아니다.** 화면을 떠나며 abort 한 요청까지 오프라인으로 세면
    // 라우팅할 때마다 배너가 깜빡인다.
    if (!(error instanceof Error && error.name === 'AbortError')) reportReachable(false);
    throw error;
  }
  reportReachable(true);

  if (!res.ok) throw new NervApiError(res.status, await readErrorBody(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function readErrorBody(res: Response): Promise<NervErrorBody> {
  try {
    return (await res.json()) as NervErrorBody;
  } catch {
    return {
      ok: false,
      code: null,
      message: `HTTP ${res.status}`,
      details: {},
      retry_after_s: null,
      next_actions: [],
    };
  }
}
