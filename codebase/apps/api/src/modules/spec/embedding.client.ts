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
  /**
   * 받은 벡터가 **목표보다 길면** 앞에서 잘라 쓸 것인가 — env `NERV_EMBED_TRUNCATE`
   * (§5.2a · REQ-CB-047). 기본은 꺼져 있다.
   *
   * **MRL(Matryoshka) 로 학습한 모델에서만 켠다.** 그런 모델은 앞쪽 차원에 굵은 정보가
   * 실리도록 훈련돼 있어서, 자르고 다시 정규화한 벡터가 그 길이로 학습된 벡터와 같은
   * 구실을 한다 — OpenAI 의 `text-embedding-3` 가 `dimensions` 인자로 서버에서 하는 일이
   * 정확히 이것이고, Qwen3-Embedding 계열도 32~4096 사용자 지정 차원을 같은 방식으로
   * 지원한다. **MRL 이 아닌 모델에서 켜면 검색 품질이 조용히 나빠진다** — 그래서 기본이
   * 꺼짐이고, 켜는 것은 모델 카드를 본 사람의 결정이다.
   */
  truncate?: boolean;
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

    // **제공자가 없으면 호출하지 않고 실패한다**(REQ-CB-040). `embedOrNull` 이 이것을
    // 렉시컬 degrade 로 바꾸고(REQ-API-026), 색인 경로는 리포트의 `error` 로 받는다.
    // 빈 주소로 fetch 하면 결말은 같지만 사람이 받는 것은 URL 파싱 오류다 — 무엇을
    // 설정하지 않았는지 말해 주지 않는다.
    if (this.options.baseUrl.trim() === '') {
      throw new Error(`NERV_EMBED_URL 이 비어 있다 — 임베딩 제공자가 설정되지 않았다(§5.2a).`);
    }

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
    return vectors.map((vector) => this.fit(vector));
  }

  /**
   * 받은 벡터를 스키마 차원에 맞춘다 — 맞출 수 없으면 **그 이유와 손잡이**를 말하고 막는다.
   *
   * **거절만 하면 사람은 왜 막혔는지를 모른다**(2026-09-22 사람 보고 · REQ-CB-047). 예전
   * 문구는 "이 제공자는 프로필로 쓸 수 없다" 하나였는데, 실제 상황은 셋이고 손잡이가
   * 각각 다르다 — `dimensions` 를 보내지 않았거나 · 보냈는데 제공자가 무시했거나 ·
   * 모델이 애초에 그 값보다 짧거나. 셋을 구별해 적는다.
   */
  private fit(vector: number[]): number[] {
    if (vector.length === EMBEDDING_DIMENSIONS) return vector;

    // **짧은 것은 늘릴 방법이 없다.** 0 으로 채우면 차원은 맞지만 그 벡터는 거짓이다.
    if (vector.length < EMBEDDING_DIMENSIONS) {
      throw new Error(
        `임베딩 차원이 ${EMBEDDING_DIMENSIONS} 보다 짧습니다(${vector.length}) — ` +
          `${this.options.model} 은(는) 이 프로필로 쓸 수 없다(짧은 벡터는 늘릴 수 없다).`,
      );
    }

    if (this.options.truncate === true) return truncateTo(vector, EMBEDDING_DIMENSIONS);

    const asked = this.options.sendDimensions === true;
    throw new Error(
      `임베딩 차원이 ${EMBEDDING_DIMENSIONS} 가 아닙니다(${vector.length}) — ` +
        (asked
          ? `요청에 dimensions: ${EMBEDDING_DIMENSIONS} 를 실었는데 제공자가 그것을 무시했다. `
          : `NERV_EMBED_SEND_DIMENSIONS 가 꺼져 있어 요청에 dimensions 를 싣지 않았다. `) +
        `${this.options.model} 이 MRL(Matryoshka) 모델이면 NERV_EMBED_TRUNCATE=true 로 받는 쪽에서 ` +
        `자르고, 아니면 ${EMBEDDING_DIMENSIONS} 차원을 내는 모델로 바꾼다(§5.2a).`,
    );
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
    // **미설정과 빈 값은 다르다**(REQ-CB-040). 미설정은 개발 루프의 기본값이고, 빈 값은
    // **제공자 없음**이다 — 서비스 주소를 비운 배치를 기본값으로 떨어뜨리면 컨테이너가
    // 자기 안의 :8090 을 찌르고, 사람은 검색이 degrade 된 이유를 연결 거부 로그에서
    // 거꾸로 짚어야 한다. k8s ConfigMap 이 손잡이를 비워 두는 방식이 그것이다(§6.2).
    const configured = process.env['NERV_EMBED_URL'];
    const baseUrl = configured === undefined ? 'http://localhost:8090/v1' : configured.trim();
    if (baseUrl === '') {
      new Logger(EmbeddingClient.name).warn(
        // eslint-disable-next-line no-restricted-syntax -- 운영자용 설정 경고다(REQ-CB-022 예외)
        'NERV_EMBED_URL 이 비어 있다 — 임베딩이 꺼진다(검색은 렉시컬로 degrade · §5.2a).',
      );
    }
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
    const truncate = process.env['NERV_EMBED_TRUNCATE'] === 'true';
    const model = process.env['NERV_EMBED_MODEL'] ?? 'bge-m3';
    // **자른다는 사실은 켤 때 한 번 말한다**(REQ-CB-047). 조용히 자르면 나중에 검색
    // 품질을 의심할 때 볼 곳이 없다 — 벡터는 눈으로 확인할 수 있는 물건이 아니다.
    if (truncate) {
      new Logger(EmbeddingClient.name).log(
        `NERV_EMBED_TRUNCATE 가 켜져 있다 — ${model} 의 벡터를 ${EMBEDDING_DIMENSIONS} 차원으로 ` +
          `자르고 다시 정규화한다. MRL 로 학습한 모델에서만 뜻이 있다(§5.2a).`,
      );
    }
    return new EmbeddingClient({
      baseUrl,
      model,
      apiKey: process.env['NERV_EMBED_API_KEY'],
      sendDimensions,
      truncate,
    });
  }
}

/**
 * 앞 `size` 차원만 남기고 **다시 정규화한다** — MRL 절단의 정의다.
 *
 * **재정규화가 빠지면 코사인 거리가 틀린다.** 자른 벡터의 길이는 1 이 아니고, pgvector 의
 * `<=>` 는 벡터 정규화를 전제하지 않는 대신 내적을 두 길이로 나눈다 — 길이가 제각각이면
 * 같은 방향의 두 문서가 다른 점수를 받는다. OpenAI 도 `dimensions` 를 줄여 받을 때 서버에서
 * 같은 일을 한다고 문서에 적는다.
 *
 * 길이가 0 인 벡터는 나눌 수 없다 — 그대로 둔다(그 입력은 애초에 검색되지 않는다).
 */
export function truncateTo(vector: number[], size: number): number[] {
  const head = vector.slice(0, size);
  const norm = Math.sqrt(head.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? head : head.map((v) => v / norm);
}
