// 이름을 파일 경로의 한 칸으로 — 경로 밖으로 나가지 못하게 한다 (2026-09-28 · REQ-API-235)
//
// 스펙 키와 프로젝트 slug 는 형식 검사가 없다(`z.string().min(1)`). 디스크 미러가 그 값을 그대로
// `join(root, slug, 'specs', key + '.md')` 에 넣고 있어서, 키가 `../../x` 면 `NERV_EXPORT_DIR` 밖에
// 파일이 써졌다. 키를 만들 권한(`spec:draft`)만 있으면 서버 디스크의 다른 자리를 덮을 수 있었다.
//
// 막는 자리는 **쓰는 곳**이다. 키 형식을 만드는 곳에서 막으면 이미 있는 키가 갑자기 거절되고,
// 파일이 아닌 곳(URL · 화면)에서는 그 키가 멀쩡히 쓰이고 있다.

import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

/** 파일 이름에 그대로 두는 글자 — 글자 · 숫자(한글 포함)와 `.` `_` `-` */
const KEEP = /[\p{L}\p{N}._-]/u;
/** 파일 시스템의 한 이름 칸은 255 바이트까지다 — 확장자와 여유를 빼고 자른다 */
const MAX_BYTES = 200;

/**
 * 이름을 경로의 **한 칸**으로 바꾼다. 남기는 글자 밖은 UTF-8 바이트마다 `%XX` 로 적는다 —
 * URL 경로의 퍼센트 인코딩과 같아서 `llms.txt` 의 상대 링크로 써도 원래 키로 풀린다.
 * `.` · `..` 은 `%2E` 로 적어 디렉터리를 가리키지 못하게 한다. 너무 길면 앞부분에 해시를 붙인다.
 */
export function safePathSegment(name: string): string {
  let out = '';
  for (const ch of name) {
    out += KEEP.test(ch)
      ? ch
      : [...Buffer.from(ch, 'utf8')]
          .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
          .join('');
  }
  if (out === '' || /^\.+$/.test(out)) out = out === '' ? '%00' : out.replaceAll('.', '%2E');
  if (Buffer.byteLength(out, 'utf8') > MAX_BYTES) {
    const digest = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 16);
    // 글자(코드 포인트) 단위로 자른다 — UTF-16 단위로 자르면 BMP 밖 글자가 반쪽으로 남는다
    const chars = [...out];
    while (Buffer.byteLength(chars.join(''), 'utf8') > MAX_BYTES - digest.length - 1) {
      chars.pop();
    }
    const head = chars.join('');
    // `%XX` 가 잘리면 URL 로 풀 때 깨진다 — 끝에 걸친 조각을 버린다
    out = `${head.replace(/%[0-9A-F]?$/, '')}~${digest}`;
  }
  return out;
}

/**
 * `root` 아래의 경로를 만든다. 결과가 `root` 밖이면 던진다 — `safePathSegment` 를 거친 칸만 넘기면
 * 일어나지 않지만, 나중에 누가 칸 하나를 그대로 넘겨도 여기서 막힌다(두 겹).
 */
export function resolveInside(root: string, ...segments: string[]): string {
  const base = resolve(root);
  const target = resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`경로가 ${base} 밖이다: ${target}`);
  }
  return target;
}
