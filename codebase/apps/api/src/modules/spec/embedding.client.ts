// 임베딩 제공자 클라이언트 — **OpenAI 호환 `/v1/embeddings` 단일 계약** (REQ-CB-020)
// 프로필 정본: docs/04-mvp/codebase.md §5.2a
//
// 이 파일이 존재하는 이유는 그 반대편에 있다: **제공자별 분기 코드를 만들지 않기 위해서**다.
// 로컬 ollama · 스테이징 LM Studio · 운영 OpenAI 가 전부 같은 표면을 노출하므로, 코드는
// 제공자를 모르고 env 3키(URL·MODEL·API_KEY)만 본다. 제공자 교체는 재임베딩이지 배포가 아니다.
//
// 차원은 전 프로필 1024 고정이다(REQ-CB-021) — spec_chunk_embedding.embedding vector(1024)와
// HNSW 인덱스가 차원에 묶이므로, 1024를 내지 못하는 제공자는 프로필로 쓸 수 없다.

import { Logger } from '@nestjs/common';

/** 전 프로필 고정 차원 — 4.3 §2.15 · REQ-CB-021 */
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  /** OpenAI 프로필은 Matryoshka 절단을 위해 dimensions 를 함께 보낸다(§5.2a) */
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
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

  /** env 3키로 프로필을 만든다(§5.2a) — 코드는 제공자를 모른다. */
  static fromEnv(): EmbeddingClient {
    const baseUrl = process.env['NERV_EMBED_URL'] ?? 'http://localhost:8090/v1';
    return new EmbeddingClient({
      baseUrl,
      model: process.env['NERV_EMBED_MODEL'] ?? 'bge-m3',
      apiKey: process.env['NERV_EMBED_API_KEY'],
      // OpenAI 는 절단이 필요하다. 판정은 URL 이 아니라 키 존재로 하지 않는다 —
      // 명시적으로 표시하는 편이 낫지만 env 가 3키뿐이므로 호스트로 추정한다.
      sendDimensions: baseUrl.includes('api.openai.com'),
    });
  }
}
