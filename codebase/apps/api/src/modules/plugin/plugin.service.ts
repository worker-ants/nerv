// 플러그인 배포 — 플랫폼이 자기 플러그인을 서빙한다 (4.6 §3.5 · REQ-API-086)
//
// **왜 서버가 카탈로그를 만드는가.** git 마켓플레이스는 모두에게 같은 파일을 준다. 그래서
// 서버 주소가 `nerv.example.com` 이 아닌 배치는 받은 뒤에 고쳐야 했고, 실측된 유일한
// 실사용 설치가 정확히 그렇게 했다 — `.mcp.json` 을 손으로 다시 쓰고 훅 6종을 갈아 끼웠다
// (4.6 v0.29). **패키지가 배포 가능한 물건이 아니면 사람은 포크한다.** 서버가 만들면
// 주소는 언제나 그 서버의 것이다.
//
// 주소의 출처는 `NERV_PUBLIC_URL` **하나**다. 요청의 `Host` 를 읽지 않는다 — 저장소는 이미
// "우리 주소는 설정값이지 요청이 말하는 것이 아니다" 로 판정해 뒀고(`mcp-origin.guard.ts` ·
// REQ-CB-013), 여기서 반대로 하면 같은 저장소가 두 개의 '우리 주소' 를 갖게 된다.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { NERV_PUBLIC_URL } from '../../common/mcp-origin.guard.js';
import { pluginArchivePath, pluginManifestPath } from './plugin.paths.js';

/** 카탈로그가 파생되는 원본 — `plugin/.claude-plugin/plugin.json` 의 읽는 부분만. */
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
 * 이 주소로 실제 설치가 되는가.
 *
 * **실측(2026-09-04)**: `claude plugin install` 이 아카이브 URL 을 검증한다 —
 * *"Archive URLs must use https:// and must not point at a loopback, link-local, or
 * cloud-metadata host"*. 카탈로그 추가(`marketplace add`)는 http·localhost 로도 성공하므로
 * **설치 직전에야 드러난다.** 개발에서는 정상이지만(수동 경로를 쓴다) 운영에서 `http://` 나
 * 내부 주소가 `NERV_PUBLIC_URL` 에 들어가면 사람은 "추가는 됐는데 설치가 안 된다" 를 만난다.
 * 그래서 서버가 먼저 말한다.
 */
export function installableFrom(publicUrl: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return { ok: false, reason: `주소를 해석할 수 없습니다: ${publicUrl}` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `아카이브 URL 은 https 여야 합니다(현재 ${url.protocol}//).` };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fe80:/.test(host);
  if (loopback) {
    return { ok: false, reason: `루프백·링크로컬 주소로는 설치되지 않습니다(${host}).` };
  }
  return { ok: true };
}

export interface PluginArchive {
  bytes: Buffer;
  filename: string;
  sha256: string;
}

@Injectable()
export class PluginService {
  private readonly logger = new Logger(PluginService.name);
  /** 아카이브는 이미지 안에서 바뀌지 않는다 — 한 번 읽고 들고 있는다. */
  private cached: PluginArchive | null = null;
  /** 같은 경고를 요청마다 찍지 않는다 — 로그가 시끄러우면 아무도 읽지 않는다. */
  private warned = false;

  constructor(
    @Optional()
    @Inject(NERV_PUBLIC_URL)
    private readonly publicUrl: string = process.env['NERV_PUBLIC_URL'] ?? 'http://localhost:8080',
  ) {}

  /**
   * 아카이브를 읽고 해시한다.
   *
   * **해시는 서버가 자기가 서빙할 파일에서 계산한다.** 빌드가 계산해 넘기면 그 값과 실제
   * 파일이 어긋날 수 있고, 어긋나면 설치가 조용히 실패한다. 대가는 분명히 해 둔다 — 같은
   * 출처가 파일과 해시를 함께 주므로 이것은 **전송 오류 검출이지 공급망 보증이 아니다.**
   * 신뢰 경계는 이 컨테이너 이미지다.
   */
  async archive(): Promise<PluginArchive | null> {
    const manifest = await this.manifest();
    if (manifest === null) return null;
    const filename = `${manifest.name}-${manifest.version}.zip`;

    // **캐시는 이름으로 확인한다.** 매니페스트는 매번 읽고 아카이브만 들고 있으면, 버전이
    // 오른 뒤 카탈로그가 `v0.2.0` 이라 말하면서 `…-0.1.0.zip` 을 가리킨다 — 실측
    // 2026-09-04. 이미지 안에서는 둘 다 안 바뀌지만, 개발 트리에서는 갈라지고 그 상태의
    // 카탈로그는 **자기 안에서 모순된다**(설치는 없는 파일을 받으러 간다).
    if (this.cached !== null && this.cached.filename === filename) return this.cached;
    const path = pluginArchivePath(filename);
    try {
      await stat(path);
    } catch {
      // 아카이브 없이도 서버는 뜬다 — 배포 산출물이 빠진 것이 API 전체를 막을 이유는 없다.
      this.logger.warn(`플러그인 아카이브가 없습니다(${path}) — /plugin 표면이 404 를 준다.`);
      return null;
    }

    const bytes = await readFile(path);
    this.cached = {
      bytes,
      filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    return this.cached;
  }

  /** 이름·버전·설명의 정본은 `plugin.json` 이다 — 카탈로그가 두 번째 원본이 되지 않게. */
  async manifest(): Promise<PluginManifest | null> {
    try {
      const raw = await readFile(pluginManifestPath(), 'utf8');
      return JSON.parse(raw) as PluginManifest;
    } catch {
      return null;
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
    const archive = await this.archive();
    const manifest = await this.manifest();
    if (archive === null || manifest === null) return null;
    const base = this.publicUrl.replace(/\/+$/, '');

    // 카탈로그는 내주되, 이 주소로는 설치가 안 된다는 사실을 운영자 로그에 남긴다.
    // 조용히 두면 "추가는 됐는데 설치가 안 된다" 를 사람이 혼자 좇게 된다.
    const installable = installableFrom(base);
    if (!installable.ok && !this.warned) {
      this.warned = true;
      this.logger.warn(
        `NERV_PUBLIC_URL(${base})로는 플러그인이 설치되지 않습니다 — ${installable.reason ?? ''} ` +
          // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그다(REQ-CB-022 예외): 배포 설정 오류를 알리는 문구이며 화면에 나가지 않는다
          '카탈로그 추가까지는 되고 설치에서 거부됩니다(4.6 §3.5).',
      );
    }

    return {
      name: 'nerv',
      owner: { name: 'NERV', url: base },
      plugins: [
        {
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
        },
      ],
    };
  }
}
