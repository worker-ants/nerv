// 쓰지 않는 문구 — REQ-CB-057 (codebase.md §3.4)
//
// 카탈로그의 키는 **제품 코드가 부를 때만** 살아 있다. 화면이나 기능을 없앨 때 문구는 따라
// 지워지지 않는다 — 타입은 없는 키를 부르는 것만 막고, 아무도 부르지 않는 키는 보지 않는다.
// 2026-09-26 에 그런 키가 74개였다(웹 본문 편집을 없앤 뒤의 34개 · 홈·인박스·세션 개편 뒤의
// 40개). 번역하는 사람은 그 문장을 계속 고치고, 읽는 사람은 그런 화면이 있다고 믿는다.
// 같은 날 **쓰이지 않는 키가 결함을 가리키던 자리**도 셋 나왔다: CLI 리포트가 `cli.report.counts`
// 와 같은 문장을 한국어로 박아 두어 영어 리포트에 그 줄만 한국어였고(고쳤다), 받은 요청의 일괄
// 결정에 쓰려던 문구 셋은 한 번도 연결되지 않았다(아래 `PENDING`).
//
// 판정: 키가 제품 소스에 따옴표째(`'k'`·`"k"`·`` `k` ``) 나오거나, 아래 `DYNAMIC` 의 접두사로
// 시작하면 쓰인다. 테스트 파일은 세지 않는다 — 테스트만 부르는 문구는 사용자가 보지 못한다.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ko } from './ko.js';

const CODEBASE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * **실행 중에 키를 조립하는 자리**(`` t(`status.${…}`) ``). 그 아래 키는 어느 값이 올지 소스가
 * 모르므로 이 검사가 보지 않는다 — 각 자리의 어휘와 키 집합이 같은지는 그 자리의 테스트가
 * 본다(예: i18n.spec 의 이벤트·상태 라벨). 그래서 **접두사는 그 이름공간 전체가 한 어휘일 때만**
 * 둔다. `invite.` 처럼 다른 문구와 섞인 이름공간은 값까지 적는다.
 *
 * 타입 자리의 템플릿(`` Extract<MessageKey, `help.env.${…}`> ``)은 키를 만들지 않는다 — 그것을
 * 접두사로 믿었던 동안 그 아래의 쓰지 않는 키 둘이 숨어 있었다.
 */
const DYNAMIC: readonly { prefix: string; values?: readonly string[]; where: string }[] = [
  { prefix: 'area.', where: 'review-center — 발견의 영역' },
  { prefix: 'blocked.', where: 'domain.ts blockedReasonLabelKey' },
  { prefix: 'claim.status.', where: 'web lib/format.ts' },
  { prefix: 'cli.hint.', where: 'cli report — 규칙 이름으로 고친다' },
  { prefix: 'error.invite.', where: 'api invitation.service — 끝난 초대의 상태' },
  { prefix: 'event.', where: 'domain.ts eventLabelKey' },
  { prefix: 'evidence.kind.', where: 'web lib/format.ts' },
  { prefix: 'gate.axis.', where: 'inbox approval-card — GATE_AXES' },
  { prefix: 'gate.reason.', where: 'api gate-tier · inbox approval-card — GATE_SIGNALS' },
  {
    prefix: 'invite.',
    values: ['pending', 'accepted', 'revoked', 'expired', 'declined'],
    where: 'web invite.$token · settings/members — 초대 상태',
  },
  { prefix: 'question.escalate.', where: 'inbox approval-card — ESCALATE_REASONS' },
  { prefix: 'review.kind.', where: 'web lib/format.ts' },
  { prefix: 'review.state.', where: 'web lib/format.ts' },
  { prefix: 'reviews.action.', where: 'review-center — 처분과 그 설명(`_hint`)' },
  { prefix: 'reviews.verdict.', where: 'review-center gate-coverage' },
  { prefix: 'scope.desc.', where: 'web settings/tokens — 권한 설명' },
  { prefix: 'severity.', where: 'review-center — 발견의 심각도' },
  {
    prefix: 'spec.diff.',
    values: ['added', 'removed', 'modified', 'unchanged'],
    where: 'web version-diff',
  },
  { prefix: 'specs.type.', where: 'spec-graph — 문서 종류' },
  { prefix: 'status.', where: 'domain.ts statusLabelKey' },
  { prefix: 'theme.', where: 'web app-shell — 테마 메뉴' },
];

/**
 * **연결되지 않은 문구** — 지우면 안 되고 아직 부르는 곳도 없는 키. 사유가 곧 할 일이고,
 * 연결하면 아래 검사가 이 목록에서 빼라고 실패한다.
 */
const PENDING: Readonly<Record<string, string>> = {
  'error.approval.bulk_limit':
    '일괄 결정이 상한(BULK_DECISION_LIMIT)을 넘기면 zod 의 .max() 에 걸려 일반 형식 오류(error.request.schema)로 나간다 — 받은 요청에서 [모두 선택] 으로 51건 이상을 고르면 그 문장만 보인다',
  'inbox.bulk.blocked.quorum':
    '서버가 카드마다 일괄에서 빠지는 이유(bulk_block_reason · REQ-API-163)를 주는데 화면이 읽지 않는다 — 고른 카드가 왜 승인 가능 수에서 빠졌는지 보이지 않는다',
  'inbox.bulk.blocked.gate_bypass': '위와 같다 — bulk_gate_bypass',
};

const SOURCE_EXT = /\.(ts|tsx|mts|mjs)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'test', 'coverage']);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIR.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (SOURCE_EXT.test(entry.name) && !/\.(spec|test)\.[a-z]+$/.test(entry.name))
      out.push(path);
  }
  return out;
}

/** 제품 코드 — 앱과 패키지의 `src/`. 카탈로그 자신은 뺀다 */
function productCorpus(): string {
  const roots = ['apps', 'packages'].flatMap((top) =>
    readdirSync(join(CODEBASE, top), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(CODEBASE, top, d.name, 'src')),
  );
  const catalog = /packages\/schema\/src\/i18n\/(ko|en)\.ts$/;
  return roots
    .flatMap((root) => {
      try {
        return sources(root);
      } catch {
        return [];
      }
    })
    .filter((file) => !catalog.test(relative(CODEBASE, file).replaceAll('\\', '/')))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

const corpus = productCorpus();
const keys = Object.keys(ko);

const quoted = (key: string): boolean =>
  corpus.includes(`'${key}'`) || corpus.includes(`"${key}"`) || corpus.includes(`\`${key}\``);

const dynamic = (key: string): boolean =>
  DYNAMIC.some(
    ({ prefix, values }) =>
      key.startsWith(prefix) && (values === undefined || values.includes(key.slice(prefix.length))),
  );

describe('카탈로그의 키는 쓰인다 (REQ-CB-057)', () => {
  it('제품 소스를 실제로 읽었다 — 빈 말뭉치로 통과하지 않는다', () => {
    expect(corpus.length).toBeGreaterThan(100_000);
    expect(quoted('common.save')).toBe(true);
  });

  it('모든 키를 제품 코드가 부르거나 동적 접두사 아래에 있다', () => {
    const unused = keys.filter((key) => !quoted(key) && !dynamic(key) && !(key in PENDING));
    expect(unused).toEqual([]);
  });

  it('동적 접두사마다 그 키를 만드는 자리가 아직 있고, 그 아래 키가 있다', () => {
    const stale = DYNAMIC.filter(
      ({ prefix }) => !corpus.includes(`\`${prefix}\${`) || !keys.some((k) => k.startsWith(prefix)),
    ).map(({ prefix }) => prefix);
    expect(stale).toEqual([]);
  });

  it('값까지 적은 접두사는 그 값의 키가 모두 있다', () => {
    const missing = DYNAMIC.flatMap(({ prefix, values }) =>
      (values ?? []).map((v) => prefix + v).filter((k) => !keys.includes(k)),
    );
    expect(missing).toEqual([]);
  });

  it('연결되지 않은 문구는 정말로 부르는 곳이 없다 — 연결했으면 PENDING 에서 뺀다', () => {
    const wired = Object.keys(PENDING).filter((key) => !keys.includes(key) || quoted(key));
    expect(wired).toEqual([]);
  });
});
