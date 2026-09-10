// 증적이 데려갈 곳 (screens.md §2.5 · REQ-WEB-159)
//
// 이 판정이 틀리면 **틀린 곳으로 데려간다** — 눌러서 아무 일도 안 일어나는 것보다 나쁘다.
// 그래서 만들 수 없는 링크는 만들지 않는다는 쪽이 이 파일의 절반이다.

import { describe, expect, it } from 'vitest';
import { evidenceTarget, needsRepoUrl } from './evidence.js';

const repo = {
  repoUrl: 'https://github.com/nerv/nerv',
  defaultBranch: 'main',
  projectSlug: 'nerv',
};

describe('evidenceTarget — 갈 곳이 있는 것만 링크가 된다', () => {
  it('pr 은 locator 가 곧 주소다', () => {
    expect(
      evidenceTarget({ ...repo, kind: 'pr', locator: 'https://git.example.com/pr/1' }),
    ).toEqual({ href: 'https://git.example.com/pr/1', external: true });
  });

  it('pr 이 URL 이 아니면 링크로 만들지 않는다 — 어휘가 생기기 전 값이 실재한다', () => {
    expect(evidenceTarget({ ...repo, kind: 'pr', locator: '다 했습니다' })).toBeNull();
    expect(evidenceTarget({ ...repo, kind: 'pr', locator: 'javascript:alert(1)' })).toBeNull();
  });

  it('commit 은 저장소 주소 위에 세운다', () => {
    expect(evidenceTarget({ ...repo, kind: 'commit', locator: 'a1b2c3d' })).toEqual({
      href: 'https://github.com/nerv/nerv/commit/a1b2c3d',
      external: true,
    });
  });

  it('저장소 주소가 없으면 commit 은 갈 곳이 없다', () => {
    expect(
      evidenceTarget({ ...repo, repoUrl: null, kind: 'commit', locator: 'a1b2c3d' }),
    ).toBeNull();
    expect(
      evidenceTarget({ ...repo, repoUrl: '  ', kind: 'commit', locator: 'a1b2c3d' }),
    ).toBeNull();
  });

  it('저장소 주소의 꼬리(`/`·`.git`)는 걷는다 — 붙은 채로 이으면 404 다', () => {
    expect(
      evidenceTarget({
        ...repo,
        repoUrl: 'https://github.com/nerv/nerv.git/',
        kind: 'commit',
        locator: 'a1b2c3d4e5f6',
      }),
    ).toEqual({ href: 'https://github.com/nerv/nerv/commit/a1b2c3d4e5f6', external: true });
  });

  it('code_path 는 기준 갈래 위의 파일이고, 줄 번호는 앵커로 옮긴다', () => {
    expect(
      evidenceTarget({ ...repo, kind: 'code_path', locator: 'apps/web/src/lib/evidence.ts:12' }),
    ).toEqual({
      href: 'https://github.com/nerv/nerv/blob/main/apps/web/src/lib/evidence.ts#L12',
      external: true,
    });
  });

  it('글롭은 파일 하나가 아니다 — 링크로 만들지 않는다', () => {
    expect(evidenceTarget({ ...repo, kind: 'code_path', locator: 'apps/web/**' })).toBeNull();
  });

  it('기준 갈래가 없으면 code_path 도 갈 곳이 없다', () => {
    expect(
      evidenceTarget({ ...repo, defaultBranch: null, kind: 'code_path', locator: 'a/b.ts' }),
    ).toBeNull();
  });

  it('review 는 발견 하나를 가리킬 때만 리뷰 센터로 간다(REQ-WEB-120)', () => {
    const id = '01990a66-4d3f-7c21-9f6a-1b2c3d4e5f60';
    expect(evidenceTarget({ ...repo, kind: 'review', locator: id })).toEqual({
      href: `/p/nerv/reviews?finding=${id}`,
      external: false,
    });
    expect(evidenceTarget({ ...repo, kind: 'review', locator: '2라운드에서 봤음' })).toBeNull();
  });

  it('test·user_guide 는 모양이 저장소마다 달라 짐작하지 않는다', () => {
    expect(evidenceTarget({ ...repo, kind: 'test', locator: 'claim.spec.ts > 원자성' })).toBeNull();
    expect(evidenceTarget({ ...repo, kind: 'user_guide', locator: '작업 장' })).toBeNull();
  });

  it('빈 locator 와 모르는 종류는 조용히 글자로 남는다', () => {
    expect(evidenceTarget({ ...repo, kind: 'pr', locator: '   ' })).toBeNull();
    expect(evidenceTarget({ ...repo, kind: 'screenshot', locator: 'x' })).toBeNull();
  });
});

/**
 * **증적은 자기 저장소를 알 수 있다**(2026-09-10 · REQ-WEB-160 · REQ-API-157).
 * `evidence.repo` 는 GitHub 웹훅이 적는 `repository.full_name`(`org/repo`) — 주소가 아니라
 * **경로**다. 그래서 호스트는 프로젝트 주소에서 빌리고 경로만 갈아 끼운다.
 */
describe('evidenceTarget — 증적이 선 저장소가 프로젝트 것을 이긴다', () => {
  it('`org/repo` 는 프로젝트 주소의 호스트 위에 얹힌다', () => {
    expect(
      evidenceTarget({ ...repo, kind: 'commit', locator: 'a1b2c3d', repo: 'worker-ants/other' }),
    ).toEqual({
      href: 'https://github.com/worker-ants/other/commit/a1b2c3d',
      external: true,
    });
  });

  it('code_path 도 같은 저장소를 본다', () => {
    expect(
      evidenceTarget({
        ...repo,
        kind: 'code_path',
        locator: 'src/a.ts',
        repo: 'worker-ants/other',
      }),
    ).toEqual({
      href: 'https://github.com/worker-ants/other/blob/main/src/a.ts',
      external: true,
    });
  });

  it('절대 주소가 들어 있으면 그것이 답이다 — 다른 수집 경로가 URL 을 넣었을 수 있다', () => {
    expect(
      evidenceTarget({
        ...repo,
        kind: 'commit',
        locator: 'a1b2c3d',
        repo: 'https://git.example.com/team/svc.git',
      }),
    ).toEqual({ href: 'https://git.example.com/team/svc/commit/a1b2c3d', external: true });
  });

  it('비어 있으면 프로젝트 것을 쓴다 — 대부분의 증적이 그렇다', () => {
    const project = { href: 'https://github.com/nerv/nerv/commit/a1b2c3d', external: true };
    // 아예 안 넘긴 자리
    expect(evidenceTarget({ ...repo, kind: 'commit', locator: 'a1b2c3d' })).toEqual(project);
    for (const own of [null, '  ']) {
      expect(evidenceTarget({ ...repo, kind: 'commit', locator: 'a1b2c3d', repo: own })).toEqual(
        project,
      );
    }
  });

  it('프로젝트 주소가 없으면 repo 가 있어도 갈 곳이 없다 — 호스트를 지어내지 않는다', () => {
    expect(
      evidenceTarget({
        ...repo,
        repoUrl: null,
        kind: 'commit',
        locator: 'a1b2c3d',
        repo: 'worker-ants/other',
      }),
    ).toBeNull();
  });
});

describe('needsRepoUrl — 링크가 아닌 이유 중 사람이 고칠 수 있는 것', () => {
  it('저장소 주소가 비었고 커밋·코드 경로 증적이 있으면 말한다', () => {
    expect(needsRepoUrl([{ kind: 'commit' }], null)).toBe(true);
    expect(needsRepoUrl([{ kind: 'code_path' }], '')).toBe(true);
  });

  it('저장소 주소가 있으면 말할 것이 없다', () => {
    expect(needsRepoUrl([{ kind: 'commit' }], 'https://github.com/nerv/nerv')).toBe(false);
  });

  it('PR·테스트만 있으면 저장소 주소와 무관하다 — 없는 문제를 말하지 않는다', () => {
    expect(needsRepoUrl([{ kind: 'pr' }, { kind: 'test' }], null)).toBe(false);
    expect(needsRepoUrl([], null)).toBe(false);
  });
});
