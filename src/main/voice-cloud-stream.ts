// One streamed dictation with ElevenLabs Scribe v2 Realtime.
//
// Electron-free, with the socket injected, so its tests need no network. The API key goes only into
// the request header of the socket that `openScribeSocket` opens; nothing here logs it, and the
// provider's own error text is not logged or shown either, only its category.

import { AUTOMATIC_VOICE_LANGUAGE, VOICE_KEY_PROVIDER_NAMES, type VoiceLanguage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import WebSocket from "ws";
import { rawDataText } from "./ws-raw-data";

const logger = createOpenBotLogger("voice-cloud-stream");

const SCRIBE_REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const SAMPLE_RATE = 16_000;
/** How long ElevenLabs has to accept the socket. */
const OPEN_TIMEOUT_MS = 15_000;
/** After Stop, how long to wait for the last segment when ElevenLabs still shows one in progress. */
const FINAL_SEGMENT_TIMEOUT_MS = 10_000;
/** After Stop, how long to wait for late text when no segment is in progress. */
const QUIET_FINISH_MS = 1_500;
/**
 * How long a started stream stays open with no audio. The window sends audio four times a second, so
 * this ends a stream whose window reloaded or crashed.
 */
const IDLE_TIMEOUT_MS = 15_000;

/** The socket as the session uses it. `openScribeSocket` adapts a `ws` socket to it. */
export interface VoiceStreamSocket {
  send(text: string): void;
  close(): void;
}

interface VoiceStreamSocketEvents {
  onMessage: (text: string) => void;
  /** The provider refused the HTTP upgrade, with this status code. */
  onRejected: (statusCode: number) => void;
  /** The socket ended, asked or not. Called once. */
  onClose: () => void;
}

export type OpenVoiceStreamSocket = (url: string, apiKey: string, events: VoiceStreamSocketEvents) => VoiceStreamSocket;

export const openScribeSocket: OpenVoiceStreamSocket = (url, apiKey, events) => {
  const socket = new WebSocket(url, { headers: { "xi-api-key": apiKey }, handshakeTimeout: OPEN_TIMEOUT_MS });
  socket.on("message", (data) => events.onMessage(rawDataText(data)));
  socket.on("unexpected-response", (request, response) => {
    events.onRejected(response.statusCode ?? 0);
    request.destroy();
  });
  socket.on("close", events.onClose);
  socket.on("error", () => {
    // `close` follows. The error can carry the URL and headers of the request.
  });
  return { send: (text) => socket.send(text), close: () => socket.terminate() };
};

/** The socket URL for one dictation. Automatic leaves the language to ElevenLabs. */
export function scribeRealtimeUrl(language: VoiceLanguage): string {
  const url = new URL(SCRIBE_REALTIME_URL);
  url.searchParams.set("model_id", "scribe_v2_realtime");
  url.searchParams.set("audio_format", "pcm_16000");
  // Silence ends a segment, so the text before it stays fixed while the user speaks on.
  url.searchParams.set("commit_strategy", "vad");
  if (language !== AUTOMATIC_VOICE_LANGUAGE) url.searchParams.set("language_code", language === "jw" ? "jv" : language);
  return url.toString();
}

/** Why a stream failed. The message is localized English from `sourceText`. */
export class VoiceStreamFailure extends Error {}

function failureFor(category: string): VoiceStreamFailure {
  if (category === "auth_error" || category === "http-401" || category === "http-403")
    return new VoiceStreamFailure(
      sourceText("error.voice.cloud.keyRejected", { provider: VOICE_KEY_PROVIDER_NAMES.elevenlabs }),
    );
  if (category === "quota_exceeded")
    return new VoiceStreamFailure(
      sourceText("error.voice.cloud.quotaExceeded", { provider: VOICE_KEY_PROVIDER_NAMES.elevenlabs }),
    );
  if (category === "rate_limited" || category === "http-429" || category === "resource_exhausted")
    return new VoiceStreamFailure(
      sourceText("error.voice.cloud.rateLimited", { provider: VOICE_KEY_PROVIDER_NAMES.elevenlabs }),
    );
  if (category === "unaccepted_terms") return new VoiceStreamFailure(sourceText("error.voice.cloud.termsRequired"));
  return new VoiceStreamFailure(sourceText("error.voice.transcriptionFailed"));
}

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Joins segments with a space, except between two characters of a script that writes none. */
function joinSegments(segments: readonly string[]): string {
  let text = "";
  for (const segment of segments) {
    const next = segment.trim();
    if (!next) continue;
    const joint = text && !(NO_SPACE_SCRIPT.test(text.at(-1) ?? "") && NO_SPACE_SCRIPT.test(next[0] ?? ""));
    text = joint ? `${text} ${next}` : `${text}${next}`;
  }
  return text;
}

type SessionState =
  | { phase: "opening" }
  | { phase: "streaming" }
  | { phase: "finishing" }
  | { phase: "ended" }
  | { phase: "failed"; failure: VoiceStreamFailure };

/**
 * One dictation. `ready` settles when ElevenLabs started the session or refused it; `finish` sends
 * the end of the audio and answers the whole text. Each change of the text goes to `onText`.
 */
export class ScribeRealtimeSession {
  readonly ready: Promise<void>;
  readonly #socket: VoiceStreamSocket;
  readonly #onText: (text: string) => void;
  #state: SessionState = { phase: "opening" };
  #committed: string[] = [];
  #partial = "";
  #settleReady: { resolve: () => void; reject: (failure: VoiceStreamFailure) => void } | null = null;
  #settleFinish: ((outcome: VoiceStreamFailure | null) => void) | null = null;
  #finishTimer: NodeJS.Timeout | null = null;
  #idleTimer: NodeJS.Timeout | null = null;
  #openTimer: NodeJS.Timeout | null;

  constructor(options: {
    url: string;
    apiKey: string;
    open: OpenVoiceStreamSocket;
    onText: (text: string) => void;
  }) {
    this.#onText = options.onText;
    this.ready = new Promise((resolve, reject) => {
      this.#settleReady = { resolve, reject };
    });
    // A refused start is reported through `ready`; this keeps it from counting as unhandled first.
    this.ready.catch(() => {});
    // The socket opens first: when `open` throws, no timer is left to use a missing socket.
    this.#socket = options.open(options.url, options.apiKey, {
      onMessage: (text) => this.#receive(text),
      onRejected: (statusCode) => this.#fail(`http-${statusCode}`),
      onClose: () => this.#closed(),
    });
    this.#openTimer = setTimeout(() => this.#fail("open-timeout"), OPEN_TIMEOUT_MS);
  }

  get text(): string {
    return joinSegments([...this.#committed, this.#partial]);
  }

  /** Sends the next part of the audio. A failed or ended stream throws its failure. */
  append(pcm: Uint8Array): void {
    if (this.#state.phase === "failed") throw this.#state.failure;
    if (this.#state.phase !== "streaming") throw new VoiceStreamFailure(sourceText("error.voice.cloud.streamEnded"));
    this.#armIdleTimer();
    if (pcm.byteLength === 0) return;
    this.#sendChunk(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64"), false);
  }

  /** Ends the audio, waits for the last segment, and answers the whole text. */
  async finish(): Promise<string> {
    if (this.#state.phase === "failed") throw this.#state.failure;
    if (this.#state.phase !== "streaming") throw new VoiceStreamFailure(sourceText("error.voice.cloud.streamEnded"));
    this.#state = { phase: "finishing" };
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const done = new Promise<VoiceStreamFailure | null>((resolve) => {
      this.#settleFinish = resolve;
    });
    this.#sendChunk("", true);
    this.#armFinishTimer();
    const failure = await done;
    this.#socket.close();
    if (failure) throw failure;
    return this.text;
  }

  /** Ends the stream and drops its text. */
  cancel(): void {
    if (this.#state.phase === "ended" || this.#state.phase === "failed") return;
    const failure = new VoiceStreamFailure(sourceText("error.voice.cloud.streamEnded"));
    if (this.#state.phase === "finishing") {
      // `finish` closes the socket.
      this.#endFinish(failure);
      return;
    }
    this.#state = { phase: "ended" };
    this.#clearTimers();
    this.#settleReady?.reject(failure);
    this.#settleReady = null;
    this.#socket.close();
  }

  #sendChunk(audio: string, commit: boolean): void {
    this.#socket.send(
      JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: audio, commit, sample_rate: SAMPLE_RATE }),
    );
  }

  #receive(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.#fail("invalid-message");
      return;
    }
    if (!isDynamicRecord(message) || typeof message.message_type !== "string") {
      this.#fail("invalid-message");
      return;
    }
    const type = message.message_type;
    const text = typeof message.text === "string" ? message.text : null;
    if (type === "session_started") {
      if (this.#state.phase !== "opening") return;
      this.#state = { phase: "streaming" };
      if (this.#openTimer) clearTimeout(this.#openTimer);
      this.#openTimer = null;
      this.#armIdleTimer();
      this.#settleReady?.resolve();
      this.#settleReady = null;
      return;
    }
    if (type === "partial_transcript" && text !== null) {
      this.#partial = text;
      this.#textChanged();
      if (this.#state.phase === "finishing") this.#armFinishTimer();
      return;
    }
    if (type === "committed_transcript" && text !== null) {
      this.#committed.push(text);
      this.#partial = "";
      this.#textChanged();
      if (this.#state.phase === "finishing") this.#endFinish(null);
      return;
    }
    // Timestamps, entities and edits are off for this session; a warning does not end it.
    if (type === "warning" || type.startsWith("committed_transcript_") || type === "edited_transcript") return;
    // Every other message type is an error that ends the session.
    if (this.#state.phase === "finishing" && (type === "commit_throttled" || type === "insufficient_audio_activity")) {
      // Nothing was left to commit after the last segment.
      this.#endFinish(null);
      return;
    }
    this.#fail(type);
  }

  #textChanged(): void {
    if (this.#state.phase === "streaming" || this.#state.phase === "finishing") this.#onText(this.text);
  }

  #armIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.#fail("idle"), IDLE_TIMEOUT_MS);
  }

  #armFinishTimer(): void {
    if (this.#finishTimer) clearTimeout(this.#finishTimer);
    this.#finishTimer = setTimeout(
      () => this.#endFinish(null),
      this.#partial ? FINAL_SEGMENT_TIMEOUT_MS : QUIET_FINISH_MS,
    );
  }

  #endFinish(failure: VoiceStreamFailure | null): void {
    if (!this.#settleFinish) return;
    const settle = this.#settleFinish;
    this.#settleFinish = null;
    this.#clearTimers();
    this.#state = failure ? { phase: "failed", failure } : { phase: "ended" };
    // The text so far stands for the segment that did not commit in time.
    if (!failure && this.#partial) {
      this.#committed.push(this.#partial);
      this.#partial = "";
    }
    settle(failure);
  }

  #fail(category: string): void {
    if (this.#state.phase === "ended" || this.#state.phase === "failed") return;
    logger.warn("ElevenLabs ended a dictation stream.", { category });
    const failure = failureFor(category);
    if (this.#state.phase === "finishing") {
      this.#endFinish(failure);
      return;
    }
    this.#state = { phase: "failed", failure };
    this.#clearTimers();
    this.#settleReady?.reject(failure);
    this.#settleReady = null;
    this.#socket.close();
  }

  #closed(): void {
    if (this.#state.phase === "finishing") this.#endFinish(null);
    else this.#fail("closed");
  }

  #clearTimers(): void {
    if (this.#openTimer) clearTimeout(this.#openTimer);
    if (this.#finishTimer) clearTimeout(this.#finishTimer);
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#openTimer = null;
    this.#finishTimer = null;
    this.#idleTimer = null;
  }
}
