// 임베딩 제공자 클라이언트 — **OpenAI 호환 `/v1/embeddings` 단일 계약** (REQ-CB-020)
// 프로필 정본: docs/04-mvp/codebase.md §5.2a
//
// 이 파일이 존재하는 이유는 그 반대편에 있다: **제공자별 분기 코드를 만들지 않기 위해서**다.
// 로컬 ollama · 스테이징 LM Studio · 운영 OpenAI 가 전부 같은 표면을 노출하므로, 코드는
// 제공자를 모르고 env 3키(URL·MODEL·API_KEY)만 본다. 제공자 교체는 재임베딩이지 배포가 아니다.
//
// 차원은 전 프로필 고정이다(REQ-CB-021) — spec_chunk_embedding.embedding vector(N)와
// HNSW 인덱스가 차원에 묶이므로, 그 값을 내지 못하는 제공자는 프로필로 쓸 수 없다.
// **그 값의 정본은 `@nerv/schema` 의 `EMBEDDING_DIMENSIONS` 다**(DDL 이 쓰는 바로 그 상수).
// 여기서 다시 선언하면(2026-09-07 까지 그랬다) 스키마를 바꾼 날 API 의 검사만 옛 값으로
// 남아 **모든 배치가 거절된다** — 재선언 금지(REQ-CB-006)가 막으려는 것이 그것이다.

import { Logger } from '@nestjs/common';
import { EMBEDDING_DIMENSIONS } from '@nerv/schema';

/**
 * 기본 타임아웃 — **가장 느린 프로필이 기준이다.**
 *
 * 10초는 로컬 ollama(CPU)에서 거의 항상 부족했다(실측 2026-08-28: 4,000자 한 개에 5.5초,
 * 16,000자 여덟 개에 39.8초). 빠른 제공자에서 30초는 그냥 안 쓰이는 상한이지만, 느린
 * 제공자에서 10초는 **색인이 한 걸음도 못 나가는** 값이다. `NERV_EMBED_TIMEOUT_MS` 로 바꾼다.
 */
function defaultTimeoutMs(): number {
  return Number(process.env['NERV_EMBED_TIMEOUT_MS'] ?? 30_000);
}

export interface EmbeddingClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  /**
   * 요청에 `dimensions` 를 실을 것인가 — **env `NERV_EMBED_SEND_DIMENSIONS` 가 정한다**
   * (§5.2a · REQ-CB-032). 호스트로 추정하지 않는다: 같은 모델이 Azure OpenAI·LiteLLM·사내
   * 게이트웨이 뒤에 있으면 주소에 `api.openai.com` 이 없고, 그때 절단이 빠지면 1536 차원이
   * 돌아와 **검색이 조용히 렉시컬로 degrade** 한다.
   */
  sendDimensions?: boolean;
  timeoutMs?: number;
}

interface EmbeddingResponse {
  data?: { index: number; embedding: number[] }[];
}

export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);

  constructor(private readonly options: EmbeddingClientOptions) {}

  /** 실패를 숨기지 않는다 — 조용히 빈 벡터를 주면 검색이 조용히 나빠진다. */
  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey !== undefined && this.options.apiKey !== '') {
      headers['authorization'] = `Bearer ${this.options.apiKey}`;
    }

    const body: Record<string, unknown> = { model: this.options.model, input: inputs };
    if (this.options.sendDimensions === true) body['dimensions'] = EMBEDDING_DIMENSIONS;

    const timeoutMs = this.options.timeoutMs ?? defaultTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const chars = inputs.reduce((sum, text) => sum + text.length, 0);
    let payload: EmbeddingResponse;
    try {
      const res = await fetch(`${this.options.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`임베딩 제공자 오류 ${res.status}`);
      payload = (await res.json()) as EmbeddingResponse;
    } catch (error) {
      // **`AbortError` 세 글자로는 아무도 원인을 모른다.** 무엇을 얼마나 보냈고 어디서
      // 끊겼는지, 어느 손잡이를 돌리면 되는지까지 문장에 담는다 — 이 경고는 로그에만
      // 남으므로 그 자리에서 읽히지 않으면 영영 안 읽힌다.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `임베딩 제공자가 ${timeoutMs}ms 안에 응답하지 않았다(입력 ${inputs.length}개 · ${chars}자 · ` +
            `${this.options.baseUrl}). 느린 프로필이면 NERV_EMBED_TIMEOUT_MS 를 올리거나 ` +
            `NERV_EMBED_BATCH_CHARS 를 줄인다`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const vectors = (payload.data ?? [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    // REQ-CB-021 — 차원이 다르면 적재 자체를 막는다. 여기서 통과시키면 INSERT 가
    // 실패하거나(운 좋으면) 인덱스가 조용히 망가진다(운 나쁘면).
    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `임베딩 차원이 ${EMBEDDING_DIMENSIONS} 가 아닙니다(${vector.length}) — 이 제공자는 프로필로 쓸 수 없다`,
        );
      }
    }
    return vectors;
  }

  /**
   * 실패를 null 로 바꾼다 — 호출부(검색)가 **렉시컬 degrade** 를 고를 수 있게(REQ-API-026).
   * degrade 는 예외를 삼키는 것이 아니라 검색 품질을 한 단계 내리는 명시적 선택이다.
   */
  async embedOrNull(inputs: string[]): Promise<number[][] | null> {
    try {
      return await this.embed(inputs);
    } catch (error) {
      this.logger.warn(`임베딩 실패 — 렉시컬로 degrade 한다. ${String(error)}`);
      return null;
    }
  }

  /** env 로 프로필을 만든다(§5.2a) — 코드는 제공자를 모른다. */
  static fromEnv(): EmbeddingClient {
    const baseUrl = process.env['NERV_EMBED_URL'] ?? 'http://localhost:8090/v1';
    const sendDimensions = process.env['NERV_EMBED_SEND_DIMENSIONS'] === 'true';
    // **호스트는 판정에 쓰지 않고 경고에만 쓴다.** 추정으로 동작을 가르면 게이트웨이 뒤의
    // 같은 모델에서 조용히 틀리지만, 대표적인 오설정을 말해 주지 않으면 사람은 검색이
    // degrade 된 이유를 영영 모른다 — 그 둘은 다른 물음이다.
    if (!sendDimensions && baseUrl.includes('api.openai.com')) {
      new Logger(EmbeddingClient.name).warn(
        // eslint-disable-next-line no-restricted-syntax -- 운영자용 설정 경고다(REQ-CB-022 예외)
        'NERV_EMBED_SEND_DIMENSIONS 가 켜져 있지 않다 — OpenAI 프로필은 절단이 필요하다(§5.2a).',
      );
    }
    return new EmbeddingClient({
      baseUrl,
      model: process.env['NERV_EMBED_MODEL'] ?? 'bge-m3',
      apiKey: process.env['NERV_EMBED_API_KEY'],
      sendDimensions,
    });
  }
}
