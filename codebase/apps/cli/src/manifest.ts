// 임포트 매니페스트 — 정본: docs/04-mvp/importer.md §3.3
//
// **서버가 진실이고 매니페스트는 캐시다.** 그런데 2026-09-06 까지 그 캐시를 쓰거나 만드는
// 코드가 저장소에 **0곳**이었다 — `--map` 은 파싱만 됐고, `rebuild-map` 은 분기가 없어
// **spec 임포트로 떨어졌다**. "다시 짓는다" 는 이름의 명령이 적재를 하고 있었다는 뜻이다.
//
// 매니페스트가 없으면 잃는 것이 둘이다.
//   ① `map-conflict` — "매니페스트 없이 동일 자연 키가 이미 있으면 중단"(§3.3)은 *우리가
//      넣은 것*과 *남이 넣은 것*을 가릴 수 있을 때만 옳다. 캐시가 없으면 정상 재실행까지
//      중단되므로 그 게이트를 **켤 수가 없었다**(2026-09-06 PR #1 이 켜지 않고 남긴 자리).
//   ② 별칭 표 — 원본 경로·id → UUID. 링크 재작성과 plan 의 `spec_impact` 경로 변환이
//      이 표를 쓴다.
//
// 잃어도 되는 물건이라는 것이 설계의 핵심이다. 잃으면 `rebuild-map` 이 **서버에서**
// 다시 짓는다(EP-IMP-05) — 그래서 이 파일은 서버가 이미 아는 것을 적어 둘 뿐, 서버가
// 모르는 사실을 만들어 내지 않는다.

import { readFileSync, writeFileSync } from 'node:fs';

/** 매니페스트 한 항목 — §3.3 표의 `items[]` */
export interface ManifestItem {
  source_path: string;
  kind: 'spec' | 'plan';
  /** 원본 frontmatter `id`(없으면 경로에서 만든 키) — 서버의 자연 키와 같은 값이다 */
  natural_key: string;
  spec_id?: string;
  spec_version_id?: string;
  task_id?: string;
  content_hash?: string;
  /** 추출된 `requirement.ref` → UUID */
  requirements?: Record<string, string>;
}

export interface Manifest {
  profile: string;
  project: string;
  /** 스캔 시점 원본의 git HEAD — 이 매니페스트가 *어느 원본*을 적은 것인지 */
  root_commit: string | null;
  /** 마지막으로 쓴 시각. 사람이 "이게 언제 것인가" 를 묻는다 */
  written_at: string;
  items: ManifestItem[];
  /** 미해소 `pending_plans` 경로(P1 에서 해소) · 해소 실패 링크 */
  unresolved: string[];
}

export function emptyManifest(profile: string, project: string): Manifest {
  return {
    profile,
    project,
    root_commit: null,
    written_at: new Date().toISOString(),
    items: [],
    unresolved: [],
  };
}

/**
 * 읽는다. **없으면 없는 것이지 실패가 아니다** — 첫 실행에는 당연히 없다.
 *
 * 다만 **깨진 파일은 조용히 넘기지 않는다.** 빈 매니페스트로 떨어지면 그 실행은
 * "처음 하는 임포트" 로 판정되고, `map-conflict` 가 이미 있는 프로젝트를 향해 발화한다 —
 * 사람은 그 중단의 이유를 파일이 깨졌다는 데서 찾지 못한다.
 */
export function readManifest(path: string): Manifest | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw) as Partial<Manifest>;
  if (typeof parsed.profile !== 'string' || !Array.isArray(parsed.items)) {
    throw new Error(`매니페스트 형식이 아닙니다: ${path}`);
  }
  return {
    profile: parsed.profile,
    project: typeof parsed.project === 'string' ? parsed.project : '',
    root_commit: typeof parsed.root_commit === 'string' ? parsed.root_commit : null,
    written_at: typeof parsed.written_at === 'string' ? parsed.written_at : '',
    items: parsed.items as ManifestItem[],
    unresolved: Array.isArray(parsed.unresolved) ? (parsed.unresolved as string[]) : [],
  };
}

export function writeManifest(path: string, manifest: Manifest): void {
  writeFileSync(
    path,
    `${JSON.stringify({ ...manifest, written_at: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

/** 이 자연 키를 우리가 넣었는가 — `map-conflict` 판정의 축이다 */
export function knows(manifest: Manifest | null, naturalKey: string): boolean {
  return manifest !== null && manifest.items.some((i) => i.natural_key === naturalKey);
}

/**
 * 서버의 대조표(EP-IMP-05)로 매니페스트를 다시 짓는다 — `nerv import rebuild-map`.
 *
 * **서버가 아는 것만 적는다.** `source_path` 는 서버에 없다(자연 키만 있다) — 그래서
 * 빈 문자열로 두고, 다음 임포트가 같은 키를 만나면 그때 채운다. 없는 것을 지어내면
 * 매니페스트가 "서버가 진실" 이라는 자기 정의를 어기게 된다.
 */
export function manifestFromServerMap(
  profile: string,
  project: string,
  entries: Record<string, unknown>[],
): Manifest {
  const manifest = emptyManifest(profile, project);
  for (const entry of entries) {
    const kind = entry['kind'] === 'task' ? 'plan' : 'spec';
    const naturalKey = String(entry['natural_key'] ?? '');
    if (naturalKey === '') continue;
    const item: ManifestItem = { source_path: '', kind, natural_key: naturalKey };
    const id = typeof entry['id'] === 'string' ? entry['id'] : undefined;
    if (id !== undefined) {
      if (kind === 'spec') item.spec_id = id;
      else item.task_id = id;
    }
    if (typeof entry['content_hash'] === 'string') item.content_hash = entry['content_hash'];
    manifest.items.push(item);
  }
  return manifest;
}
