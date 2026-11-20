import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { ExpoSpeechRecognitionErrorCode } from "expo-speech-recognition";
import { localeName } from "./language-names";

export type DictationPhase = "idle" | "starting" | "listening" | "stopping";

export interface DictationTranscript {
  committed: string[];
  interim: string;
}

export const emptyDictationTranscript: DictationTranscript = { committed: [], interim: "" };

export function applyDictationResult(
  transcript: DictationTranscript,
  result: { isFinal: boolean; text: string },
): DictationTranscript {
  const text = result.text.trim();
  if (!result.isFinal) return { ...transcript, interim: text };
  return { committed: text ? [...transcript.committed, text] : transcript.committed, interim: "" };
}

export function isRepeatedFinal(transcript: DictationTranscript, result: { isFinal: boolean; text: string }): boolean {
  const text = result.text.trim();
  if (!result.isFinal || !text || transcript.interim || transcript.committed.length === 0) return false;
  return text === transcript.committed.at(-1) || text === joinSegments(transcript.committed);
}

const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\u3000-\u303f\uff01-\uff60]/u;

export function joinSegments(segments: readonly string[]): string {
  let text = "";
  for (const segment of segments) {
    const next = segment.trim();
    if (!next) continue;
    const joint = text && !(NO_SPACE_SCRIPT.test(text.at(-1) ?? "") && NO_SPACE_SCRIPT.test(next[0] ?? ""));
    text = joint ? `${text} ${next}` : `${text}${next}`;
  }
  return text;
}

export function spokenText(transcript: DictationTranscript): string {
  return joinSegments([...transcript.committed, transcript.interim]);
}

export function dictationDraft(base: string, spoken: string): string {
  if (!spoken) return base;
  if (!base.trim()) return spoken;
  return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`;
}

const normalizeLocale = (locale: string) => locale.replace(/_/g, "-").toLowerCase();

function localeKey(locale: string): { language: string; region: string | null } {
  const [language = "", ...rest] = normalizeLocale(locale).split("-");
  const region = rest.find((part) => /^([a-z]{2}|\d{3})$/.test(part)) ?? null;
  return { language, region };
}

export function pickRecognitionLocale(preferred: readonly string[], supported: readonly string[]): string {
  const listed = supported.map((locale) => ({ locale, ...localeKey(locale) }));
  for (const wanted of preferred.map(localeKey)) {
    const sameLanguage = listed.filter((entry) => entry.language === wanted.language);
    const match =
      sameLanguage.find((entry) => wanted.region !== null && entry.region === wanted.region) ??
      sameLanguage.find((entry) => entry.region === wanted.language) ??
      sameLanguage.find((entry) => entry.language === "en" && entry.region === "us") ??
      sameLanguage[0];
    if (match) return match.locale;
  }
  return preferred[0] ?? "en-US";
}

function recognitionLocaleLabel(locale: string, t: MobileTranslate): string {
  return localeName(locale, t) ?? locale;
}

export function dictationLanguageOptions(
  supported: readonly string[],
  selected: string | null,
  t: MobileTranslate,
): { value: string; label: string }[] {
  const locales = new Map<string, string>();
  for (const locale of [...supported, ...(selected ? [selected] : [])]) {
    if (!locales.has(normalizeLocale(locale))) locales.set(normalizeLocale(locale), locale);
  }
  return [...locales.values()]
    .map((value) => ({ value, label: recognitionLocaleLabel(value, t) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function hasRecognitionLocale(locale: string, locales: readonly string[]): boolean {
  return locales.some((value) => normalizeLocale(value) === normalizeLocale(locale));
}

export interface DictationNotice {
  title: MobileTextKey;
  message: MobileTextKey;
  openSettings?: boolean;
}

export const microphoneOffNotice: DictationNotice = {
  title: "mobile.chat.dictation.microphoneOffTitle",
  message: "mobile.chat.dictation.microphoneOffMessage",
  openSettings: true,
};

export const dictationFailedNotice: DictationNotice = {
  title: "mobile.chat.dictation.stopped",
  message: "mobile.chat.dictation.tryAgain",
};

export function dictationNotice(code: ExpoSpeechRecognitionErrorCode): DictationNotice | null {
  switch (code) {
    case "aborted":
    case "interrupted":
    case "no-speech":
    case "speech-timeout":
      return null;
    case "not-allowed":
      return microphoneOffNotice;
    case "language-not-supported":
      return { title: "mobile.chat.dictation.unavailable", message: "mobile.chat.dictation.languageUnsupported" };
    case "service-not-allowed":
      return { title: "mobile.chat.dictation.unavailable", message: "mobile.chat.dictation.serviceUnavailable" };
    case "network":
      return { title: "mobile.chat.dictation.stopped", message: "mobile.chat.dictation.networkNeeded" };
    case "busy":
      return { title: "mobile.chat.dictation.stopped", message: "mobile.chat.dictation.busy" };
    case "audio-capture":
      return { title: "mobile.chat.dictation.stopped", message: "mobile.chat.dictation.failed" };
    default:
      return dictationFailedNotice;
  }
}

export function retriesWithSystemService(code: ExpoSpeechRecognitionErrorCode): boolean {
  return ["audio-capture", "service-not-allowed", "client", "unknown"].includes(code);
}

export interface ComposerControlsInput {
  disabled: boolean;
  hasDraft: boolean;
  busy: boolean;
  canStop: boolean;
  stopping: boolean;
  voiceAvailable: boolean;
}

export interface ComposerAction {
  mode: "send" | "stop" | "dictate";
  pressable: boolean;
  spinner: boolean;
  primed: boolean;
}

export function composerAction(input: ComposerControlsInput): ComposerAction {
  const empty = !input.hasDraft && !input.busy;
  if (empty && input.canStop) {
    return { mode: "stop", pressable: !input.disabled && !input.stopping, spinner: input.stopping, primed: true };
  }
  if (empty && input.voiceAvailable) {
    return { mode: "dictate", pressable: !input.disabled, spinner: false, primed: false };
  }
  return {
    mode: "send",
    pressable: !input.disabled && !input.busy && input.hasDraft,
    spinner: input.busy,
    primed: input.hasDraft || input.busy,
  };
}
