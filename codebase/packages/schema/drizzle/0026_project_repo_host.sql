-- 저장소 주소의 모양을 프로젝트가 고른다 (2026-09-10 · api.md REQ-API-158)
--
-- 증적의 커밋·코드 경로를 링크로 만들 때(screens.md REQ-WEB-159) 여태 **GitHub 모양 하나**
-- 만 만들었다. 자체 호스팅 GitLab 은 경로에 `/-/` 가 끼므로 그 링크는 404 로 끝난다 —
-- 링크가 생긴 뒤로는 "없는 편이 나은" 종류의 오답이다.
--
-- **값은 사람이 고른다.** 도메인으로 추정하면 자체 호스팅에서 반드시 틀린다
-- (`git.example.com` 은 아무것도 말하지 않는다). 그리고 이 값은 **접속에 쓰이지 않는다**:
-- 서버는 대상 저장소에 접근하지 않는다(scope.md §5) — 정하는 것은 주소의 모양뿐이다.
--
-- 기본이 `github` 인 이유는 지금 만들어져 있는 링크가 전부 그 모양이기 때문이다. 다른
-- 기본값을 두면 **아무도 고르지 않은 값 때문에 오늘 되던 링크가 내일 깨진다.** 그래서
-- 기존 행도 전부 `github` 으로 눕는다(NOT NULL DEFAULT).
CREATE TYPE "public"."repo_host" AS ENUM('github', 'gitlab');--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "repo_host" "repo_host" DEFAULT 'github' NOT NULL;
