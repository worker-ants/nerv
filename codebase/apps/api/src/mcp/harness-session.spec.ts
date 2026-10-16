// 하네스가 실어 준 자기 세션 id (api.md §1.4c · REQ-API-324)

import { describe, expect, it } from 'vitest';
import { harnessSessionOf } from './harness-session.js';

describe('Codex 의 _meta 에서 세션 id 를 읽는다', () => {
  it('x-codex-turn-metadata.session_id 를 읽는다 — 2026-10-15 실측의 모양 그대로', () => {
    const meta = {
      callId: 'call_0',
      'x-codex-turn-metadata': {
        session_id: '01a13ccd-9361-71c1-9543-1f365db47b64',
        thread_id: '01a13ccd-9361-71c1-9543-1f365db47b64',
        turn_id: '01a13ccd-9397-70f0-87f3-eff17ff1d195',
      },
      sessionId: '01a13ccd-9361-71c1-9543-1f365db47b64',
    };
    expect(harnessSessionOf(meta)).toBe('01a13ccd-9361-71c1-9543-1f365db47b64');
  });

  it.each([
    ['_meta 가 없다', undefined],
    ['Claude Code 의 _meta', { progressToken: 1 }],
    ['세션 id 가 문자열이 아니다', { 'x-codex-turn-metadata': { session_id: 7 } }],
    ['빈 문자열', { 'x-codex-turn-metadata': { session_id: '' } }],
    ['모양이 틀렸다', { 'x-codex-turn-metadata': { session_id: 'a b' } }],
    ['너무 길다', { 'x-codex-turn-metadata': { session_id: 'a'.repeat(129) } }],
  ])('%s — 없는 것으로 본다', (_label, meta) => {
    expect(harnessSessionOf(meta)).toBeNull();
  });
});
