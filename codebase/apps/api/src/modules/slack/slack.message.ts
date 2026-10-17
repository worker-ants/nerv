// Slack 에 게시할 글 — 딥링크와 받는 사람 이름뿐이다 (2026-10-17 · 사람 결정 D1 · spec-workflow §6.4 · REQ-API-354)
//
// **본문을 넣지 않는다.** 결재할 스펙의 내용 · 질문의 문장 · 발견의 제목은 Slack 으로 나가지 않는다 — 그 채널에 누가
// 있는지 NERV 는 모른다. 글은 프로젝트 이름 · 무슨 일인지(이벤트 이름) · 누구를 부르는지 · 어디서 처리하는지(링크)다.
import {
  NERV_EVENT_PHASE2,
  eventLabelKey,
  isMessageKey,
  renderMessage,
  msg,
  text,
} from '@nerv/schema';
import { SLACK_WEBHOOK_PREFIX } from '@nerv/schema';

/** 웹훅 주소가 시작해야 하는 곳 — env 가 바꾼다(사내 중계 · 시험용 가짜 서버) */
export function slackWebhookPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['NERV_SLACK_WEBHOOK_PREFIX']?.trim() ?? '';
  return raw === '' ? SLACK_WEBHOOK_PREFIX : raw;
}

export interface SlackEventRef {
  type: string;
  subject_id: string;
}

export interface SlackProjectRef {
  name: string;
  slug: string;
  orgSlug: string;
}

/**
 * 그 일을 처리하는 자리 — 결재 · 질문은 받은 요청의 그 카드, 발견은 리뷰 센터, 변경 요청은 그 상세. 모르는 종류는
 * 프로젝트 개요로 보낸다(막다른 길을 만들지 않는다 · screens §1.5). 화면의 `eventTarget` 과 같은 갈래다.
 */
export function slackLink(web: string, event: SlackEventRef, project: SlackProjectRef): string {
  const base = web.replace(/\/+$/, '');
  const slug = encodeURIComponent(project.slug);
  if (event.type.startsWith('approval.') || event.type.startsWith('question.')) {
    const query = new URLSearchParams({
      org: project.orgSlug,
      project: project.slug,
      focus: event.subject_id,
    });
    return `${base}/inbox?${query.toString()}`;
  }
  if (event.type === NERV_EVENT_PHASE2.FINDING_OPENED) {
    return `${base}/p/${slug}/reviews?${new URLSearchParams({ finding: event.subject_id }).toString()}`;
  }
  if (event.type.startsWith('cr.'))
    return `${base}/p/${slug}/crs/${encodeURIComponent(event.subject_id)}`;
  return `${base}/p/${slug}`;
}

/** Slack mrkdwn 의 제어 문자를 막는다 — 이름에 `<` · `>` · `&` 가 있으면 링크 문법으로 읽힌다 */
export function slackEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function slackBody(input: {
  event: SlackEventRef;
  project: SlackProjectRef;
  names: readonly string[];
  link: string;
}): string {
  const key = eventLabelKey(input.event.type);
  const label = isMessageKey(key) ? renderMessage(msg(key)) : input.event.type;
  return text('slack.message', {
    project: slackEscape(input.project.name),
    event: slackEscape(label),
    names: input.names.map(slackEscape).join(' · '),
    link: input.link,
  });
}
