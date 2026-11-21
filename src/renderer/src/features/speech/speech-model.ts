import { cloudSpeechModel, type SpeechModelStatus } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";
import { voiceServer } from "./voice-server";

const [status, setStatus] = createSignal<SpeechModelStatus | null>(null, {
  equals: (before, after) => before?.phase === after?.phase && before?.modelId === after?.modelId,
});
let following = false;

function speechModelStatus(): SpeechModelStatus | null {
  if (!following) {
    following = true;
    const voice = speechPort().voice;
    voice.onSpeechModelStatus((next) => setStatus(next));
    void voice.getSpeechModelStatus().then(
      (next) => setStatus((current) => current ?? next),
      () => undefined,
    );
  }
  return status();
}

export function speechModelReady(): boolean {
  return speechModelStatus()?.phase === "ready" || voiceServer()?.routes.speech === true;
}

export function speechModelFindsLanguage(): boolean {
  const modelId = speechModelStatus()?.modelId;
  return modelId !== undefined && cloudSpeechModel(modelId) !== undefined;
}
