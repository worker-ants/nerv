// 부하 시험 — E21-S04 · NFR-02 · NFR-04 · 성공 기준 2-7 (codebase.md §4.3a)
//
// **PR 레인에 넣지 않는다**(2026-10-17 사람 결정 D6). 30분을 잡아먹고 대상 서버가 따로 있어야 한다.
// 사람이 대상을 정해 부른다 — 로컬은 `pnpm e2e:up` 의 스택, 대표 수치는 스테이징이다.
//
//   NERV_LOAD_URL=… NERV_LOAD_EMAIL=… NERV_LOAD_PASSWORD=… pnpm load
//
// 판정이 실패하면 이 시험이 실패한다. 결과 JSON 은 NERV_LOAD_REPORT(기본 `load-report/<시각>.json`)에 남는다.
import { describe, expect, it } from 'vitest';
import { loadProfile } from './profile.js';
import { runLoad } from './run.js';

describe('부하 시험 — 보드 반영 · 게이트 판정 · 커버리지 질의', () => {
  it('세 판정이 모두 기준 안에 든다', async () => {
    // vitest 는 통과한 시험의 console 출력을 감춘다 — 결과 표는 통과해도 보여야 하므로 stdout 에 바로 쓴다
    const result = await runLoad(loadProfile(), (line) => process.stdout.write(`${line}\n`));
    for (const v of result.verdicts) {
      expect
        .soft(
          v.pass,
          `${v.name}: p95 ${v.summary.p95}ms (기준 ${v.limitMs}ms · 받지 못함 ${v.missing})`,
        )
        .toBe(true);
    }
  });
});
