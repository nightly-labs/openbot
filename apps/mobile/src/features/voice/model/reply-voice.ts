import {
  isSpeechLanguage,
  SPEECH_LIMITS,
  SPEECH_VOICES,
  type SpeechLanguage,
  type SpeechSpeed,
  type SpeechVoice,
} from "@openbot/contracts/ipc";
import { speechLanguageOf } from "@openbot/contracts/speech-language";
import { SUPERTONIC_DENOISING_STEPS } from "@openbot/contracts/speech-models";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { liveSpeechParts } from "@/features/chat/model/live-conversation";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import { phoneLanguages } from "@/shared/lib/phone-languages";
import { currentText } from "@/shared/lib/text";
import { ELEVENLABS_SAMPLE_RATE, ElevenLabsError, elevenLabsSpeech } from "./elevenlabs";
import { speechNative } from "./speech-native";
import { supertonicModel, useSupertonicModel } from "./supertonic-model";
import { useVoiceServer, VoiceServerError, voiceServerSpeech } from "./voice-server";
import { type ElevenLabsVoice, readElevenLabsKey, useVoiceSettings } from "./voice-settings";

const SUPERTONIC_THREADS = 4;

export type ReplyVoiceFailure =
  | "not-ready"
  | "language"
  | "speech"
  | "invalid-key"
  | "permission"
  | "network"
  | "voice-server";

const REPLY_VOICE_FAILURE_TEXT = {
  "not-ready": "mobile.chat.liveVoice.voiceNotReady",
  language: "mobile.chat.liveVoice.languageUnsupported",
  speech: "mobile.chat.liveVoice.speakFailed",
  "invalid-key": "mobile.chat.liveVoice.elevenLabsKeyInvalid",
  permission: "mobile.chat.liveVoice.elevenLabsPermission",
  network: "mobile.chat.liveVoice.networkNeeded",
  "voice-server": "mobile.chat.liveVoice.voiceServerFailed",
} as const satisfies Record<ReplyVoiceFailure, MobileTextKey>;

export function replyVoiceFailureText(failure: ReplyVoiceFailure, reason: string | null): string {
  const { t } = currentText();
  return reason ? t("mobile.settings.voice.elevenLabs.refused", { reason }) : t(REPLY_VOICE_FAILURE_TEXT[failure]);
}

export type ReplyVoiceChoice =
  | { engine: "supertonic"; supertonicVoice: SpeechVoice }
  | { engine: "elevenlabs"; elevenLabsVoice: ElevenLabsVoice }
  | { engine: "voice-server"; voice: string };

export interface ReplyReading {
  stop: () => void;
  update: (markdown: string, complete: boolean, settled?: boolean) => void;
}

type ReplyHandlers = {
  onPart: (text: string) => void;
  onDone: () => void;
  onError: (failure: ReplyVoiceFailure, reason: string | null) => void;
};

export function replyVoiceReady(engine = useVoiceSettings.getState().engine): boolean {
  if (!speechNative) return false;
  const settings = useVoiceSettings.getState();
  if (engine === "elevenlabs") return settings.hasElevenLabsKey && settings.elevenLabsVoice !== null;
  if (engine === "voice-server") return useVoiceServer.getState().server?.routes.speech === true;
  return useSupertonicModel.getState().phase === "ready";
}

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

export const canChangeReplySpeed = speechNative?.setSpeed !== undefined;

let nativeSpeed: SpeechSpeed = 1;
function applySpeed({ speed }: { speed: SpeechSpeed }): void {
  if (speed === nativeSpeed) return;
  nativeSpeed = speed;
  speechNative?.setSpeed?.(speed);
}
applySpeed(useVoiceSettings.getState());
useVoiceSettings.subscribe(applySpeed);

function elevenLabsFailure(code: ElevenLabsError["code"]): ReplyVoiceFailure {
  if (code === "invalid-key" || code === "network") return code;
  return code === "failed" ? "speech" : "permission";
}

let nextReading = 0;
let replaceActive: (() => void) | null = null;

export function readReply(markdown: string, handlers: ReplyHandlers, choice?: ReplyVoiceChoice): ReplyReading {
  const reading = streamReply(handlers, choice);
  reading.update(markdown, true);
  return reading;
}

export function streamReply(handlers: ReplyHandlers, choice?: ReplyVoiceChoice): ReplyReading {
  const native = speechNative;
  const reading = ++nextReading;
  const abort = new AbortController();
  let ended = false;
  let started = false;
  let complete = false;
  let markdownSoFar = "";
  const parts: string[] = [];
  let settledLength = 0;
  let settledParts: string[] = [];
  let lastDone = -1;
  let wake: (() => void) | null = null;
  const idOf = (index: number) => `${reading}:${index}`;
  const indexOf = (id: string) => {
    const [owner, index] = id.split(":");
    return owner === String(reading) ? Number(index) : -1;
  };
  const release = () => {
    if (replaceActive === replace) replaceActive = null;
  };
  const end = (failure?: ReplyVoiceFailure, reason: string | null = null) => {
    if (ended) return;
    ended = true;
    release();
    listeners.delete(listener);
    abort.abort();
    wake?.();
    if (failure) {
      native?.stop();
      handlers.onError(failure, reason);
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
    release();
    listeners.delete(listener);
    abort.abort();
    wake?.();
    native?.stop();
  };
  const replace = () => {
    if (ended) return;
    ended = true;
    replaceActive = null;
    listeners.delete(listener);
    abort.abort();
    wake?.();
    handlers.onDone();
  };
  const settings = useVoiceSettings.getState();
  const engine = choice?.engine ?? settings.engine;
  const elevenLabsVoice = choice?.engine === "elevenlabs" ? choice.elevenLabsVoice : settings.elevenLabsVoice;
  const elevenLabsModel = settings.elevenLabsModel;
  const supertonicVoice = choice?.engine === "supertonic" ? choice.supertonicVoice : settings.supertonicVoice;
  const serverVoice = choice?.engine === "voice-server" ? choice.voice : undefined;
  const ready =
    engine === "elevenlabs"
      ? settings.hasElevenLabsKey && elevenLabsVoice !== null
      : replyVoiceReady(engine === "voice-server" ? "voice-server" : "supertonic");
  if (!native || !ready) {
    queueMicrotask(() => end("not-ready"));
    return { stop, update: () => undefined };
  }
  native.stop();
  replaceActive?.();
  replaceActive = replace;
  listeners.add(listener);

  async function nextPart(index: number): Promise<string | null> {
    while (!ended && index >= parts.length) {
      if (complete) return null;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    return ended ? null : (parts[index] ?? null);
  }

  async function playElevenLabs(): Promise<void> {
    const key = await readElevenLabsKey();
    const voice = elevenLabsVoice;
    if (!key || !voice) return end("not-ready");
    for (let index = 0; ; index++) {
      const part = await nextPart(index);
      if (part === null) return;
      const pcm = await elevenLabsSpeech(key, voice.id, elevenLabsModel, part, abort.signal);
      if (ended) return;
      native?.playPcm(idOf(index), pcm, ELEVENLABS_SAMPLE_RATE);
    }
  }

  async function playVoiceServer(): Promise<void> {
    for (let index = 0; ; index++) {
      const part = await nextPart(index);
      if (part === null) return;
      const audio = await voiceServerSpeech(part, abort.signal, serverVoice);
      if (ended) return;
      native?.playPcm(idOf(index), audio.pcm, audio.sampleRate);
    }
  }

  async function playSupertonic(): Promise<void> {
    const directory = supertonicModel.uri();
    if (!directory) return end("not-ready");
    await native?.load(directory, SUPERTONIC_THREADS);
    const speaker = SPEECH_VOICES.indexOf(supertonicVoice);
    let language: SpeechLanguage | null = null;
    for (let index = 0; ; index++) {
      const part = await nextPart(index);
      if (part === null) return;
      const text = index === 0 ? speechTextFromMarkdown(markdownSoFar) : part;
      const detected = speechLanguageOf(text, language ?? fallbackLanguage());
      language = detected ?? (language === "ja" ? "ja" : null);
      if (!language) return end("language");
      native?.speak(idOf(index), part, language, speaker, SUPERTONIC_DENOISING_STEPS);
    }
  }

  async function play(): Promise<void> {
    try {
      await (engine === "elevenlabs"
        ? playElevenLabs()
        : engine === "voice-server"
          ? playVoiceServer()
          : playSupertonic());
    } catch (error) {
      if (ended) return;
      if (error instanceof ElevenLabsError) end(elevenLabsFailure(error.code), error.reason);
      else end(error instanceof VoiceServerError ? "voice-server" : "speech");
    }
  }

  const update = (markdown: string, isComplete: boolean, settled = false) => {
    if (ended || complete) return;
    markdownSoFar = markdown;
    const rest = liveSpeechParts(markdown.slice(settledLength), SPEECH_LIMITS.maximumTextLength);
    const fixed = [...settledParts, ...(isComplete || settled ? rest : rest.slice(0, -1))];
    if (settled) {
      settledLength = markdown.length;
      settledParts = fixed;
    }
    if (fixed.length > parts.length) parts.push(...fixed.slice(parts.length));
    complete = isComplete;
    if (complete && lastDone === parts.length - 1) {
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
