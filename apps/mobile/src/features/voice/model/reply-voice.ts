import {
  isSpeechLanguage,
  SPEECH_LIMITS,
  SPEECH_VOICES,
  type SpeechLanguage,
  type SpeechVoice,
} from "@openbot/contracts/ipc";
import { speechLanguageOf } from "@openbot/contracts/speech-language";
import { SUPERTONIC_DENOISING_STEPS } from "@openbot/contracts/speech-models";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { liveSpeechParts } from "@/features/chat/model/live-conversation";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import { phoneLanguages } from "@/shared/lib/phone-languages";
import { ELEVENLABS_SAMPLE_RATE, ElevenLabsError, elevenLabsSpeech } from "./elevenlabs";
import { speechNative } from "./speech-native";
import { supertonicModel, useSupertonicModel } from "./supertonic-model";
import { type ElevenLabsVoice, readElevenLabsKey, useVoiceSettings } from "./voice-settings";

/** Supertonic 3 synthesizes faster with more threads, and a phone has four or more cores. */
const SUPERTONIC_THREADS = 4;

/** Why a reply was not read to its end. */
export type ReplyVoiceFailure = "not-ready" | "language" | "speech" | "invalid-key" | "permission" | "network";

/** What a surface says when a reply or a sample is not read to its end. */
export const REPLY_VOICE_FAILURE_TEXT = {
  "not-ready": "mobile.chat.liveVoice.voiceNotReady",
  language: "mobile.chat.liveVoice.languageUnsupported",
  speech: "mobile.chat.liveVoice.speakFailed",
  "invalid-key": "mobile.chat.liveVoice.elevenLabsKeyInvalid",
  permission: "mobile.chat.liveVoice.elevenLabsPermission",
  network: "mobile.chat.liveVoice.networkNeeded",
} as const satisfies Record<ReplyVoiceFailure, MobileTextKey>;

/** A voice to read with in place of the one in the settings, such as a voice the user previews. */
export type ReplyVoiceChoice =
  | { engine: "supertonic"; supertonicVoice: SpeechVoice }
  | { engine: "elevenlabs"; elevenLabsVoice: ElevenLabsVoice };

export interface ReplyReading {
  stop: () => void;
  /**
   * Gives a reading from `streamReply` the reply so far. The text only grows. Each sentence plays
   * once a sentence after it is written; `complete` plays the rest, and the reading ends after it.
   */
  update: (markdown: string, complete: boolean) => void;
}

type ReplyHandlers = {
  onPart: (text: string) => void;
  onDone: () => void;
  onError: (failure: ReplyVoiceFailure) => void;
};

/** The chosen voice can read now: Supertonic 3 is downloaded, or ElevenLabs has a key and a voice. */
export function replyVoiceReady(engine = useVoiceSettings.getState().engine): boolean {
  if (!speechNative) return false;
  const settings = useVoiceSettings.getState();
  if (engine === "elevenlabs") return settings.hasElevenLabsKey && settings.elevenLabsVoice !== null;
  return useSupertonicModel.getState().phase === "ready";
}

/** The language a reply falls back to when its words do not show one: the dictation language, else the phone's. */
function fallbackLanguage(): SpeechLanguage {
  const chosen = useDictationLanguage.getState().value;
  const candidates = chosen === AUTOMATIC_DICTATION_LANGUAGE ? phoneLanguages() : [chosen];
  for (const locale of candidates) {
    const language = locale.split(/[-_]/)[0]?.toLowerCase();
    if (isSpeechLanguage(language)) return language;
  }
  return "en";
}

type Listener = { start: (id: string) => void; done: (id: string) => void; error: (id: string) => void };
const listeners = new Set<Listener>();
if (speechNative) {
  speechNative.addListener("onSpeechStart", ({ id }) => {
    for (const listener of listeners) listener.start(id);
  });
  speechNative.addListener("onSpeechDone", ({ id }) => {
    for (const listener of listeners) listener.done(id);
  });
  speechNative.addListener("onSpeechError", ({ id }) => {
    for (const listener of listeners) listener.error(id);
  });
}

function elevenLabsFailure(code: ElevenLabsError["code"]): ReplyVoiceFailure {
  if (code === "invalid-key" || code === "network") return code;
  return code === "failed" ? "speech" : "permission";
}

let nextReading = 0;

/** Reads a whole Markdown reply aloud, as `streamReply` does with a reply that is complete. */
export function readReply(markdown: string, handlers: ReplyHandlers, choice?: ReplyVoiceChoice): ReplyReading {
  const reading = streamReply(handlers, choice);
  reading.update(markdown, true);
  return reading;
}

/**
 * Reads a Markdown reply aloud with the voice in the settings while it is written, one part at a
 * time: code, tables and addresses are not read, as on desktop. The first sentence plays as soon as
 * the next one starts, so the voice follows the text instead of waiting for the whole reply.
 * `onPart` gets the part that starts to play. One reading plays at a time; a new one stops the one
 * before it.
 */
export function streamReply(handlers: ReplyHandlers, choice?: ReplyVoiceChoice): ReplyReading {
  const native = speechNative;
  const reading = ++nextReading;
  const abort = new AbortController();
  let ended = false;
  let started = false;
  let complete = false;
  let markdownSoFar = "";
  /** The parts that are fixed: the text after them is written. */
  const parts: string[] = [];
  let lastDone = -1;
  let wake: (() => void) | null = null;
  const idOf = (index: number) => `${reading}:${index}`;
  const indexOf = (id: string) => {
    const [owner, index] = id.split(":");
    return owner === String(reading) ? Number(index) : -1;
  };
  const end = (failure?: ReplyVoiceFailure) => {
    if (ended) return;
    ended = true;
    listeners.delete(listener);
    abort.abort();
    wake?.();
    if (failure) {
      native?.stop();
      handlers.onError(failure);
    } else handlers.onDone();
  };
  const listener: Listener = {
    start: (id) => {
      const index = indexOf(id);
      if (index >= 0 && !ended) handlers.onPart(parts[index] ?? "");
    },
    done: (id) => {
      const index = indexOf(id);
      if (index < 0) return;
      lastDone = index;
      if (complete && index === parts.length - 1) end();
    },
    error: (id) => {
      if (indexOf(id) >= 0) end("speech");
    },
  };
  const stop = () => {
    if (ended) return;
    ended = true;
    listeners.delete(listener);
    abort.abort();
    wake?.();
    native?.stop();
  };
  const settings = useVoiceSettings.getState();
  const engine = choice?.engine ?? settings.engine;
  const elevenLabsVoice = choice?.engine === "elevenlabs" ? choice.elevenLabsVoice : settings.elevenLabsVoice;
  const supertonicVoice = choice?.engine === "supertonic" ? choice.supertonicVoice : settings.supertonicVoice;
  const ready =
    engine === "elevenlabs" ? settings.hasElevenLabsKey && elevenLabsVoice !== null : replyVoiceReady("supertonic");
  if (!native || !ready) {
    queueMicrotask(() => end("not-ready"));
    return { stop, update: () => undefined };
  }
  native.stop();
  listeners.add(listener);

  /** The next part to play; null when the reply is complete and every part is out. */
  async function nextPart(index: number): Promise<string | null> {
    while (!ended && index >= parts.length) {
      if (complete) return null;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    return ended ? null : (parts[index] ?? null);
  }

  /** ElevenLabs: each part plays while the next one is fetched. */
  async function playElevenLabs(): Promise<void> {
    const key = await readElevenLabsKey();
    const voice = elevenLabsVoice;
    if (!key || !voice) return end("not-ready");
    for (let index = 0; ; index++) {
      const part = await nextPart(index);
      if (part === null) return;
      const pcm = await elevenLabsSpeech(key, voice.id, part, abort.signal);
      if (ended) return;
      native?.playPcm(idOf(index), pcm, ELEVENLABS_SAMPLE_RATE);
    }
  }

  /** Supertonic 3: the next part is synthesized while one plays. */
  async function playSupertonic(): Promise<void> {
    const directory = supertonicModel.uri();
    if (!directory) return end("not-ready");
    await native?.load(directory, SUPERTONIC_THREADS);
    const speaker = SPEECH_VOICES.indexOf(supertonicVoice);
    let language: SpeechLanguage | null = null;
    for (let index = 0; ; index++) {
      const part = await nextPart(index);
      if (part === null) return;
      // Each part takes its own language, with the part before as the fallback, because the reply
      // plays before it is complete. A short first part, such as "Sure.", is judged with all the text
      // written so far. Supertonic 3 reads 31 languages; a part in another script, such as Chinese,
      // ends the reading. A Japanese part written only in kanji, such as "以上。", stays Japanese.
      const text = index === 0 ? speechTextFromMarkdown(markdownSoFar) : part;
      const detected = speechLanguageOf(text, language ?? fallbackLanguage());
      language = detected ?? (language === "ja" ? "ja" : null);
      if (!language) return end("language");
      native?.speak(idOf(index), part, language, speaker, SUPERTONIC_DENOISING_STEPS);
    }
  }

  async function play(): Promise<void> {
    try {
      await (engine === "elevenlabs" ? playElevenLabs() : playSupertonic());
    } catch (error) {
      if (ended) return;
      end(error instanceof ElevenLabsError ? elevenLabsFailure(error.code) : "speech");
    }
  }

  const update = (markdown: string, isComplete: boolean) => {
    if (ended || complete) return;
    markdownSoFar = markdown;
    const all = liveSpeechParts(markdown, SPEECH_LIMITS.maximumTextLength);
    // The last part can still grow, so it waits until more text follows it or the reply is complete.
    const fixed = isComplete ? all : all.slice(0, -1);
    if (fixed.length > parts.length) parts.push(...fixed.slice(parts.length));
    complete = isComplete;
    if (complete && lastDone === parts.length - 1) {
      // Nothing is left to play, such as a reply with only code, or one whose parts all played.
      queueMicrotask(() => end());
      return;
    }
    if (!started && parts.length > 0) {
      started = true;
      void play();
    }
    wake?.();
  };
  return { stop, update };
}
