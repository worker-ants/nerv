// 임베딩 제공자가 **없는** 상태 — REQ-CB-040 (정본: docs/04-mvp/codebase.md §5.2a)
//
// **이 스위트가 지키는 것은 "비워 둔 것이 꺼진 것으로 읽힌다" 다.** k8s ConfigMap 은 손잡이를
// 보여 주기 위해 키를 두고 값을 비우고, compose 는 `${VAR:-}` 로 빈 값을 넘긴다. 빈 값을
// 기본값으로 떨어뜨리면 컨테이너가 자기 안의 :8090 을 찌르고, 사람은 검색이 degrade 된
// 이유를 연결 거부 로그에서 거꾸로 짚어야 한다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingClient, truncateTo } from './embedding.client.js';

const options = { baseUrl: '', model: 'bge-m3' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('제공자 없음 — 빈 NERV_EMBED_URL (REQ-CB-040)', () => {
  it('**호출하지 않고 실패한다** — 무엇을 설정하지 않았는지 말한다', async () => {
    const client = new EmbeddingClient(options);
    await expect(client.embed(['질의'])).rejects.toThrow(/NERV_EMBED_URL/);
  });

  it('공백만 있는 값도 없는 것이다 — compose·ConfigMap 이 그렇게 넘긴다', async () => {
    const client = new EmbeddingClient({ ...options, baseUrl: '   ' });
    await expect(client.embed(['질의'])).rejects.toThrow(/NERV_EMBED_URL/);
  });

  it('embedOrNull 은 그것을 **렉시컬 degrade** 로 바꾼다(REQ-API-026)', async () => {
    expect(await new EmbeddingClient(options).embedOrNull(['질의'])).toBeNull();
  });

  it('입력이 없으면 제공자를 보지 않는다 — 빈 배치에 오류를 만들지 않는다', async () => {
    expect(await new EmbeddingClient(options).embed([])).toEqual([]);
  });
});

describe('fromEnv — 미설정과 빈 값은 다르다 (REQ-CB-040)', () => {
  it('미설정은 개발 루프의 기본값이다', async () => {
    vi.stubEnv('NERV_EMBED_URL', undefined);
    // 기본값이 섰다면 빈 주소 가드에 걸리지 않는다(네트워크는 타지 않게 빈 입력으로 본다).
    expect(await EmbeddingClient.fromEnv().embed([])).toEqual([]);
  });

  it('**빈 값은 제공자 없음이다** — 기본값으로 떨어지지 않는다', async () => {
    vi.stubEnv('NERV_EMBED_URL', '');
    await expect(EmbeddingClient.fromEnv().embed(['질의'])).rejects.toThrow(/NERV_EMBED_URL/);
  });
});

/**
 * MRL 절단의 산수 — REQ-CB-047 (2026-09-22 사람 보고)
 *
 * 운영에서 네이티브 4096 모델(`text-embedding-qwen3-embedding-8b`)이 전 배치 거절을 냈다.
 * pgvector 에서 4096 은 **인덱스를 만들 수 없으므로**(실측 0.8.6: hnsw 상한은 `vector`
 * 2000 · `halfvec` 4000) 차원 고정을 푸는 것으로는 풀리지 않는다 — MRL 모델이면 앞쪽을
 * 자르고 다시 정규화하는 것이 그 모델의 공식 경로다(Qwen3-Embedding 은 32~4096 사용자
 * 지정 차원을 그렇게 지원한다).
 */
describe('MRL 절단 (REQ-CB-047)', () => {
  it('앞에서 자른다 — 뒤가 아니다', () => {
    expect(truncateTo([3, 4, 99, 99], 2)).toEqual([0.6, 0.8]);
  });

  it('길이를 1 로 되돌린다 — 재정규화가 빠지면 코사인 점수가 틀린다', () => {
    const out = truncateTo([1, 1, 1, 1, 5, 5], 4);
    expect(Math.sqrt(out.reduce((sum, v) => sum + v * v, 0))).toBeCloseTo(1, 12);
  });

  it('방향은 그대로다 — 자른 뒤에도 앞쪽 성분의 비율이 유지된다', () => {
    const out = truncateTo([3, 4, 7], 2);
    expect((out[1] ?? 0) / (out[0] ?? 1)).toBeCloseTo(4 / 3, 12);
  });

  it('영벡터는 나눌 수 없다 — 그대로 둔다(그 입력은 애초에 검색되지 않는다)', () => {
    expect(truncateTo([0, 0, 0], 2)).toEqual([0, 0]);
  });

  it('목표보다 짧으면 늘리지 않는다 — 자를 것이 없으면 그대로다', () => {
    // 길이를 맞추는 판정은 `fit` 의 몫이고, 이 함수는 산수만 한다
    expect(truncateTo([3, 4], 8)).toEqual([0.6, 0.8]);
  });
});
