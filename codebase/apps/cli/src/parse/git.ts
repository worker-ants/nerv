// git 에서 입력 스냅샷을 되찾는다 — 리뷰 임포트 전용(importer.md §2.7)
//
// **원본에 없는 것을 만들어 내는 것이 아니라 이미 있는 것을 찾는 것이다.** clemvion
// `meta.json` 에는 `head_sha`·`base_sha`·`branch` 가 없다(표본 SUMMARY 200개 중 47개만
// 산문에 해시를 남겼다 — data-model §3.3). 그런데 리뷰 산출물 자체가 커밋돼 있으므로
// "이 리뷰를 담은 커밋"과 그 부모는 git 이 알고 있다. 그것이 우리가 쓸 수 있는 가장
// 정확한 스냅샷이다.
//
// **한 번만 훑는다.** 세션마다 `git log` 를 부르면 1,984회 프로세스를 띄우게 된다 —
// 이력 한 번 훑기로 경로 → 커밋 지도를 만든 뒤 조회한다(실측 100초 → 2초).

import { execFileSync } from 'node:child_process';

export interface Snapshot {
  head_sha: string;
  base_sha: string;
}

/**
 * `pathspec` 아래 파일이 **처음 추가된** 커밋과 그 첫 부모를 **디렉터리 단위로** 모은다.
 * 리뷰 디렉터리는 한 번 쓰고 고치지 않으므로 "추가된 커밋"이 곧 그 리뷰가 끝난 시점이고,
 * 한 세션의 파일들은 같은 커밋에 함께 들어오므로 디렉터리 하나에 스냅샷 하나면 충분하다.
 */
export function snapshotMap(root: string, pathspec: string): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  let log: string;
  try {
    log = execFileSync(
      'git',
      [
        'log',
        '--diff-filter=A',
        '--reverse',
        '--format=C%x09%H%x09%P',
        '--name-only',
        '--',
        pathspec,
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );
  } catch {
    // git 저장소가 아니거나 이력이 없다 — 임포터는 이 경우를 결함이 아니라
    // "스냅샷 없음"으로 다루고 해당 세션을 건너뛴다(리포트에 남는다).
    return out;
  }

  let head = '';
  let base = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('C\t')) {
      const [, sha, parents] = line.split('\t');
      head = sha ?? '';
      base = (parents ?? '').split(' ')[0] ?? '';
      continue;
    }
    const path = line.trim();
    if (path === '' || head === '') continue;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir === '') continue;
    // `--reverse` 라 먼저 오는 것이 최초 추가다 — 나중 것으로 덮지 않는다
    if (!out.has(dir)) out.set(dir, { head_sha: head, base_sha: base });
  }
  return out;
}

/** 세션 디렉터리의 스냅샷. 지도가 디렉터리로 색인돼 있어 조회는 상수 시간이다. */
export function snapshotOf(map: Map<string, Snapshot>, sessionDir: string): Snapshot | null {
  return map.get(sessionDir) ?? null;
}

/**
 * 파일이 **지금 경로에 추가된 커밋의 시각**. plan 임포트가 완료 시점으로 쓴다.
 *
 * clemvion plan frontmatter 에는 `started` 는 있어도 **완료일이 없다**(실측). 그런데
 * 완료된 계획은 `plan/in-progress/` 에서 `plan/complete/` 로 옮겨져 커밋되므로, 그
 * 경로에 처음 나타난 커밋이 곧 "완료한 날"이다 — 리뷰의 `head_sha` 를 되찾은 것과
 * 같은 방법이다(§2.7).
 *
 * 되찾지 못하면 `null` 이고, 그때 서버는 적재 시각으로 떨어진다.
 */
export function addedAtMap(root: string, pathspec: string): Map<string, string> {
  const out = new Map<string, string>();
  let log: string;
  try {
    log = execFileSync(
      'git',
      [
        'log',
        '--diff-filter=A',
        // **rename 감지를 끈다.** 완료된 계획은 `plan/in-progress/` 에서
        // `plan/complete/` 로 **옮겨져** 커밋되는데, pathspec(`plan/`)이 두 경로를 모두
        // 덮으므로 git 은 그것을 rename 으로 보고 `A` 에서 제외한다 — 그러면 완료
        // 경로가 이력에 아예 나타나지 않는다(실측 2026-08-24: 409건 중 267건이 그렇게
        // 사라졌다). 우리가 묻는 것은 "내용이 어디서 왔나"가 아니라 **"이 경로가 언제
        // 생겼나"** 이므로 rename 을 delete + add 로 보는 편이 맞다.
        '--no-renames',
        '--reverse',
        '--format=C%x09%cI',
        '--name-only',
        '--',
        pathspec,
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );
  } catch {
    return out;
  }

  let when = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('C\t')) {
      when = line.slice(2).trim();
      continue;
    }
    const path = line.trim();
    if (path === '' || when === '') continue;
    // `--reverse` 라 먼저 오는 것이 최초 추가다 — 나중 것으로 덮지 않는다
    if (!out.has(path)) out.set(path, when);
  }
  return out;
}
