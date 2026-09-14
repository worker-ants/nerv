import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService, publicEndpointWarning } from './storage.service.js';

/**
 * **문서대로 설정한 배치가 조용히 실패했다**(REQ-CB-034). `https://…/s3` 는 배포 산출물이
 * 오래 걸어 둔 예시였고, 그대로 쓰면 presigned PUT 이 SPA 의 index.html 을 200 으로 받는다 —
 * 오류가 아니라 성공처럼 보이는 실패라 원인을 읽을 자리가 어디에도 없었다.
 */
describe('공개 S3 주소 (REQ-CB-034)', () => {
  it('별도 호스트는 통과한다', () => {
    expect(publicEndpointWarning('https://s3.nerv.example.com')).toBeNull();
    expect(publicEndpointWarning('http://localhost:9000/')).toBeNull();
  });

  it('경로 접두는 경고한다 — 서명이 경로를 포함한다', () => {
    expect(publicEndpointWarning('https://nerv.example.com/s3')).toContain('SignatureDoesNotMatch');
    expect(publicEndpointWarning('https://nerv.example.com/s3/')).not.toBeNull();
  });

  it('URL 로 읽히지 않으면 그 사실을 말한다 — 조용히 넘기지 않는다', () => {
    expect(publicEndpointWarning('s3.nerv.example.com')).toContain('URL 로 읽을 수 없다');
  });
});

/**
 * **비워 둔 것이 꺼진 것으로 읽혀야 한다**(REQ-CB-040). 배치가 "설정하지 않음" 을 넘기는
 * 모양은 셋이다 — 키가 없거나, k8s ConfigMap 이 값을 비우거나, compose 가 `${VAR:-}` 로
 * 빈 값을 넘긴다. `undefined` 만 보면 뒤의 둘이 통과해 endpoint 가 `''` 인 클라이언트가
 * 만들어지고, 첨부는 **꺼지는 대신 요청마다 깨진다.**
 */
describe('첨부가 꺼지는 조건 (REQ-CB-040)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const full = () => {
    vi.stubEnv('NERV_S3_ENDPOINT', 'http://minio:9000');
    vi.stubEnv('NERV_S3_ACCESS_KEY', 'nerv');
    vi.stubEnv('NERV_S3_SECRET_KEY', 'secret');
  };

  it('셋이 다 있으면 켜진다', () => {
    full();
    expect(new StorageService().available).toBe(true);
  });

  it('**빈 문자열은 부재다** — 셋 중 하나만 비어도 꺼진다', () => {
    for (const name of ['NERV_S3_ENDPOINT', 'NERV_S3_ACCESS_KEY', 'NERV_S3_SECRET_KEY']) {
      full();
      vi.stubEnv(name, '');
      expect(new StorageService().available, name).toBe(false);
    }
  });

  it('공백만 있는 값도 부재다', () => {
    full();
    vi.stubEnv('NERV_S3_ENDPOINT', '   ');
    expect(new StorageService().available).toBe(false);
  });

  it('키가 없는 것과 빈 값은 같은 판정이다', () => {
    vi.stubEnv('NERV_S3_ENDPOINT', undefined);
    vi.stubEnv('NERV_S3_ACCESS_KEY', undefined);
    vi.stubEnv('NERV_S3_SECRET_KEY', undefined);
    expect(new StorageService().available).toBe(false);
  });
});
