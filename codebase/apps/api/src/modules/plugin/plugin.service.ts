// 플러그인 배포 — 플랫폼이 자기 플러그인을 서빙한다 (4.6 §3.5 · REQ-API-086)
//
// **왜 서버가 카탈로그를 만드는가.** git 마켓플레이스는 모두에게 같은 파일을 준다. 그래서
// 서버 주소가 `nerv.example.com` 이 아닌 배치는 받은 뒤에 고쳐야 했고, 실측된 유일한
// 실사용 설치가 정확히 그렇게 했다 — `.mcp.json` 을 손으로 다시 쓰고 훅 6종을 갈아 끼웠다
// (4.6 v0.29). **패키지가 배포 가능한 물건이 아니면 사람은 포크한다.** 서버가 만들면
// 주소는 언제나 그 서버의 것이다.
//
// 주소의 출처는 `NERV_API_URL` **하나**다. 카탈로그와 zip 을 서빙하는 것이 api 이므로
// 화면 주소(`NERV_WEB_URL`)가 아니다(REQ-CB-036). 요청의 `Host` 는 읽지 않는다 — 저장소는 이미
// "우리 주소는 설정값이지 요청이 말하는 것이 아니다" 로 판정해 뒀고(`mcp-origin.guard.ts` ·
// REQ-CB-013), 여기서 반대로 하면 같은 저장소가 두 개의 '우리 주소' 를 갖게 된다.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { checkPluginInstallUrl } from '@nerv/schema';
import type { PluginInstallVerdict } from '@nerv/schema';
import { NERV_API_URL, apiUrlFromEnv } from '../../common/origins.js';
import { pluginArchivePath, pluginIndexPath } from './plugin.paths.js';

/**
 * 카탈로그가 파생되는 원본 — 플러그인마다 `.claude-plugin/plugin.json` 의 읽는 부분과 아카이브
 * 이름. `plugin-dist/plugins.json` 에 패커가 묶은 순서대로 있다.
 */
interface PluginManifest {
  name: string;
  version: string;
  description?: string;
}

export interface MarketplaceCatalog {
  name: string;
  owner: { name: string; url: string };
  plugins: {
    name: string;
    description?: string;
    version: string;
    source: { source: 'archive'; url: string; sha256: string };
  }[];
}

/**
 * 판정을 운영자용 한 문장으로 — **화면 문구가 아니다**(REQ-CB-022 예외).
 *
 * 판정 자체는 `@nerv/schema` 의 `checkPluginInstallUrl()` 이고, 화면은 같은 판정을 자기
 * 카탈로그 문구로 옮긴다(REQ-WEB-165). 여기서 만드는 것은 서버 로그 한 줄뿐이다.
 */
function blockedReason(verdict: PluginInstallVerdict): string {
  switch (verdict.reason) {
    case 'not_https':
      return `아카이브 URL 은 https 여야 합니다(현재 ${verdict.detail ?? ''}).`;
    case 'loopback':
      return `루프백·링크로컬 주소로는 설치되지 않습니다(${verdict.detail ?? ''}).`;
    default:
      return `주소를 해석할 수 없습니다: ${verdict.detail ?? ''}`;
  }
}

export interface PluginArchive {
  bytes: Buffer;
  filename: string;
  sha256: string;
}

@Injectable()
export class PluginService {
  private readonly logger = new Logger(PluginService.name);
  /** 아카이브는 이미지 안에서 바뀌지 않는다 — 한 번 읽고 기억해 둔다(파일 이름이 열쇠다). */
  private readonly cached = new Map<string, PluginArchive>();
  /** 같은 경고를 요청마다 찍지 않는다 — 로그가 시끄러우면 아무도 읽지 않는다. */
  private warned = false;

  constructor(
    @Optional()
    @Inject(NERV_API_URL)
    private readonly apiUrl: string = apiUrlFromEnv(),
  ) {}

  /**
   * 아카이브를 읽고 해시한다. 이름(`<플러그인>-<버전>.zip`)이 이 배포가 묶은 것이 아니면 null 이다.
   *
   * **해시는 서버가 자기가 서빙할 파일에서 계산한다.** 빌드가 계산해 넘기면 그 값과 실제
   * 파일이 어긋날 수 있고, 어긋나면 설치가 조용히 실패한다. 대가는 분명히 해 둔다 — 같은
   * 출처가 파일과 해시를 함께 주므로 이것은 **전송 오류 검출이지 공급망 보증이 아니다.**
   * 신뢰 경계는 이 컨테이너 이미지다.
   */
  async archive(filename: string): Promise<PluginArchive | null> {
    // **이름은 매니페스트에서 다시 만든다.** 매니페스트는 매번 읽고 아카이브만 들고 있으면,
    // 버전이 오른 뒤 카탈로그가 `v0.2.0` 이라 말하면서 `…-0.1.0.zip` 을 가리킨다 — 실측
    // 2026-09-04. 요청한 이름이 지금 매니페스트의 이름과 같을 때만 서빙한다.
    const known = (await this.manifests()).some((m) => archiveName(m) === filename);
    if (!known) return null;
    const hit = this.cached.get(filename);
    if (hit !== undefined) return hit;

    const path = pluginArchivePath(filename);
    try {
      await stat(path);
    } catch {
      // 아카이브 없이도 서버는 뜬다 — 배포 산출물이 빠진 것이 API 전체를 막을 이유는 없다.
      this.logger.warn(`플러그인 아카이브가 없습니다(${path}) — 카탈로그에서 뺀다.`);
      return null;
    }

    const bytes = await readFile(path);
    const archive = { bytes, filename, sha256: createHash('sha256').update(bytes).digest('hex') };
    this.cached.set(filename, archive);
    return archive;
  }

  /** 이름·버전·설명의 정본은 플러그인마다의 `plugin.json` 이다 — 카탈로그가 두 번째 원본이 되지 않게. */
  async manifests(): Promise<PluginManifest[]> {
    try {
      const raw = await readFile(pluginIndexPath(), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as PluginManifest[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * 카탈로그.
   *
   * `version` 은 **갱신 신호**다(Claude Code 플러그인 마켓플레이스 규약). zip 을 바꾸고
   * 이 값을 그대로 두면 이미 설치한 사람은 캐시된 사본을 계속 쓴다 — 오류 없이, 조용히.
   * 그래서 이 값은 `plugin.json` 에서만 오고, 그 정합은 테스트가 지킨다.
   */
  async catalog(): Promise<MarketplaceCatalog | null> {
    const base = this.apiUrl.replace(/\/+$/, '');
    const plugins: MarketplaceCatalog['plugins'] = [];
    // **이 배포가 묶은 플러그인마다 한 항목**이다(2026-09-27 · REQ-API-192). 아카이브가 빠진
    // 플러그인은 목록에서 뺀다 — 가리킬 파일이 없는 항목은 설치에서만 실패한다.
    for (const manifest of await this.manifests()) {
      const archive = await this.archive(archiveName(manifest));
      if (archive === null) continue;
      plugins.push({
        name: manifest.name,
        ...(manifest.description === undefined ? {} : { description: manifest.description }),
        version: manifest.version,
        // **상대경로를 쓰지 않는다.** URL 로 받은 카탈로그는 그 파일 하나만 내려받으므로
        // `./` 는 가리킬 대상이 없다(플러그인 마켓플레이스 문서). git 경로용 카탈로그
        // (`.claude-plugin/marketplace.json`)만 상대경로를 쓴다.
        source: {
          source: 'archive',
          url: `${base}/plugin/${archive.filename}`,
          sha256: archive.sha256,
        },
      });
    }
    if (plugins.length === 0) return null;

    // 카탈로그는 내주되, 이 주소로는 설치가 안 된다는 사실을 운영자 로그에 남긴다.
    // 조용히 두면 "추가는 됐는데 설치가 안 된다" 를 사람이 혼자 좇게 된다.
    const installable = checkPluginInstallUrl(base);
    if (!installable.ok && !this.warned) {
      this.warned = true;
      this.logger.warn(
        `NERV_API_URL(${base})로는 플러그인이 설치되지 않습니다 — ${blockedReason(installable)} ` +
          // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그다(REQ-CB-022 예외): 배포 설정 오류를 알리는 문구이며 화면에 나가지 않는다
          '카탈로그 추가까지는 되고 설치에서 거부됩니다(4.6 §3.5).',
      );
    }

    return { name: 'nerv', owner: { name: 'NERV', url: base }, plugins };
  }
}

/** 아카이브 이름은 매니페스트가 정한다 — 패커(`scripts/pack-plugin.mjs`)와 같은 규칙이다. */
function archiveName(manifest: PluginManifest): string {
  return `${manifest.name}-${manifest.version}.zip`;
}
