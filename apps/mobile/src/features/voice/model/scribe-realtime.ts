import { isDynamicRecord } from "@openbot/contracts/runtime-values";

const SCRIBE_REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
/** The microphone sends 16 kHz 16-bit mono PCM. */
const SAMPLE_RATE = 16_000;
/** How long ElevenLabs has to start the session. */
const OPEN_TIMEOUT_MS = 15_000;
/** After the finish, how long to wait for the last segment when ElevenLabs still shows one in progress. */
const FINAL_SEGMENT_TIMEOUT_MS = 10_000;
/** After the finish, how long to wait for late text when no segment is in progress. */
const QUIET_FINISH_MS = 1_500;
/** Audio that waits for the session to start: 10 s of chunks of 100 ms, then the oldest goes. */
const MAXIMUM_WAITING_CHUNKS = 100;

/** Why a session failed. It never holds the key, the token or the provider's text. */
export type ScribeFailure = "network" | "invalid-key" | "quota" | "rate-limited" | "terms" | "failed";

function failureOf(category: string): ScribeFailure {
  if (category === "auth_error") return "invalid-key";
  if (category === "quota_exceeded") return "quota";
  if (category === "rate_limited" || category === "resource_exhausted" || category === "queue_overflow")
    return "rate-limited";
  if (category === "unaccepted_terms") return "terms";
  if (category === "closed" || category === "open-timeout") return "network";
  return "failed";
}

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Joins segments with a space, except between two characters of a script that writes none, as on desktop. */
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

/**
 * One dictation with ElevenLabs Scribe v2 Realtime, as desktop streams it. ElevenLabs finds the
 * spoken language itself, and ends a segment at a silence, so the text before it stays fixed while
 * the user speaks on. The socket uses a single-use token, not the key.
 */
export class ScribeRealtimeSession {
  readonly #socket: WebSocket;
  readonly #onText: (text: string) => void;
  readonly #onFailure: (failure: ScribeFailure) => void;
  #phase: "opening" | "streaming" | "finishing" | "ended" = "opening";
  #committed: string[] = [];
  #partial = "";
  #waiting: string[] = [];
  #settleFinish: (() => void) | null = null;
  /** `finish` came while the socket opened: the session finishes once it starts. */
  #finishOnStart = false;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: {
    token: string;
    onText: (text: string) => void;
    /** The session ended before its finish, or during it. Called once, and never after `cancel`. */
    onFailure: (failure: ScribeFailure) => void;
  }) {
    this.#onText = options.onText;
    this.#onFailure = options.onFailure;
    const url = new URL(SCRIBE_REALTIME_URL);
    url.searchParams.set("model_id", "scribe_v2_realtime");
    url.searchParams.set("audio_format", "pcm_16000");
    url.searchParams.set("commit_strategy", "vad");
    url.searchParams.set("token", options.token);
    this.#socket = new WebSocket(url.toString());
    this.#socket.onmessage = (event) => {
      if (typeof event.data === "string") this.#receive(event.data);
    };
    // `onclose` follows an error. The error can hold the URL, which holds the token.
    this.#socket.onerror = () => undefined;
    this.#socket.onclose = () => {
      if (this.#phase === "finishing") this.#endFinish();
      else this.#fail("closed");
    };
    this.#timer = setTimeout(() => this.#fail("open-timeout"), OPEN_TIMEOUT_MS);
  }

  get text(): string {
    return joinSegments([...this.#committed, this.#partial]);
  }

  /** Sends 100 ms of base64 PCM. Audio before the session starts waits for it. */
  append(pcm: string): void {
    if (this.#phase === "opening") {
      this.#waiting.push(pcm);
      if (this.#waiting.length > MAXIMUM_WAITING_CHUNKS) this.#waiting.shift();
    } else if (this.#phase === "streaming") this.#send(pcm, false);
  }

  /** Ends the audio and waits for the last segment. A failure on the way reports through `onFailure`. */
  finish(): Promise<void> {
    if (this.#phase === "ended") return Promise.resolve();
    const done = new Promise<void>((resolve) => {
      this.#settleFinish = resolve;
    });
    if (this.#phase !== "opening") this.#beginFinish();
    // The words said while the socket opens wait for the session: it sends them, then finishes.
    else if (this.#waiting.length > 0) this.#finishOnStart = true;
    else this.cancel();
    return done;
  }

  #beginFinish(): void {
    this.#phase = "finishing";
    this.#send("", true);
    this.#armFinishTimer();
  }

  /** Ends the session and drops its text. */
  cancel(): void {
    if (this.#phase === "ended") return;
    this.#phase = "ended";
    this.#clearTimer();
    const settle = this.#settleFinish;
    this.#settleFinish = null;
    settle?.();
    this.#socket.close();
  }

  #send(audio: string, commit: boolean): void {
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
      if (this.#phase !== "opening") return;
      this.#phase = "streaming";
      this.#clearTimer();
      for (const pcm of this.#waiting.splice(0)) this.#send(pcm, false);
      if (this.#finishOnStart) this.#beginFinish();
      return;
    }
    if (type === "partial_transcript" && text !== null) {
      this.#partial = text;
      this.#textChanged();
      if (this.#phase === "finishing") this.#armFinishTimer();
      return;
    }
    if (type === "committed_transcript" && text !== null) {
      this.#committed.push(text);
      this.#partial = "";
      this.#textChanged();
      if (this.#phase === "finishing") this.#endFinish();
      return;
    }
    if (type === "warning" || type.startsWith("committed_transcript_") || type === "edited_transcript") return;
    if (this.#phase === "finishing" && (type === "commit_throttled" || type === "insufficient_audio_activity")) {
      // Nothing was left to commit after the last segment.
      this.#endFinish();
      return;
    }
    this.#fail(type);
  }

  #textChanged(): void {
    if (this.#phase === "streaming" || this.#phase === "finishing") this.#onText(this.text);
  }

  #armFinishTimer(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => this.#endFinish(), this.#partial ? FINAL_SEGMENT_TIMEOUT_MS : QUIET_FINISH_MS);
  }

  #endFinish(): void {
    if (this.#phase !== "finishing") return;
    // The text so far stands for the segment that did not commit in time.
    if (this.#partial) {
      this.#committed.push(this.#partial);
      this.#partial = "";
      this.#onText(this.text);
    }
    this.cancel();
  }

  #fail(category: string): void {
    if (this.#phase === "ended") return;
    this.cancel();
    this.#onFailure(failureOf(category));
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
