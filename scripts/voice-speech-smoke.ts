// Reads two sample replies aloud with the real speech service, sherpa-onnx addon and Supertonic 3
// model, without the app window. The model downloads to the same directory the dev app uses, with
// the pinned checksums.
//
// The host runs in Electron as Node through `child_process.fork`, which it supports. Electron's V8
// memory cage rejects what Node and Bun allow, such as an external ArrayBuffer, so a Bun host would
// not find those faults. A Bun parent and an Electron child share only JSON messages, so the PCM
// bytes arrive as an object of numbers and are decoded here.
//
// Writes one WAV per sample and `report.json` to `.openbot-build/voice-speech-smoke/`.
// Run `bun run voice:prepare-runtime` first. macOS only: it starts the Electron binary of the package.

import { fork } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SpeechAudio, SpeechLanguage, SpeechVoice } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { SpeechPreferenceStore } from "../src/main/speech-preference-store";
import { SUPERTONIC_MODEL_DIRECTORY } from "../src/main/voice-model-service";
import type { VoiceSpeechHostProcess, VoiceSpeechResponse } from "../src/main/voice-speech-protocol";
import { VoiceSpeechService } from "../src/main/voice-speech-service";

const RESOURCES_ROOT = resolve(".openbot-build/voice");
const OUTPUT = resolve(".openbot-build/voice-speech-smoke");
const HOST = resolve("src/main/voice-speech-host.ts");
const ELECTRON = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");

const logger = createOpenBotLogger("voice-speech-smoke");

const SAMPLES: readonly { name: string; language: SpeechLanguage; voice: SpeechVoice; text: string }[] = [
  {
    name: "en-f1",
    language: "en",
    voice: "F1",
    text: "I found two failing tests. Both read the old settings file, so I updated the fixture and they pass now.",
  },
  {
    name: "pl-m1",
    language: "pl",
    voice: "M1",
    text: "Znalazłem dwa testy, które nie przechodzą. Poprawiłem plik z danymi i teraz oba działają.",
  },
];

function spawnHost(): VoiceSpeechHostProcess {
  const child = fork(HOST, [], {
    execPath: ELECTRON,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    serialization: "json",
    stdio: "inherit",
  });
  return {
    send: (request) => child.send(request),
    onResponse: (listener) => {
      child.on("message", (message: unknown) => listener(responseFromJson(message)));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}

function responseFromJson(message: unknown): VoiceSpeechResponse {
  if (typeof message !== "object" || message === null || !("id" in message) || typeof message.id !== "number")
    throw new Error("The host sent a message with no id.");
  if ("error" in message) {
    const error = message.error;
    if (error === "runtime-unavailable" || error === "model-load-failed" || error === "inference-failed")
      return { id: message.id, error };
    throw new Error("The host sent an unknown error.");
  }
  if (!("pcm" in message) || typeof message.pcm !== "object" || message.pcm === null)
    throw new Error("The host sent no audio.");
  if (!("sampleRate" in message) || typeof message.sampleRate !== "number")
    throw new Error("The host sent no sample rate.");
  const bytes = Object.values(message.pcm);
  if (!bytes.every((byte) => typeof byte === "number")) throw new Error("The host sent audio that is not bytes.");
  return { id: message.id, pcm: Uint8Array.from(bytes), sampleRate: message.sampleRate };
}

function wav({ pcm, sampleRate }: SpeechAudio): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) header.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  const file = new Uint8Array(44 + pcm.byteLength);
  file.set(new Uint8Array(header.buffer), 0);
  file.set(pcm, 44);
  return file;
}

/** The loudest sample, from 0 to 1. Silence would mean the model ran but produced nothing. */
function peak({ pcm }: SpeechAudio): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let loudest = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2)
    loudest = Math.max(loudest, Math.abs(view.getInt16(offset, true)));
  return loudest / 32_768;
}

async function main(): Promise<void> {
  await mkdir(OUTPUT, { recursive: true });
  const preferencesDirectory = await mkdtemp(join(tmpdir(), "openbot-speech-smoke-"));
  const preferences = new SpeechPreferenceStore(join(preferencesDirectory, "speech-preference.json"));
  const speech = new VoiceSpeechService({
    resourcesRoot: RESOURCES_ROOT,
    modelDirectory: join(RESOURCES_ROOT, SUPERTONIC_MODEL_DIRECTORY),
    preferences,
    spawnHost,
  });
  const results: unknown[] = [];
  try {
    const downloadStartedAt = Date.now();
    const status = await Effect.runPromise(speech.downloadModel());
    if (status.phase !== "ready") throw new Error(`The model is not ready: ${status.phase} ${status.message ?? ""}`);
    const downloadMs = Date.now() - downloadStartedAt;
    for (const sample of SAMPLES) {
      await Effect.runPromise(speech.setSettings({ readReplies: true, voice: sample.voice }));
      const startedAt = Date.now();
      const audio = await Effect.runPromise(speech.speak({ text: sample.text, language: sample.language }));
      const synthesisMs = Date.now() - startedAt;
      const seconds = audio.pcm.byteLength / 2 / audio.sampleRate;
      const loudest = peak(audio);
      if (seconds < 1 || loudest < 0.05) throw new Error(`${sample.name} is silent or too short.`);
      const file = join(OUTPUT, `${sample.name}.wav`);
      await writeFile(file, wav(audio));
      results.push({ ...sample, file, sampleRate: audio.sampleRate, seconds, peak: loudest, synthesisMs });
      logger.info(`${sample.name}: ${seconds.toFixed(1)}s of audio in ${synthesisMs}ms.`);
    }
    await writeFile(
      join(OUTPUT, "report.json"),
      `${JSON.stringify({ ok: true, at: new Date().toISOString(), downloadMs, results }, null, 2)}\n`,
    );
    logger.info(`Report: ${join(OUTPUT, "report.json")}`);
  } finally {
    await Effect.runPromise(speech.shutdown());
    await rm(preferencesDirectory, { recursive: true, force: true });
  }
}

await main();
