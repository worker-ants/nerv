// EP-IMP-01~05 HTTP 클라이언트 — PAT · Idempotency-Key 재시도
//
// **DB 에 붙지 않는다**(REQ-CB-016 · REQ-IMP-012). DATABASE_URL 을 쓰지 않고 pg 도 의존하지
// 않는다 — lint 가 그 import 를 차단한다. 개발 장비에 DB 자격증명을 내보내는 것 자체가
// 배포 모델과 PAT 권한 모델(D-08)의 우회이기 때문이다.
//
// 재시도는 **같은 Idempotency-Key** 로 한다(REQ-IMP-013) — 배치 전송 중 타임아웃이 나도
// 재실행이 중복 레코드를 만들지 않는 근거가 이것이다.

import { createHash } from 'node:crypto';
import type {
  ImportBatchResult,
  ImportLinkBatchInput,
  ImportPreflightInput,
  ImportPreflightResult,
  ImportSpecBatchInput,
  ImportTaskBatchInput,
} from '@nerv/schema';

export interface ImportClientOptions {
  server: string;
  token: string;
  project: string;
  /** 재시도 횟수 — 같은 멱등 키로 다시 보낸다 */
  retries?: number;
}

export class ImportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ImportApiError';
  }
}

export class ImportClient {
  constructor(private readonly options: ImportClientOptions) {}

  preflight(input: ImportPreflightInput): Promise<ImportPreflightResult> {
    return this.post('preflight', input);
  }

  specs(input: ImportSpecBatchInput): Promise<ImportBatchResult> {
    return this.post('specs', input);
  }

  tasks(input: ImportTaskBatchInput): Promise<ImportBatchResult> {
    return this.post('tasks', input);
  }

  links(input: ImportLinkBatchInput): Promise<ImportBatchResult> {
    return this.post('links', input);
  }

  map(): Promise<{ items: Record<string, unknown>[] }> {
    return this.request('map', 'GET');
  }

  /**
   * 멱등 키는 **본문에서 결정론적으로** 만든다. 재시도가 새 키를 만들면 서버는 그것을
   * 새 요청으로 보고 배치를 한 번 더 적재한다 — 그 순간 "재실행 신규 0"이 깨진다.
   */
  private idempotencyKey(path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${this.options.project}:${path}:${JSON.stringify(body)}`, 'utf8')
      .digest('hex')
      .slice(0, 32);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request(path, 'POST', body);
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const url = `${this.options.server.replace(/\/$/, '')}/api/v1/projects/${this.options.project}/import/${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.token}`,
      accept: 'application/json',
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['Idempotency-Key'] = this.idempotencyKey(path, body);
    }

    const attempts = (this.options.retries ?? 2) + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const res = await fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (res.ok) return (await res.json()) as T;

        const envelope = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        // 4xx 는 재시도해도 같다 — 권한·스키마 문제는 사람이 고쳐야 한다
        if (res.status < 500) {
          throw new ImportApiError(
            res.status,
            envelope.code ?? null,
            envelope.message ?? `HTTP ${res.status}`,
          );
        }
        lastError = new ImportApiError(
          res.status,
          envelope.code ?? null,
          envelope.message ?? `HTTP ${res.status}`,
        );
      } catch (error) {
        if (error instanceof ImportApiError && error.status < 500) throw error;
        lastError = error;
      }
      // 같은 멱등 키로 다시 보낸다
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
