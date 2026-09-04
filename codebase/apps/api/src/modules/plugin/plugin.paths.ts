// 아카이브가 어디 있는가 — 개발 트리와 컨테이너 이미지가 다르다.
//
// 이미지는 `pnpm deploy --prod /out` 으로 apps/api 만 뽑아 오므로 `plugin/` 디렉터리가
// 없다. 그래서 빌드가 `scripts/pack-plugin.mjs` 로 zip 과 매니페스트를 만들어 이미지에
// 심고, 서버는 그 자리만 읽는다. `NERV_PLUGIN_DIST` 가 그 자리를 가리킨다.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 기본값은 워크스페이스 루트의 `plugin-dist/` — 개발 트리에서 바로 돈다.
 *
 * 이미지에서는 `NERV_PLUGIN_DIST` 를 준다. 경로를 실행 위치로 추측하는 것보다 배포가
 * 말하게 하는 편이 낫다 — 추측은 `dist/` 배치가 바뀌는 날 조용히 틀린다.
 */
export function pluginDistDir(): string {
  const configured = process.env['NERV_PLUGIN_DIST'];
  if (configured !== undefined && configured !== '') return resolve(configured);
  // apps/api/src/modules/plugin → 다섯 단계 위가 워크스페이스 루트다
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '..', 'plugin-dist');
}

export function pluginManifestPath(): string {
  return join(pluginDistDir(), 'plugin.json');
}

/** 이름은 매니페스트가 정한다(`<name>-<version>.zip`) — 이 함수는 자리만 안다. */
export function pluginArchivePath(filename: string): string {
  return join(pluginDistDir(), filename);
}
