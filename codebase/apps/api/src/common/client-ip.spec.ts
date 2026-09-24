// 클라이언트 주소 — 신뢰하는 프록시를 기준으로 (4.2 §5.5 · REQ-CB-055)
//
// 운영은 Cloudflare Tunnel 뒤다: 엣지 → cloudflared(파드) → ingress(파드) → api.
// 아래 주소는 그 모양을 흉내 낸다 — 파드는 10.x, 클라이언트는 공인 주소다.

import { describe, expect, it } from 'vitest';
import {
  assertClientIpConfig,
  clientIpHeaderFromEnv,
  clientIpResolverFromEnv,
  normalizeIp,
  trustedProxiesFromEnv,
} from './client-ip.js';

const INGRESS = '10.42.0.17';
const CLOUDFLARED = '10.42.1.5';
const CLIENT = '203.0.113.9';

const tunnel = clientIpResolverFromEnv({ NERV_CLIENT_IP_HEADER: 'cf-connecting-ip' });
const plain = clientIpResolverFromEnv({});

describe('Cloudflare Tunnel 뒤', () => {
  it('CF-Connecting-IP 를 설정하면 그 값이다 — ingress 가 X-Forwarded-For 를 덮어써도', () => {
    // ingress-nginx 가 XFF 를 자기가 본 주소(cloudflared)로 덮어쓴 경우
    expect(tunnel({ 'cf-connecting-ip': CLIENT, 'x-forwarded-for': CLOUDFLARED }, INGRESS)).toEqual(
      { ip: CLIENT, source: 'header' },
    );
  });

  it('헤더를 설정하지 않아도 X-Forwarded-For 에서 사설 hop 을 건너뛰어 맞게 나온다', () => {
    // Cloudflare 는 XFF 뒤에 클라이언트를 덧붙이고, 앞문들이 자기가 본 주소를 덧붙인다
    expect(
      plain(
        { 'cf-connecting-ip': CLIENT, 'x-forwarded-for': `${CLIENT}, ${CLOUDFLARED}` },
        INGRESS,
      ),
    ).toEqual({ ip: CLIENT, source: 'xff' });
  });

  it('클라이언트가 XFF 맨 앞에 적은 값은 믿지 않는다', () => {
    expect(plain({ 'x-forwarded-for': `1.1.1.1, ${CLIENT}, ${CLOUDFLARED}` }, INGRESS)).toEqual({
      ip: CLIENT,
      source: 'xff',
    });
  });

  it('IPv6 클라이언트', () => {
    expect(tunnel({ 'cf-connecting-ip': '2001:db8::7' }, INGRESS)).toEqual({
      ip: '2001:db8::7',
      source: 'header',
    });
  });
});

describe('위조', () => {
  it('신뢰 밖에서 직접 온 연결의 헤더는 전부 무시한다 — 그 소켓이 클라이언트다', () => {
    expect(
      tunnel({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4' }, '198.51.100.20'),
    ).toEqual({ ip: '198.51.100.20', source: 'socket' });
  });

  it('헤더 값이 IP 가 아니면 싣지 않고 X-Forwarded-For 로 간다', () => {
    expect(
      tunnel({ 'cf-connecting-ip': 'evil\nGET /x 200', 'x-forwarded-for': CLIENT }, INGRESS),
    ).toEqual({ ip: CLIENT, source: 'xff' });
  });

  it('XFF 에 주소가 아닌 칸이 있으면 거기서 멈춘다 — 그 너머는 누가 적었는지 모른다', () => {
    expect(plain({ 'x-forwarded-for': `garbage, ${CLOUDFLARED}` }, INGRESS)).toEqual({
      ip: CLOUDFLARED,
      source: 'xff',
    });
  });

  it('헤더를 설정하지 않았으면 CF-Connecting-IP 를 보지 않는다', () => {
    expect(plain({ 'cf-connecting-ip': '1.2.3.4' }, INGRESS)).toEqual({
      ip: INGRESS,
      source: 'socket',
    });
  });
});

describe('주소 모양', () => {
  it('IPv4 가 IPv6 로 감싸인 소켓 주소를 편다 — 듀얼 스택 소켓이 이렇게 준다', () => {
    expect(normalizeIp('::ffff:10.42.0.17')).toBe('10.42.0.17');
    expect(plain({ 'x-forwarded-for': CLIENT }, '::ffff:10.42.0.17')).toEqual({
      ip: CLIENT,
      source: 'xff',
    });
  });

  it('끝까지 사설 hop 뿐이면 가장 바깥의 것 — 사설망 안의 클라이언트다', () => {
    expect(plain({ 'x-forwarded-for': `192.168.0.40, ${CLOUDFLARED}` }, INGRESS)).toEqual({
      ip: '192.168.0.40',
      source: 'xff',
    });
  });

  it('헤더도 XFF 도 없으면 소켓이다', () => {
    expect(plain({}, INGRESS)).toEqual({ ip: INGRESS, source: 'socket' });
    expect(plain({}, undefined)).toEqual({ ip: null, source: 'socket' });
  });
});

describe('설정', () => {
  it('NERV_TRUSTED_PROXIES 는 기본 목록을 대신한다 — 적은 대역만 믿는다', () => {
    const narrow = clientIpResolverFromEnv({ NERV_TRUSTED_PROXIES: '10.42.0.0/16' });
    expect(narrow({ 'x-forwarded-for': `${CLIENT}, 192.168.0.9` }, INGRESS)).toEqual({
      ip: '192.168.0.9',
      source: 'xff',
    });
  });

  it('주소 하나·IPv6·공백 구분도 받는다', () => {
    expect(() =>
      trustedProxiesFromEnv({ NERV_TRUSTED_PROXIES: '10.0.0.1 fd00::/8, 100.64.0.0/10' }),
    ).not.toThrow();
  });

  it.each(['10.0.0.0/33', 'not-an-ip', '10.0.0.0/', 'fc00::/129'])(
    '틀린 항목 %s 는 기동을 거부한다',
    (entry) => {
      expect(() => assertClientIpConfig({ NERV_TRUSTED_PROXIES: entry })).toThrow(
        /NERV_TRUSTED_PROXIES/,
      );
    },
  );

  it('헤더 이름은 소문자로 받고, 이름 모양이 아니면 거부한다', () => {
    expect(clientIpHeaderFromEnv({ NERV_CLIENT_IP_HEADER: ' CF-Connecting-IP ' })).toBe(
      'cf-connecting-ip',
    );
    expect(clientIpHeaderFromEnv({})).toBeNull();
    expect(() => assertClientIpConfig({ NERV_CLIENT_IP_HEADER: 'cf connecting ip' })).toThrow(
      /NERV_CLIENT_IP_HEADER/,
    );
  });
});
