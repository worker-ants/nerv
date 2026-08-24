// 리뷰 SUMMARY 파서 — importer.md §2.7
//
// **픽스처는 원본 표기 그대로다.** 열 이름이 kind 마다 다르다는 것이 이 파서의 존재
// 이유라서, 표기를 다듬어 넣으면 정작 검사해야 할 것이 사라진다.

import { describe, expect, it } from 'vitest';
import { branchFromRetryState, parseLocation, parseReviewSummary } from './review.js';

const CODE_SUMMARY = `# Code Review 통합 보고서

## 전체 위험도
**MEDIUM** — 신규 결함 2건.

## Critical 발견사항

_없음_

## 경고 (WARNING)

| # | 카테고리 | 발견사항 | 위치 | 제안 |
|---|----------|----------|------|------|
| 1 | Architecture | 인터페이스 부재 — \`AiMemoryManager\` 를 구체 타입 직접 참조 | \`ai-agent.handler.ts\` 라인 139-143 | 인터페이스 추출 |
| 2 | Documentation | [SPEC-DRIFT] 신규 파일이 frontmatter \`code:\` 에 미등재 | \`spec/4-nodes/3-ai/1-ai-agent.md\` | spec 갱신 |

## 참고 (INFO)

| # | 카테고리 | 발견사항 | 위치 | 제안 |
|---|----------|----------|------|------|
| 1 | Testing | 폴백 경로 미테스트 | \`ai-memory-manager.ts:75\` | 케이스 추가 |

## 에이전트별 위험도 요약

| 에이전트 | 위험도 | 핵심 발견 |
|----------|--------|-----------|
| security | LOW | 캐스팅 검증 부재 |
| requirement | NONE | spec fidelity 일치 |
| testing | HIGH | 전용 테스트 없음 |
`;

// consistency 는 열 이름이 다르다 — `Checker`·`위배`·`target 위치`·`충돌 대상`
const CONSISTENCY_SUMMARY = `# Consistency Check 통합 보고서

**BLOCK: YES** — Critical 1건

## 전체 위험도
**HIGH** — 구조적 위반.

## Critical 위배 (BLOCK 사유)

| # | Checker | 위배 | target 위치 | 충돌 대상 | 제안 |
|---|---------|------|-------------|-----------|------|
| 1 | Naming Collision | \`TERMINAL_STATUSES\` 상수 이중 정의 | \`execution-engine.service.ts\` L700 | \`interaction.service.ts\` L30 | 공유 상수로 통합 |

## 참고 (INFO)

| # | Checker | 항목 | 위치 | 제안 |
|---|---------|------|------|------|
| 1 | Cross-Spec | note 문구가 완료 사실과 충돌 | \`spec/data-flow/9-observability.md\` L202 | 문구 제거 |
`;

describe('code 리뷰 SUMMARY', () => {
  const parsed = parseReviewSummary(CODE_SUMMARY);

  it('전체 위험도와 발견을 절 이름으로 가른다', () => {
    expect(parsed.risk).toBe('medium');
    expect(parsed.block).toBe(false);
    expect(parsed.findings.map((f) => f.severity)).toEqual(['warning', 'warning', 'info']);
  });

  it('"없음" 절은 발견이 아니다 — 표가 없으면 셀 것도 없다', () => {
    expect(parsed.findings.filter((f) => f.severity === 'critical')).toHaveLength(0);
  });

  it('제목은 앞 절이다 — 근거까지 넣으면 목록이 문단이 된다', () => {
    expect(parsed.findings[0]?.title).toBe('인터페이스 부재');
    // 본문은 통째로 남으므로 잘라도 잃는 것이 없다
    expect(parsed.findings[0]?.detail_md).toContain('구체 타입 직접 참조');
  });

  it('[SPEC-DRIFT] 는 카테고리가 아니라 꼬리표다 — 필터의 축이 된다', () => {
    expect(parsed.findings[1]?.tags).toEqual(['spec_drift']);
    expect(parsed.findings[1]?.title).not.toContain('SPEC-DRIFT');
  });

  it('카테고리는 소문자 한 낱말로 — 표기가 갈리면 필터가 갈린다', () => {
    expect(parsed.findings.map((f) => f.category)).toEqual([
      'architecture',
      'documentation',
      'testing',
    ]);
  });

  it('역할별 위험도 표를 리포트로 읽는다 — NONE 은 low 다', () => {
    expect(parsed.reports).toEqual([
      { role: 'security', risk: 'low', body_md: '캐스팅 검증 부재' },
      { role: 'requirement', risk: 'low', body_md: 'spec fidelity 일치' },
      { role: 'testing', risk: 'high', body_md: '전용 테스트 없음' },
    ]);
  });
});

describe('consistency 리뷰 SUMMARY — 열 이름이 다르다', () => {
  const parsed = parseReviewSummary(CONSISTENCY_SUMMARY);

  it('BLOCK: YES 를 읽는다 — 게이트가 계승하는 값이다', () => {
    expect(parsed.block).toBe(true);
    expect(parsed.risk).toBe('high');
  });

  it('Checker·위배·target 위치를 같은 뜻으로 읽는다', () => {
    expect(parsed.findings[0]).toMatchObject({
      severity: 'critical',
      category: 'naming_collision',
      file: 'execution-engine.service.ts',
      line: 700,
    });
  });

  it('충돌 대상은 본문에 남긴다 — 열이 사라지면 판단 근거가 사라진다', () => {
    expect(parsed.findings[0]?.detail_md).toContain('충돌 대상');
    expect(parsed.findings[0]?.detail_md).toContain('interaction.service.ts');
  });

  it('INFO 절의 다른 열 이름(항목)도 같은 뜻이다', () => {
    expect(parsed.findings[1]?.severity).toBe('info');
    expect(parsed.findings[1]?.title).toContain('note 문구가');
  });
});

describe('위치 표기 — 제각각인 것을 관대하게 읽는다', () => {
  it.each([
    ['`ai-agent.handler.ts` 라인 139-143', 'ai-agent.handler.ts', 139],
    ['`execution-engine.service.ts` L700', 'execution-engine.service.ts', 700],
    ['`ai-memory-manager.ts:99-350`', 'ai-memory-manager.ts', 99],
    ['`spec/data-flow/9-observability.md` §4', 'spec/data-flow/9-observability.md', null],
  ])('%s', (raw, file, line) => {
    expect(parseLocation(raw)).toEqual({ file, line });
  });

  it('경로가 없으면 둘 다 없다 — 반쯤 맞는 위치는 틀린 위치보다 나쁘다', () => {
    expect(parseLocation('설계 전반')).toEqual({ file: null, line: null });
  });
});

describe('브랜치 되찾기 — worktree 경로가 이름을 갖고 있다', () => {
  it('worktree 이름이 곧 브랜치다', () => {
    const json = JSON.stringify({
      session_dir:
        '/x/.claude/worktrees/backend-typecheck-gap-3d7a91/review/code/2026/08/09/17_43_32',
    });
    expect(branchFromRetryState(json, 'main')).toBe('backend-typecheck-gap-3d7a91');
  });

  it('worktree 가 아니면 본류에서 돈 것이다', () => {
    expect(branchFromRetryState(JSON.stringify({ session_dir: '/x/review/code/1' }), 'main')).toBe(
      'main',
    );
  });

  it('깨진 json 은 결함이 아니라 정보 없음이다', () => {
    expect(branchFromRetryState('{ not json', 'main')).toBe('main');
  });
});

describe('코드 스팬 안의 파이프 — 열이 밀리면 다른 칸을 제목으로 읽는다', () => {
  // 원본 표기 그대로다(clemvion 실측). markdown 규약대로면 이스케이프해야 하지만
  // 원본은 그냥 쓰고, 그대로 쪼개면 백틱 한 글자가 제목이 되어 적재가 멈춘다.
  const md = `## 경고 (WARNING)

| # | 카테고리 | 발견사항 | 위치 | 제안 |
|---|----------|----------|------|------|
| 1 | 아키텍처 | 타입 단언(\`as string | undefined\`) 다수 사용 — 괴리 | \`ai-agent.handler.ts\` | Zod parse |
| 2 | 보안 | \`||\` 폴백 체인 빈 문자열 처리는 의도된 설계 | \`processor.ts\` | 현 주석 유지 |
`;
  const parsed = parseReviewSummary(md);

  it('코드 스팬 안의 | 는 셀 구분이 아니다', () => {
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]?.title).toBe('타입 단언(as string | undefined) 다수 사용');
    expect(parsed.findings[0]?.file).toBe('ai-agent.handler.ts');
    expect(parsed.findings[1]?.file).toBe('processor.ts');
  });

  it('제목은 비지 않는다 — 빈 제목은 계약 위반이라 배치 전체를 멈춘다', () => {
    for (const f of parsed.findings) expect(f.title.length).toBeGreaterThan(0);
  });
});

describe('산문 SUMMARY — 원본 271/1,984 건', () => {
  it('표가 없으면 tableless 로 표시한다 — 조용히 0건으로 넘기지 않는다', () => {
    const parsed = parseReviewSummary('# 코드 리뷰 SUMMARY — 7차\n\n산문으로 적힌 판정.\n');
    expect(parsed.tableless).toBe(true);
    expect(parsed.findings).toHaveLength(0);
  });
});
