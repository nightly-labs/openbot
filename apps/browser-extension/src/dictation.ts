import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { recordingToWav, startVoiceMeter, VOICE_LEVEL_COUNT } from "@openbot/ui/voice-recording";
import { createSignal, onCleanup } from "solid-js";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

/** The page that asks for the microphone in a tab: a side panel cannot show the browser's question. */
export const MICROPHONE_PAGE = "microphone.html";

/**
 * Dictation into the composer. The panel records the microphone, and the server turns the recording
 * into text (`voice-transcription-v1`); the panel never transcribes. As on the phone, Stop keeps the
 * words: they go into the draft, and the user sends them.
 */
export function createDictation(options: {
  transcribe: (wav: Uint8Array) => Promise<string>;
  onText: (text: string) => void;
}) {
  const { t } = currentText();
  const [phase, setPhase] = createSignal<DictationPhase>("idle");
  const [seconds, setSeconds] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  /** The microphone loudness of the waveform, oldest first. */
  const [levels, setLevels] = createSignal<number[]>(new Array(VOICE_LEVEL_COUNT).fill(0));
  let stopMeter: (() => void) | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let tick: number | undefined;
  let limit: number | undefined;
  /** A new start, a cancel and the end of the chat make an older recording void. */
  let generation = 0;

  const release = () => {
    stopMeter?.();
    stopMeter = null;
    window.clearInterval(tick);
    window.clearTimeout(limit);
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };

  async function start() {
    if (phase() !== "idle") return;
    const current = ++generation;
    setError(null);
    setPhase("starting");
    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (cause) {
      if (current !== generation) return;
      setPhase("idle");
      setError(await microphoneProblem(cause));
      return;
    }
    if (current !== generation) {
      for (const track of opened.getTracks()) track.stop();
      return;
    }
    stream = opened;
    const chunks: Blob[] = [];
    const active = new MediaRecorder(opened);
    recorder = active;
    active.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    active.addEventListener("stop", () => void finish(current, new Blob(chunks, { type: active.mimeType })));
    active.start();
    stopMeter = startVoiceMeter(opened, setLevels);
    setSeconds(0);
    setPhase("recording");
    tick = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    limit = window.setTimeout(stop, VOICE_AUDIO_LIMITS.maximumSeconds * 1_000);
  }

  function stop() {
    if (phase() !== "recording") return;
    release();
    recorder?.stop();
  }

  async function finish(current: number, recording: Blob) {
    recorder = null;
    if (current !== generation) return;
    setPhase("transcribing");
    try {
      const text = (await options.transcribe(await recordingToWav(recording))).trim();
      if (current !== generation) return;
      if (text) options.onText(text);
      else setError(t("extension.chat.dictation.empty"));
    } catch (cause) {
      if (current === generation)
        setError(cause instanceof Error && cause.message ? cause.message : t("extension.chat.dictation.failed"));
    } finally {
      if (current === generation) setPhase("idle");
    }
  }

  function cancel() {
    generation += 1;
    release();
    recorder?.stop();
    recorder = null;
    setPhase("idle");
  }

  onCleanup(cancel);
  return { phase, seconds, levels, error, clearError: () => setError(null), start, stop, cancel };
}

/** What the user can do when the microphone did not open. */
async function microphoneProblem(cause: unknown): Promise<string> {
  const { t } = currentText();
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotFoundError") return t("extension.chat.dictation.noMicrophone");
  if (name !== "NotAllowedError") return t("extension.chat.dictation.failed");
  const permission = await navigator.permissions
    .query({ name: "microphone" })
    .then((status) => status.state)
    .catch(() => "prompt");
  if (permission === "denied") return t("extension.chat.dictation.microphoneBlocked");
  // The side panel cannot ask. A tab of the extension can, and the panel then has the answer.
  await chrome.tabs.create({ url: chrome.runtime.getURL(MICROPHONE_PAGE) });
  return t("extension.chat.dictation.allowInTab");
}
