// 탭 제목 — REQ-WEB-194. 탭을 여럿 열어 두면 어느 것이 어느 조직·프로젝트의 무엇인지 제목뿐이다.
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@nerv/schema';
import { documentTitle, screenKeyFor } from './document-title.js';

const t = createTranslator('ko');
const scope = { orgName: 'Default', projectName: 'Clemvion' };

describe('탭 제목', () => {
  it('프로젝트 화면은 "화면 · 프로젝트 · 조직"', () => {
    expect(documentTitle(t, '/p/clemvion/tasks', scope)).toBe('작업 · Clemvion · Default — NERV');
    expect(documentTitle(t, '/p/clemvion', scope)).toBe('개요 · Clemvion · Default — NERV');
    expect(documentTitle(t, '/p/clemvion/specs/SPC-1', scope)).toBe(
      '스펙 · Clemvion · Default — NERV',
    );
  });

  it('조직 범위 화면은 기억된 프로젝트를 싣지 않는다 — 헤더에서 걷은 혼동을 탭에 되살리지 않게', () => {
    expect(documentTitle(t, '/inbox', scope)).toBe('받은 요청 · Default — NERV');
    expect(documentTitle(t, '/settings/members', scope)).toBe('설정 · Default — NERV');
    expect(documentTitle(t, '/', scope)).toBe('홈 · Default — NERV');
  });

  it('모르는 경로는 이름을 지어내지 않는다', () => {
    expect(screenKeyFor('/o/acme')).toBeNull();
    expect(documentTitle(t, '/o/acme', { orgName: null, projectName: null })).toBe('NERV');
  });
});
