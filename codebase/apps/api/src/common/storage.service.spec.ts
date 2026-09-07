import { describe, expect, it } from 'vitest';
import { publicEndpointWarning } from './storage.service.js';

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
