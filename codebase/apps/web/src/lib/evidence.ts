// 증적이 가리키는 곳 — 작업 상세의 `증적` 줄을 **누를 수 있게** 만드는 판정 (screens.md §2.5)
//
// 화면 명세 §2.5 (6) 은 처음부터 "Evidence — PR·커밋 링크" 라고 적어 두었는데 화면은 종류와
// locator 를 **글자로만** 그리고 있었다. 증적은 "보일 것을 붙였다" 는 약속이라, 그것을 보러
// 가는 길이 없으면 약속이 절반만 지켜진다(2026-09-10 — 사람 지시 · REQ-WEB-159).
//
// **형식 판정의 정본은 `@nerv/schema` 의 `checkEvidenceLocator()` 다**(REQ-CB-006). 여기서
// 하는 것은 그 위의 다른 일이다 — 통과한 locator 를 **어디로 데려갈 것인가**. 그래서 형식을
// 다시 좁히지 않고, 데려갈 곳을 만들 수 있는 것만 링크로 만들고 나머지는 글자로 둔다.
//
// **주소의 모양은 프로젝트가 고른다**(2026-09-10 · REQ-API-158 · REQ-WEB-162). 2026-09-10
// 까지는 GitHub 모양 하나만 만들었고, 자체 호스팅 GitLab 은 경로에 `/-/` 가 끼므로 그 링크가
// 404 로 끝났다 — 링크가 생긴 뒤로는 "없는 편이 나은" 종류의 오답이다. 도메인으로 추정하지
// 않는다: 자체 호스팅에서는 반드시 틀린다(`git.example.com` 은 아무것도 말하지 않는다).
//
// `evidence-locator.ts` 가 **검증에서** "GitHub 를 박지 않는다" 고 정한 것과 어긋나지 않는다 —
// 그쪽은 무엇을 받아들일지의 규칙이고 이쪽은 **표시 규칙**이다. 늘리는 자리는 둘뿐이다:
// `@nerv/schema` 의 `REPO_HOSTS` 와 아래 `HOST_PATHS`.

import { isRepoHost } from '@nerv/schema';
import type { RepoHost } from '@nerv/schema';
import { isManualChapter } from './manual-chapters.js';

/** 커밋 SHA — `evidence-locator.ts` 의 `COMMIT` 과 같은 모양이다(그쪽이 이미 거른다) */
const COMMIT = /^[0-9a-f]{7,40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 글롭은 파일 하나를 가리키지 않는다 — 데려갈 곳이 없으므로 링크로 만들지 않는다 */
const GLOB = /[*?[\]]/;
/** `path/to/file.ts:120` 의 꼬리 — 줄 번호는 앵커로 옮긴다 */
const LINE_SUFFIX = /:(\d+)$/;

/**
 * 호스트마다 다른 것은 **경로의 중간 토막 둘**뿐이다 — 커밋 하나와 파일 하나를 가리키는 길.
 * 모양을 확인하지 못한 호스트를 여기 넣지 않는다: 짐작한 주소는 틀린 곳으로 데려간다.
 */
const HOST_PATHS: Record<RepoHost, { commit: string; blob: string }> = {
  github: { commit: 'commit', blob: 'blob' },
  gitlab: { commit: '-/commit', blob: '-/blob' },
};

export interface EvidenceTarget {
  href: string;
  /** 저장소·외부 문서면 참, NERV 안의 화면이면 거짓 — 새 탭으로 여는 것은 둘 다 같다 */
  external: boolean;
}

/** `https://github.com/org/repo.git/` → `https://github.com/org/repo` */
function trimRepoUrl(repoUrl: string | null): string | null {
  const raw = repoUrl?.trim() ?? '';
  if (raw === '') return null;
  const trimmed = raw.replace(/\/+$/, '').replace(/\.git$/, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * 이 증적이 선 저장소의 주소.
 *
 * **증적은 자기 저장소를 알 수 있다**(2026-09-10 · REQ-WEB-160 · REQ-API-157).
 * `evidence.repo` 는 "멀티 저장소 대비" 로 있는 열이고 GitHub 웹훅이 거기에
 * `repository.full_name`(`worker-ants/nerv`)을 적는다 — 주소가 아니라 **경로**다.
 * 그래서 호스트는 프로젝트의 `repo_url` 에서 빌리고 경로만 갈아 끼운다: 저장소가 둘 이상인
 * 프로젝트에서 커밋 링크가 남의 저장소를 가리키던 자리다.
 *
 * 프로젝트 주소가 없으면 `repo` 가 있어도 갈 곳이 없다 — 호스트를 지어낼 수는 없다.
 */
function repoBase(repoUrl: string | null, repo: string | null | undefined): string | null {
  const projectBase = trimRepoUrl(repoUrl);
  if (projectBase === null) return null;
  const own = repo?.trim() ?? '';
  if (own === '') return projectBase;
  // 이미 절대 주소면 그것이 답이다(옛 값·다른 수집 경로가 URL 을 넣었을 수 있다)
  if (/^https?:\/\//i.test(own)) return trimRepoUrl(own);
  try {
    return `${new URL(projectBase).origin}/${own.replace(/^\/+/, '').replace(/\.git$/, '')}`;
  } catch {
    return projectBase;
  }
}

/**
 * 증적 한 건이 데려갈 곳. 만들 수 없으면 `null` 이고, 그때 화면은 글자로 둔다 —
 * **누를 수 없는 링크를 그리지 않는다**(눌러서 아무 일도 안 일어나는 것이 더 나쁘다).
 */
export function evidenceTarget(input: {
  kind: string;
  locator: string;
  /** 프로젝트의 저장소 주소(`project.repo_url`) — 없으면 커밋·코드 경로는 갈 곳이 없다 */
  repoUrl: string | null;
  defaultBranch: string | null;
  /** 이 증적이 선 저장소(`evidence.repo` — 대개 `org/repo`). 없으면 프로젝트 것을 쓴다 */
  repo?: string | null;
  /** 주소의 모양(`project.repo_host`). 어휘 밖이거나 없으면 `github` 로 읽는다 */
  repoHost?: string | null;
  /** NERV 안으로 데려갈 때 쓰는 프로젝트 slug */
  projectSlug: string;
}): EvidenceTarget | null {
  const locator = input.locator.trim();
  if (locator === '') return null;
  const base = repoBase(input.repoUrl, input.repo);
  // 어휘 밖이면 기본으로 읽는다 — 오늘 만들어져 있는 링크가 전부 그 모양이다
  const paths = HOST_PATHS[isRepoHost(input.repoHost) ? input.repoHost : 'github'];

  switch (input.kind) {
    // PR 은 **절대 URL 임을 서버가 이미 검증한다**(REQ-API-147) — 그대로 연다.
    // 그래도 다시 파싱하는 이유는 어휘가 생기기 전에 들어온 옛 값이 실재하기 때문이다.
    case 'pr': {
      try {
        const url = new URL(locator);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return { href: url.toString(), external: true };
      } catch {
        return null;
      }
    }
    case 'commit':
      return base === null || !COMMIT.test(locator)
        ? null
        : { href: `${base}/${paths.commit}/${locator}`, external: true };
    case 'code_path': {
      const branch = input.defaultBranch?.trim() ?? '';
      if (base === null || branch === '' || GLOB.test(locator)) return null;
      const line = LINE_SUFFIX.exec(locator);
      const path = (line === null ? locator : locator.slice(0, line.index)).replace(/^\/+/, '');
      if (path === '') return null;
      const anchor = line === null ? '' : `#L${line[1] ?? ''}`;
      return { href: `${base}/${paths.blob}/${branch}/${path}${anchor}`, external: true };
    }
    // 리뷰 증적은 발견 하나를 가리킬 때만 갈 곳이 있다 — 리뷰 센터가 `?finding=` 으로
    // 그것을 펴 주고, 기본 필터에 없으면 필터를 풀어 찾아 준다(REQ-WEB-120).
    case 'review':
      return UUID.test(locator)
        ? { href: `/p/${input.projectSlug}/reviews?finding=${locator}`, external: false }
        : null;
    // **매뉴얼의 장은 짐작이 아니라 대조다**(2026-09-10 · REQ-WEB-161). `user_guide` 도 오래
    // "모양을 알 수 없다" 로 두었는데, 장 이름의 정본은 `manual-chapters.ts` 에 실재한다 —
    // 목록에 있는 것만 링크로 만들면 틀린 곳으로 데려갈 일이 없다. `/help/tasks` 처럼 경로째
    // 적어 둔 값도 받는다(사람이 화면에서 본 주소를 그대로 붙이는 것이 가장 흔하다).
    case 'user_guide': {
      const chapter =
        locator
          .replace(/^\/?help\//, '')
          .replace(/^\/+|\/+$/g, '')
          .split(/[#?]/)[0] ?? '';
      return isManualChapter(chapter) ? { href: `/help/${chapter}`, external: false } : null;
    }
    // `test` 는 저장소마다 모양이 달라 데려갈 곳을 짐작할 수 없다. 짐작해서 만든 링크는
    // **틀린 곳으로 데려간다** — 글자로 두는 편이 정직하다.
    default:
      return null;
  }
}

/**
 * 링크가 되지 못한 이유 중 **사람이 고칠 수 있는 것 하나**: 저장소 주소가 비어 있다.
 * 커밋·코드 경로 증적이 있는데 `repo_url` 이 없으면 그 줄들은 영영 글자로 남는다 —
 * 빈칸은 "링크가 없는 증적" 으로 읽히지, "설정이 비었다" 로 읽히지 않는다(§1.5).
 */
export function needsRepoUrl(items: readonly { kind: string }[], repoUrl: string | null): boolean {
  if (trimRepoUrl(repoUrl) !== null) return false;
  return items.some((e) => e.kind === 'commit' || e.kind === 'code_path');
}
