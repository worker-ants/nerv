// 임베딩 제공자가 **없는** 상태 — REQ-CB-040 (정본: docs/04-mvp/codebase.md §5.2a)
//
// **이 스위트가 지키는 것은 "비워 둔 것이 꺼진 것으로 읽힌다" 다.** k8s ConfigMap 은 손잡이를
// 보여 주기 위해 키를 두고 값을 비우고, compose 는 `${VAR:-}` 로 빈 값을 넘긴다. 빈 값을
// 기본값으로 떨어뜨리면 컨테이너가 자기 안의 :8090 을 찌르고, 사람은 검색이 degrade 된
// 이유를 연결 거부 로그에서 거꾸로 짚어야 한다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingClient } from './embedding.client.js';

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
