import type { SpeechModelStatus } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";
import { voiceServer } from "./voice-server";

const [status, setStatus] = createSignal<SpeechModelStatus["phase"] | null>(null);
let following = false;

export function speechModelReady(): boolean {
  if (!following) {
    following = true;
    const voice = speechPort().voice;
    voice.onSpeechModelStatus((next) => setStatus(next.phase));
    void voice.getSpeechModelStatus().then(
      (next) => setStatus((current) => current ?? next.phase),
      () => undefined,
    );
  }
  return status() === "ready" || voiceServer()?.routes.speech === true;
}
