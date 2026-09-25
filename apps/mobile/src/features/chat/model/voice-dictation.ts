import type { ExpoSpeechRecognitionErrorCode } from "expo-speech-recognition";
import { localeName } from "./language-names";

/** `starting` covers the permission prompt; `stopping` waits for the final result. */
export type DictationPhase = "idle" | "starting" | "listening" | "stopping";

export interface DictationTranscript {
  /** Final segments. Android continuous mode ends a segment at each pause. */
  committed: string[];
  /** The newest partial result, replaced by each result until it is final. */
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

export function spokenText(transcript: DictationTranscript): string {
  return [...transcript.committed, transcript.interim].filter(Boolean).join(" ");
}

/** The draft the user sees: what was there before the mic, then the speech. */
export function dictationDraft(base: string, spoken: string): string {
  if (!spoken) return base;
  if (!base.trim()) return spoken;
  return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`;
}

const normalizeLocale = (locale: string) => locale.replace(/_/g, "-").toLowerCase();

/** Language and region, without a script: "zh-Hant-HK" becomes "zh-hk". */
function localeKey(locale: string): { language: string; region: string | null } {
  const [language = "", ...rest] = normalizeLocale(locale).split("-");
  const region = rest.find((part) => /^([a-z]{2}|\d{3})$/.test(part)) ?? null;
  return { language, region };
}

/**
 * The recognizer takes a locale it lists, and iOS rejects any other. Walk the
 * user's languages in order, and take the first one the recognizer supports:
 * the same region if listed, else the language's home region (pl-PL, de-DE),
 * else US English for English, else the first listed. A Polish speaker with
 * Polish second in the list still gets Polish when the first is not supported.
 */
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
  // No list, as on Android 12: the recognizer takes the first language as given.
  return preferred[0] ?? "en-US";
}

/** A locale by name, such as "Polish (Poland)", so a speaker can find it. */
function recognitionLocaleLabel(locale: string): string {
  return localeName(locale) ?? locale;
}

/**
 * The choices for the dictation language setting, by name. A stored locale the
 * recognizer no longer lists stays visible, so the picker shows what is set.
 */
export function dictationLanguageOptions(
  supported: readonly string[],
  /** Null for the automatic choice. */
  selected: string | null,
): { value: string; label: string }[] {
  const locales = new Map<string, string>();
  for (const locale of [...supported, ...(selected ? [selected] : [])]) {
    if (!locales.has(normalizeLocale(locale))) locales.set(normalizeLocale(locale), locale);
  }
  return [...locales.values()]
    .map((value) => ({ value, label: recognitionLocaleLabel(value) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function hasRecognitionLocale(locale: string, locales: readonly string[]): boolean {
  return locales.some((value) => normalizeLocale(value) === normalizeLocale(locale));
}

export interface DictationNotice {
  title: string;
  message: string;
  /** The user can only change this permission in the device settings. */
  openSettings?: boolean;
}

export const microphoneOffNotice: DictationNotice = {
  title: "Microphone access is off",
  message: "To dictate a message, allow OpenBot to use the microphone and speech recognition in Settings.",
  openSettings: true,
};

export const dictationFailedNotice: DictationNotice = { title: "Dictation stopped", message: "Try again." };

/** Null when the stop needs no message: the user stopped it, or said nothing. */
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
      return { title: "Dictation is not available", message: "Speech recognition does not support your language." };
    case "service-not-allowed":
      return {
        title: "Dictation is not available",
        message: "Speech recognition is off or not available on this device.",
      };
    case "network":
      return { title: "Dictation stopped", message: "Speech recognition needs a network connection. Try again." };
    case "busy":
      return { title: "Dictation stopped", message: "Another app is using speech recognition. Try again." };
    // iOS also reports recognizer failures, such as a damaged language model,
    // as audio-capture, so do not blame the microphone.
    case "audio-capture":
      return { title: "Dictation stopped", message: "Speech recognition failed. Try again." };
    default:
      return dictationFailedNotice;
  }
}

/**
 * An on-device recognizer can fail before it hears anything, for example with a
 * damaged or missing language model. The system service can still work, so
 * those failures try once more without on-device recognition. Other errors,
 * such as an unsupported language or no network, would fail the same way again.
 * iOS can still choose an installed model when on-device is not required, so
 * this helps mainly on Android.
 */
export function retriesWithSystemService(code: ExpoSpeechRecognitionErrorCode): boolean {
  return ["audio-capture", "service-not-allowed", "client", "unknown"].includes(code);
}

export interface ComposerControlsInput {
  disabled: boolean;
  /** Text or attachments. Live dictation counts, because it is already in the draft. */
  hasDraft: boolean;
  /** A send or an attachment preparation is in progress. */
  busy: boolean;
  /** A turn is running and this surface can stop it. */
  canStop: boolean;
  stopping: boolean;
  voiceAvailable: boolean;
  dictation: DictationPhase;
}

/** The one control at the end of the composer, and what it does now. */
export interface ComposerAction {
  mode: "send" | "stop" | "dictate" | "finish-dictation";
  pressable: boolean;
  spinner: boolean;
  /** Filled with the action colour. */
  primed: boolean;
}

export function composerAction(input: ComposerControlsInput): ComposerAction {
  // Dictation holds the control until it ends, so the user can always stop it.
  // The text then stays in the draft and the control becomes send.
  if (input.dictation !== "idle") {
    return {
      mode: "finish-dictation",
      pressable: input.dictation === "listening",
      spinner: input.dictation === "starting" || input.dictation === "stopping",
      primed: true,
    };
  }
  const empty = !input.hasDraft && !input.busy;
  // A draft still sends while the agent works: the host queues it. So stop only
  // takes the control when there is nothing to send. It wins over the mic: a
  // running turn must stay easy to stop.
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
