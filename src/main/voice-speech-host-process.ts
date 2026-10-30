// How the app starts the speech host. It is an Electron `utilityProcess` for the same reasons as the
// voice transcription host; see `voice-transcription-host-process.ts`.

import { join } from "node:path";
import { utilityProcess } from "electron";
import type { VoiceSpeechHostProcess, VoiceSpeechResponse } from "./voice-speech-protocol";

export function spawnVoiceSpeechHost(): VoiceSpeechHostProcess {
  const child = utilityProcess.fork(join(__dirname, "voice-speech-host.js"), [], {
    serviceName: "OpenBot speech",
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onResponse: (listener) => {
      child.on("message", (message: VoiceSpeechResponse) => listener(message));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}
