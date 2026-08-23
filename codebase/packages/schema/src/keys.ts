// 표시 키 발급 — 정본: docs/03-proposal/data-model.md §5.1
//
// **브라우저 배럴이 아니다.** `node:crypto` 를 쓰므로 `@nerv/schema` 본 배럴에 두면
// apps/web 번들이 그것을 끌고 들어가 페이지 로드에서 터진다(실측 2026-08-23 —
// `Module "node:crypto" has been externalized for browser compatibility`).
// `./migrate` 와 같은 이유의 같은 처방이다: **키를 발급하는 쪽은 서버와 CLI 뿐이다.**

import { createHash } from 'node:crypto';

/**
 * 표시 키 — `<project.key>-<타입>-<base32 6자>` (데이터 모델 §5.1 정본. 예: `CLV-T-7QF3K2`)
 *
 * UUID 는 FK 와 API 파라미터의 것이고, 이것은 **사람과 커밋 메시지와 대화의 것**이다.
 * 그래서 짧고, 그래서 폭이 문제가 된다.
 *
 * **알파벳은 혼동 문자를 뺀 base32**(Crockford — `I`·`L`·`O`·`U` 없음)다. 사람이 옮겨 적는
 * 것이 용도라 `0/O`·`1/I/L` 를 가르는 부담을 지우지 않는다. 32^6 ≈ 10.7억이라 프로젝트당
 * 4.8만 건에서도 충돌 기댓값이 1 이하다 — 이전 표기(16진 4자, 65,536)는 481건에서
 * 기댓값이 1.76 이었고 실제로 문서를 먹었다(실측 2026-08-23).
 *
 * `seed` 는 키를 **무엇에서 만들 것인가**다. 두 경로가 다른 것을 쓰는 데는 이유가 있다:
 *   - 일반 생성: Task 의 UUID — 새 행마다 새 키
 *   - 임포트: 원본 경로 — 재실행이 같은 키를 내야 멱등이 성립한다(4.7 §3.4)
 * 형식은 하나지만 씨앗은 용도가 정한다.
 */
export function displayKey(projectKey: string, type: DisplayKeyType, seed: string): string {
  return `${projectKey}-${type}-${displayKeySuffix(seed)}`;
}

/** 타입 문자 — 표시 키의 가운데 한 글자(§5.1 예시 `CLV-T-…`) */
export type DisplayKeyType = 'T' | 'S';

/**
 * 표시 키의 변하는 부분만. **충돌은 여기서만 일어난다** — 한 프로젝트 안에서 접두는 상수다.
 *
 * 따로 내보내는 이유는 임포터 CLI 다: 보내기 전에 키 충돌을 걸러야 하는데(REQ-IMP-020)
 * CLI 는 프로젝트 슬러그만 알고 `project.key` 를 모른다. 변하는 부분만 견주면 충분하다.
 */
export function displayKeySuffix(seed: string): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    // 바이트마다 하위 5비트 — 6자면 30비트다. 해시 출력이므로 어느 비트를 써도 균일하다.
    out += BASE32[digest[i]! & 31]!;
  }
  return out;
}

/** Crockford base32 — 숫자 10 + 문자 22(`I`·`L`·`O`·`U` 제외) */
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Finding fingerprint — **라운드를 넘는 동일성**(data-model §5.2 · FR-09).
 *
 * ```
 * sha256(project_id || category || normalize(file_path) || symbol_or_anchor || title_stem)
 * ```
 *
 * 무엇을 **넣지 않는가**가 이 설계의 전부다.
 *
 * - **줄 번호를 넣지 않는다.** 코드가 몇 줄 밀렸다고 새 발견이 되면 dedup 이 무의미하다.
 *   위치는 `finding.line_start` 에 따로 두고 최신 출현으로 갱신한다.
 * - **severity 를 넣지 않는다.** 넣으면 리뷰어가 severity 를 낮추는 순간 **새 finding 이
 *   생겨 하향이 감춰진다.** 하향은 감사 대상이지 새 사실이 아니다 — 원래 심각도는
 *   `finding_occurrence.raw_severity` 에 남고, 그 대조가 감사의 근거가 된다.
 *
 * 근거는 실측이다: clemvion 에서 한 changeset 이 8라운드를 도는 동안 같은 유예 항목이
 * 라운드마다 새 표 행으로 재서술됐다. 같은 지적을 같은 것으로 볼 축이 없었기 때문이다.
 */
export function findingFingerprint(input: {
  projectId: string;
  category: string;
  filePath?: string | null;
  symbol?: string | null;
  title: string;
}): Buffer {
  const parts = [
    input.projectId,
    input.category.trim().toLowerCase(),
    normalizePath(input.filePath),
    (input.symbol ?? '').trim().toLowerCase(),
    titleStem(input.title),
  ];
  return createHash('sha256').update(parts.join(' '), 'utf8').digest();
}

/** 저장소 루트 상대 경로로 — 대소문자·구분자·선행 `./` 를 정규화한다(§5.2). */
function normalizePath(path: string | null | undefined): string {
  if (path == null || path === '') return '';
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/**
 * 제목의 어간 — **숫자·경로·따옴표를 지운다**(§5.2).
 *
 * 같은 지적이 라운드마다 "3곳에서" -> "5곳에서" 처럼 수치만 바뀌어 재서술되기 때문이다.
 * 수치가 바뀌었다고 다른 발견으로 세면 dedup 이 하는 일이 없어진다.
 */
function titleStem(title: string): string {
  return title
    .toLowerCase()
    .replace(QUOTES, '')
    .replace(/[a-z0-9_.\-/]*\/[a-z0-9_.\-/]*/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 곧은 따옴표와 굽은 따옴표를 함께 지운다 — 리뷰어마다 표기가 다르다. */
const QUOTES = new RegExp('[`\'"\u201C\u201D\u2018\u2019]', 'g');

/**
 * changeset 해시 — **라운드 동일성 판정**(database.md §2.7 · data-model §2.6 필드 표).
 *
 * ```
 * sha256(base_sha || head_sha || sorted(changeset).join)
 * ```
 *
 * "무엇을 봤는가"가 같으면 같은 changeset 이다. 내용은 `head_sha` 가 못박는다 — 커밋이
 * 같으면 파일 내용도 같으므로 경로 목록과 두 커밋만으로 내용까지 결정된다.
 *
 * **정렬한다.** 리뷰어가 파일을 어떤 순서로 열거했는지는 changeset 의 성질이 아니다.
 * 같은 커밋·같은 파일 집합을 두 리뷰어가 다른 순서로 보내면 같은 세션에 들어가야 한다
 * (agent-integration §2.3 — "같은 커밋·리뷰어 재제출은 라운드 추가 없이 병합").
 */
export function changesetHash(input: {
  baseSha: string;
  headSha: string;
  changeset: readonly string[];
}): Buffer {
  const files = [...input.changeset].map((f) => normalizePath(f)).sort();
  const parts = [input.baseSha.trim(), input.headSha.trim(), ...files];
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest();
}
