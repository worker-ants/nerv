// 오버레이가 **무엇을 렌더하는가** (4.2 codebase.md §6.2·§6.3 · REQ-CB-046)
//
// **렌더가 성공하는 것과 그 결과가 쓸 만한 것은 다른 일이다.** 게이트는 오래
// `kubectl kustomize … > /dev/null` 두 줄이었고, 그것은 "문법이 맞는가" 만 본다.
// 2026-09-20 실측: 두 오버레이의 Ingress 에 **경로가 0개**였다(base 는 7개). 호스트만
// 바꾸려던 전략적 병합 패치가 `spec.rules` 목록을 통째로 덮었기 때문인데, kustomize 도
// `kubectl apply` 도 롤아웃도 전부 성공한다 — 죽는 것은 **트래픽뿐**이고, 그것은 배포가
// 끝난 뒤에야 드러난다. 이 저장소가 포트에서 겪은 것과 같은 부류다(REQ-CB-038).
//
// 세는 것은 여섯이다.
//   ① 모든 Ingress 규칙에 경로가 **한 개 이상** 있는가 — 0개는 전 요청이 기본 백엔드다
//   ② API 호스트(`nerv`)가 표면 여섯(/api·/mcp·/ingest·/ws·/sse·/plugin)을 전부 갖는가
//   ③ 화면 호스트(`nerv-web`)가 `/` 하나를 갖고 **API 경로를 갖지 않는가**
//      — 화면 호스트가 API 를 겸하면 호스트를 가른 의미가 없다(4.1 §2.3)
//   ④ ConfigMap 의 공개 주소 둘이 그 두 Ingress 호스트와 **같은가**
//      — 어긋나면 쿠키가 닿지 않는 호스트로 서명되고 CORS 목록도 어긋난다
//   ⑤ 화면을 파드로 세우는 배치는 Deployment·Service·Ingress **셋을 함께** 갖는가
//      — 파드만 있고 Ingress 가 없으면 화면이 뜨는데 아무도 닿지 못한다
//   ⑥ TLS 가 그 호스트를 덮는가 — 인증서에 없는 호스트는 브라우저가 먼저 막는다
//
// 사용: node scripts/check-k8s-render.mjs

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseAllDocuments } from 'yaml';

const REPO = resolve(import.meta.dirname, '..', '..');
const OVERLAYS = ['dev', 'prod'];
/** API 호스트가 받아야 하는 표면 — 하나라도 빠지면 그 표면만 조용히 죽는다(§6.3). */
const API_PATHS = ['/api', '/mcp', '/ingest', '/ws', '/sse', '/plugin'];
const fail = [];

/** kustomize 렌더 — 실패는 그 자체로 결함이다(옛 게이트가 보던 것도 이것이다). */
function render(overlay) {
  const r = spawnSync('kubectl', ['kustomize', `deploy/k8s/overlays/${overlay}`], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    fail.push(
      `overlays/${overlay}: kustomize 렌더 실패 — ${(r.stderr ?? '').trim().split('\n')[0]}`,
    );
    return [];
  }
  return parseAllDocuments(r.stdout)
    .map((doc) => doc.toJS())
    .filter((doc) => doc !== null && typeof doc === 'object');
}

const byKind = (docs, kind, name) => docs.find((d) => d.kind === kind && d.metadata?.name === name);

for (const overlay of OVERLAYS) {
  const docs = render(overlay);
  if (docs.length === 0) continue;
  const where = `overlays/${overlay}`;

  // ① 경로 0개 — 이 검사가 이 스크립트의 존재 이유다
  for (const ingress of docs.filter((d) => d.kind === 'Ingress')) {
    for (const rule of ingress.spec?.rules ?? []) {
      const paths = rule.http?.paths ?? [];
      if (paths.length === 0) {
        fail.push(
          `${where}: Ingress ${ingress.metadata?.name} 의 호스트 ${rule.host} 에 경로가 0개다 — ` +
            `렌더도 롤아웃도 성공하지만 전 요청이 기본 백엔드로 떨어진다(패치가 rules 를 덮었나)`,
        );
      }
    }
  }

  const api = byKind(docs, 'Ingress', 'nerv');
  const web = byKind(docs, 'Ingress', 'nerv-web');
  if (api === undefined) {
    fail.push(`${where}: API Ingress(nerv)가 없다`);
    continue;
  }

  const apiRule = api.spec?.rules?.[0] ?? {};
  const apiPaths = (apiRule.http?.paths ?? []).map((p) => p.path);
  // ② 표면 여섯
  for (const path of API_PATHS) {
    if (!apiPaths.includes(path)) {
      fail.push(
        `${where}: API 호스트(${apiRule.host})에 ${path} 가 없다 — 그 표면만 조용히 죽는다`,
      );
    }
  }
  // ⑥ TLS
  if (!(api.spec?.tls ?? []).some((t) => (t.hosts ?? []).includes(apiRule.host))) {
    fail.push(`${where}: API 호스트(${apiRule.host})가 TLS hosts 에 없다 — 브라우저가 먼저 막는다`);
  }

  // ③ 화면 호스트는 `/` 하나이고 API 를 겸하지 않는다
  if (web !== undefined) {
    const webRule = web.spec?.rules?.[0] ?? {};
    const webPaths = (webRule.http?.paths ?? []).map((p) => p.path);
    if (!webPaths.includes('/')) {
      fail.push(`${where}: 화면 호스트(${webRule.host})에 / 규칙이 없다 — SPA 가 서지 않는다`);
    }
    for (const path of API_PATHS) {
      if (webPaths.includes(path)) {
        fail.push(
          `${where}: 화면 호스트(${webRule.host})가 ${path} 를 겸한다 — 호스트를 가른 의미가 없다(4.1 §2.3)`,
        );
      }
    }
    if (!(web.spec?.tls ?? []).some((t) => (t.hosts ?? []).includes(webRule.host))) {
      fail.push(`${where}: 화면 호스트(${webRule.host})가 TLS hosts 에 없다`);
    }
    // ⑤ 셋은 한 덩어리다
    for (const kind of ['Deployment', 'Service']) {
      if (byKind(docs, kind, 'nerv-web') === undefined) {
        fail.push(
          `${where}: 화면 Ingress 는 있는데 ${kind}/nerv-web 이 없다 — 닿을 곳이 없는 규칙이다`,
        );
      }
    }
  } else if (byKind(docs, 'Deployment', 'nerv-web') !== undefined) {
    fail.push(`${where}: 웹 파드는 있는데 화면 Ingress 가 없다 — 화면이 뜨는데 아무도 닿지 못한다`);
  }

  // ④ ConfigMap 의 공개 주소 둘 ↔ 두 Ingress 호스트
  const config = docs.find((d) => d.kind === 'ConfigMap' && d.metadata?.name === 'nerv-config');
  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };
  const apiUrlHost = hostOf(config?.data?.NERV_API_URL ?? '');
  if (apiUrlHost !== apiRule.host) {
    fail.push(
      `${where}: NERV_API_URL 의 호스트(${apiUrlHost})가 API Ingress 호스트(${apiRule.host})와 다르다 — ` +
        `세션 쿠키가 닿지 않는 주소로 서명되고 플러그인 카탈로그도 그 주소를 배포한다`,
    );
  }
  if (web !== undefined) {
    const webUrlHost = hostOf(config?.data?.NERV_WEB_URL ?? '');
    const webRuleHost = web.spec?.rules?.[0]?.host;
    if (webUrlHost !== webRuleHost) {
      fail.push(
        `${where}: NERV_WEB_URL 의 호스트(${webUrlHost})가 화면 Ingress 호스트(${webRuleHost})와 다르다 — ` +
          `CORS 허용 목록이 실제 화면 오리진과 어긋난다(로그인은 되는데 그 다음이 막힌다)`,
      );
    }
  }
}

if (fail.length > 0) {
  console.error('k8s 렌더 결과가 계약과 어긋났다(4.2 §6.3 · REQ-CB-046).\n');
  for (const line of fail) console.error(`  ${line}`);
  console.error('\n렌더가 성공하는 것과 그 결과가 트래픽을 받는 것은 다른 일이다.');
  process.exit(1);
}

console.log(
  `k8s 렌더 정합 — 오버레이 ${OVERLAYS.length}개 · 호스트 둘(api·app) · 표면 ${API_PATHS.length}종`,
);
