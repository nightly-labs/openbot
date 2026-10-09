// How the app starts the voice transcription host.
//
// It is an Electron `utilityProcess` for the same reason as the database host: the app ships the
// `runAsNode: false` fuse, so `process.execPath` cannot be run as Node, and that fuse is part of the
// trust boundary. The host installs no signal listener, so `kill()` ends it during a decode too.

import { join } from "node:path";
import { utilityProcess } from "electron";
import type { VoiceTranscriptionHostProcess, VoiceTranscriptionResponse } from "./voice-transcription-protocol";

export function spawnVoiceTranscriptionHost(): VoiceTranscriptionHostProcess {
  const child = utilityProcess.fork(join(__dirname, "voice-transcription-host.js"), [], {
    serviceName: "OpenBot voice transcription",
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onResponse: (listener) => {
      child.on("message", (message: VoiceTranscriptionResponse) => listener(message));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}
