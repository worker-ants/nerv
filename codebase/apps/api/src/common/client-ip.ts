// 클라이언트 주소 — 신뢰하는 프록시를 기준으로 가린다 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-055)
//
// **앞문이 하나라는 전제가 운영에서 이미 깨져 있었다**(2026-09-24 사람 보고). 운영은 Cloudflare
// Tunnel 이라 요청이 `엣지 → cloudflared → ingress → api` 로 온다. 전에는 `X-Forwarded-For` 의
// 마지막 칸을 읽었는데, 그 칸은 cloudflared 가 본 주소가 아니라 **cloudflared 자신의 주소**다 —
// 모든 줄의 `ip` 가 같은 사설 주소 하나였다.
//
// 규칙은 셋이다(판정은 이 파일 한 곳 — Fastify `trustProxy` 는 켜지 않는다):
//   ① api 에 직접 붙은 소켓(peer)이 신뢰 목록 밖이면 그것이 클라이언트다. 헤더는 전부 무시한다
//   ② 클라이언트 IP 헤더(`NERV_CLIENT_IP_HEADER` — Tunnel 이면 `cf-connecting-ip`)가 설정돼 있고
//      값이 올바른 IP 면 그 값이다. ingress 가 `X-Forwarded-For` 를 덮어써도 이 헤더는 지나간다
//   ③ 아니면 `X-Forwarded-For` 를 오른쪽부터 읽어 신뢰 목록의 주소를 건너뛰고, 처음 만난 신뢰 밖
//      주소가 클라이언트다. Cloudflare 는 이 헤더 뒤에 클라이언트 주소를 덧붙이므로 헤더 설정을
//      잊어도 Tunnel 에서 틀리지 않는다
//
// **헤더를 믿는 근거는 코드가 아니라 네트워크다.** 신뢰하는 프록시(ingress)에 인터넷이 직접 닿으면
// 누구나 `CF-Connecting-IP` 를 적어 보낼 수 있다 — Tunnel 배치는 origin 을 Tunnel 로만 닿게 둔다
// (§5.5 배치 요건). 그래서 헤더는 **켜야만** 믿는다.

import { BlockList, isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * 기본 신뢰 목록 — loopback 과 사설 대역(2026-09-24 사람 결정). 클러스터의 파드·Service 주소와
 * compose 네트워크가 여기 든다. 클러스터가 이 밖의 대역(예: 100.64.0.0/10)을 쓰면
 * `NERV_TRUSTED_PROXIES` 로 적는다 — 적지 않으면 ①에 걸려 모든 줄이 ingress 파드 주소가 된다.
 */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1/128',
  'fc00::/7',
];

export type ClientIpSource = 'socket' | 'header' | 'xff';

export interface ClientIp {
  ip: string | null;
  source: ClientIpSource;
}

export type ClientIpResolver = (
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
) => ClientIp;

/**
 * 로그에 싣는 모양으로 편다 — IPv4 가 IPv6 로 감싸인 주소(`::ffff:10.0.0.5`)는 IPv4 로.
 * 듀얼 스택 소켓은 IPv4 연결도 이 모양으로 준다. 올바른 IP 가 아니면 null — 부르는 쪽이 적은
 * 문자열을 로그에 그대로 싣지 않는다.
 */
export function normalizeIp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const candidate = mapped?.[1] ?? trimmed;
  return isIP(candidate) === 0 ? null : candidate;
}

/**
 * `NERV_TRUSTED_PROXIES` — 쉼표·공백으로 가른 CIDR(또는 주소 하나). 비면 기본 목록이다.
 * **틀린 항목은 던진다** — 조용히 버리면 그 대역의 프록시가 클라이언트로 찍히는데, 그 증상은
 * "IP 가 이상하다" 로만 드러나고 설정을 가리키지 않는다. 엔트리가 기동 전에 부른다.
 */
export function trustedProxiesFromEnv(env: NodeJS.ProcessEnv = process.env): BlockList {
  const raw = (env['NERV_TRUSTED_PROXIES'] ?? '').trim();
  const entries = raw === '' ? DEFAULT_TRUSTED_PROXIES : raw.split(/[\s,]+/).filter(Boolean);
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefixText] = entry.split('/');
    const family = isIP(address);
    if (family === 0) throw new Error(invalidProxy(entry));
    const type = family === 4 ? 'ipv4' : 'ipv6';
    const max = family === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || prefixText === '') {
      throw new Error(invalidProxy(entry));
    }
    list.addSubnet(address, prefix, type);
  }
  return list;
}

function invalidProxy(entry: string): string {
  return (
    `NERV_TRUSTED_PROXIES 의 "${entry}" 는 CIDR 이 아닙니다 — 예: 10.0.0.0/8, fc00::/7. ` +
    `비우면 loopback·사설 대역(${DEFAULT_TRUSTED_PROXIES.join(', ')})입니다.`
  );
}

/**
 * `NERV_CLIENT_IP_HEADER` — 클라이언트 주소를 싣는 헤더 이름. 비면 헤더를 믿지 않는다.
 * Cloudflare(Tunnel 포함)는 `cf-connecting-ip` 다. 헤더 이름의 모양이 아니면 던진다.
 */
export function clientIpHeaderFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env['NERV_CLIENT_IP_HEADER'] ?? '').trim().toLowerCase();
  if (raw === '') return null;
  if (!/^[a-z0-9-]+$/.test(raw)) {
    throw new Error(
      `NERV_CLIENT_IP_HEADER="${raw}" 는 헤더 이름이 아닙니다 — Cloudflare 면 cf-connecting-ip 입니다.`,
    );
  }
  return raw;
}

/** 기동 전 검사 — 틀린 설정으로 뜨느니 뜨지 않는다(`assertMailConfig` 와 같은 자리) */
export function assertClientIpConfig(env: NodeJS.ProcessEnv = process.env): void {
  trustedProxiesFromEnv(env);
  clientIpHeaderFromEnv(env);
}

function isTrusted(list: BlockList, ip: string): boolean {
  return list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createClientIpResolver(options: {
  trusted: BlockList;
  header: string | null;
}): ClientIpResolver {
  const { trusted, header } = options;
  return (headers, remoteAddress) => {
    const peer = normalizeIp(remoteAddress);
    // ① 신뢰 밖에서 직접 온 연결 — 그 연결이 적어 보낸 헤더는 무엇이든 될 수 있다
    if (peer === null || !isTrusted(trusted, peer)) return { ip: peer, source: 'socket' };

    // ② 설정한 헤더
    if (header !== null) {
      const claimed = normalizeIp(headerValue(headers, header));
      if (claimed !== null) return { ip: claimed, source: 'header' };
    }

    // ③ X-Forwarded-For 를 오른쪽부터 — 신뢰하는 hop 을 건너뛴다
    const forwarded = headers['x-forwarded-for'];
    const hops = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop !== '');
    let nearest = peer;
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const hop = normalizeIp(hops[i]);
      // 주소가 아닌 칸을 만나면 멈춘다 — 그 너머는 누가 적었는지 모른다
      if (hop === null) break;
      if (!isTrusted(trusted, hop)) return { ip: hop, source: 'xff' };
      nearest = hop;
    }
    // 끝까지 신뢰하는 hop 뿐이면 가장 바깥의 것 — 사설망 안의 클라이언트다
    return { ip: nearest, source: hops.length === 0 ? 'socket' : 'xff' };
  };
}

/** 엔트리가 쓰는 판정기 — 설정은 기동 때 한 번 읽는다 */
export function clientIpResolverFromEnv(env: NodeJS.ProcessEnv = process.env): ClientIpResolver {
  return createClientIpResolver({
    trusted: trustedProxiesFromEnv(env),
    header: clientIpHeaderFromEnv(env),
  });
}
