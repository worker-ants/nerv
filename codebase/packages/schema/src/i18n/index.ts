// i18n 공개 표면 — 정본: docs/04-mvp/codebase.md §3.4
//
// 웹·API·CLI 가 **같은 카탈로그**를 쓴다. 세 표면이 각자 문구를 들고 있으면 같은 사건이
// 표면마다 다르게 불리고(에러 봉투의 message 와 화면의 토스트가 다른 말을 한다), 번역도
// 세 번 해야 한다.

import { en } from './en.js';
import { ko } from './ko.js';
import { DEFAULT_LOCALE } from './locale.js';
import { makeTranslator } from './translator.js';
import type { Locale } from './locale.js';
import type { ArgsFor, PlaceholderValues, Translate } from './translator.js';

export type { MessageKey } from './ko.js';
export type { Locale } from './locale.js';
export type { Catalog, PlaceholderValues, Placeholders } from './translator.js';
export { DEFAULT_LOCALE, LOCALES, isLocale, negotiateLocale } from './locale.js';
export { interpolate } from './translator.js';
export { ko } from './ko.js';
export { blockedReasonLabelKey, eventLabelKey, statusLabelKey } from './domain.js';
export type {
  BlockedReasonLabelKey,
  EventLabelKey,
  LabeledEntity,
  StatusLabelKey,
} from './domain.js';
export { en } from './en.js';

import type { MessageKey } from './ko.js';

export const CATALOGS: Record<Locale, Record<string, string>> = { ko, en };

export type Translator = Translate<typeof ko>;

/** 로케일 하나에 묶인 번역기. 표면마다 한 번 만들어 들고 다닌다 */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  return makeTranslator<typeof ko>(CATALOGS, locale);
}

/**
 * **아직 번역하지 않은 문구**. 로케일을 모르는 자리(도메인 서비스가 에러를 던지는 순간)에서
 * 키와 값만 들고 있다가, 로케일을 아는 표면(HTTP 필터·화면)이 마지막에 문장으로 만든다.
 *
 * 이게 없으면 서비스가 `Accept-Language` 를 알아야 하고, 그러면 판정과 표현이 한 곳에
 * 섞인다(D-05 가 금지하는 것이 정확히 그것이다).
 */
export interface Message {
  readonly key: MessageKey;
  readonly values?: PlaceholderValues;
}

export function msg<K extends MessageKey>(key: K, ...args: ArgsFor<(typeof ko)[K]>): Message {
  const values = args[0];
  return values === undefined ? { key } : { key, values };
}

/**
 * **카탈로그의 문구를 지금 문자열로 만든다**(기본 로케일).
 *
 * `msg()` 는 로케일을 모르는 기술자를 내고 표면이 렌더한다 — 에러 봉투가 그 경로다.
 * 그런데 응답 **본문에 박히는** 문구(예: `skipped_reason`·md 미러 본문)는 값 자체가
 * 문자열이라 기술자를 실을 수 없다. 그 자리를 위한 짝이다.
 *
 * 요청 로케일을 따르지 않는 것은 의도다: REQ-CB-024 가 로케일을 요구하는 범위는
 * **봉투의 `message` 와 MCP 도구 설명**이고, 본문 필드는 그 밖이다. 여기서 지키는 것은
 * REQ-CB-022 — 문구가 코드가 아니라 카탈로그 한 곳에 있다는 것이다.
 */
export function text<K extends MessageKey>(key: K, ...args: ArgsFor<(typeof ko)[K]>): string {
  return renderMessage(msg(key, ...args));
}

/** 로케일을 정한 뒤 문장으로 만든다 */
export function renderMessage(message: Message, locale: Locale = DEFAULT_LOCALE): string {
  const catalog = CATALOGS[locale];
  const template = catalog[message.key] ?? ko[message.key] ?? message.key;
  return template === message.key ? message.key : interpolateValues(template, message.values);
}

function interpolateValues(template: string, values: PlaceholderValues | undefined): string {
  return values === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const value = values[name];
        return value === undefined ? whole : String(value);
      });
}
