// REST 클라이언트 — base path /api/v1 (docs/04-mvp/api.md §1.2)
//
// 에러 본문은 MCP 와 같은 봉투다(§1.4). 여기서는 그 봉투를 NervApiError 로 되살려
// 화면이 `code` 로 분기할 수 있게 한다 — 화면별 UI 매핑은 screens.md §1.5 표가 정본이다.
// 인증은 세션 쿠키라 credentials: 'include' 면 충분하다(웹은 PAT 를 쓰지 않는다).

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

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, signal } = options;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });

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
