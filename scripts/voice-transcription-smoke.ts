// Transcribes spoken English with the real transcription service, sherpa-onnx addon and local
// dictation models, without the app window. Each model downloads to the directory the dev app uses,
// with the pinned checksums. macOS `say` speaks the samples in Samantha, a voice that every Mac has;
// the default voice can be a novelty voice that no model understands.
//
// The host runs in Electron as Node through `child_process.fork`, as in `voice-speech-smoke.ts`.
// A Bun parent and an Electron child share only JSON messages, so the PCM bytes go as an array of
// numbers, and a listener that runs before the host's listener makes them a `Uint8Array` again.
//
// Writes `report.json` to `.openbot-build/voice-transcription-smoke/`.
// Run `bun run voice:prepare-runtime` first. macOS only.
//
//   bun scripts/voice-transcription-smoke.ts [model id...]   (default: bark-3.0-plus)

import { execFileSync, fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isLocalVoiceModelId, type LocalVoiceModelId } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { VoiceApiKeyStore } from "../src/main/voice-api-key-store";
import { openScribeSocket } from "../src/main/voice-cloud-stream";
import { BARK_PLUS_MODEL_DIRECTORY, WHISPER_TURBO_MODEL_DIRECTORY } from "../src/main/voice-model-service";
import { VoicePreferenceStore } from "../src/main/voice-preference-store";
import type {
  VoiceTranscriptionFailure,
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionResponse,
} from "../src/main/voice-transcription-protocol";
import { VoiceTranscriptionService } from "../src/main/voice-transcription-service";

const RESOURCES_ROOT = resolve(".openbot-build/voice");
const OUTPUT = resolve(".openbot-build/voice-transcription-smoke");
const HOST = resolve("src/main/voice-transcription-host.ts");
const ELECTRON = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
/** The same directories as the dev app in `application-services.ts`. */
const MODEL_DIRECTORIES: Record<LocalVoiceModelId, string> = {
  "parakeet-tdt-0.6b-v3": join(RESOURCES_ROOT, "model"),
  "bark-3.0-plus": join(RESOURCES_ROOT, BARK_PLUS_MODEL_DIRECTORY),
  "whisper-turbo": join(RESOURCES_ROOT, WHISPER_TURBO_MODEL_DIRECTORY),
};
/** Synthetic speech is clear, so a model that works gets nearly every word. */
const MAXIMUM_WORD_ERROR_RATE = 0.15;
/** Makes the JSON array of `pcm` a `Uint8Array` before the host checks the request. */
const PCM_FROM_JSON = `data:text/javascript,process.prependListener("message",(m)=>{if(m&&typeof m==="object"&&Array.isArray(m.pcm))m.pcm=Uint8Array.from(m.pcm)});`;
const FAILURES: readonly VoiceTranscriptionFailure[] = ["runtime-unavailable", "model-load-failed", "inference-failed"];

const logger = createOpenBotLogger("voice-transcription-smoke");

/** Each sample starts with a short word: a model that loses the first word fails here. */
const SAMPLES: readonly { name: string; text: string }[] = [
  { name: "settings", text: "Please open the settings and turn on dark mode." },
  { name: "reply", text: "Read the latest reply from the team and summarize it for me." },
  { name: "report", text: "Yes, send the report to everyone on the project." },
  {
    name: "long",
    text: "Can you check why the build failed on the main branch this morning? I think the new test for the login page is flaky, so please run it again and tell me what you find.",
  },
];

function spawnHost(): VoiceTranscriptionHostProcess {
  const child = fork(HOST, [], {
    execPath: ELECTRON,
    execArgv: ["--import", PCM_FROM_JSON],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    serialization: "json",
    stdio: "inherit",
  });
  return {
    send: (request) => child.send({ ...request, pcm: Array.from(request.pcm) }),
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

function responseFromJson(message: unknown): VoiceTranscriptionResponse {
  if (typeof message !== "object" || message === null || !("id" in message) || typeof message.id !== "number")
    throw new Error("The host sent a message with no id.");
  if ("error" in message) {
    const failure = FAILURES.find((category) => category === message.error);
    if (!failure) throw new Error("The host sent an unknown error.");
    return { id: message.id, error: failure };
  }
  if (!("text" in message) || typeof message.text !== "string") throw new Error("The host sent no text.");
  return { id: message.id, text: message.text };
}

/** Speaks the text with macOS `say` and answers the canonical 44-byte WAV that dictation sends. */
async function spokenWav(text: string, directory: string): Promise<Uint8Array> {
  const path = join(directory, "sample.wav");
  execFileSync("say", ["-v", "Samantha", "-o", path, "--data-format=LEI16@16000", "--channels=1", text]);
  const file = await readFile(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = 12;
  while (offset + 8 <= file.byteLength) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return wav(file.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error("`say` wrote a WAV file with no data chunk.");
}

function wav(pcm: Uint8Array): Uint8Array {
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
  header.setUint32(24, 16_000, true);
  header.setUint32(28, 32_000, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  const file = new Uint8Array(44 + pcm.byteLength);
  file.set(new Uint8Array(header.buffer), 0);
  file.set(pcm, 44);
  return file;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word-level edit distance divided by the number of expected words. */
function wordErrorRate(expected: string, actual: string): number {
  const reference = words(expected);
  const hypothesis = words(actual);
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (reference[row - 1] === hypothesis[column - 1] ? 0 : 1);
      current.push(Math.min(substitution, (previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1));
    }
    previous = current;
  }
  return (previous[hypothesis.length] ?? 0) / reference.length;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const modelIds = requested.length === 0 ? ["bark-3.0-plus"] : requested;
  const unknown = modelIds.find((modelId) => !isLocalVoiceModelId(modelId));
  if (unknown) throw new Error(`Not a local dictation model: ${unknown}`);
  await mkdir(OUTPUT, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "openbot-transcription-smoke-"));
  const voice = new VoiceTranscriptionService({
    resourcesRoot: RESOURCES_ROOT,
    modelDirectories: MODEL_DIRECTORIES,
    preferences: new VoicePreferenceStore(join(temporary, "voice-preference.json")),
    // ElevenLabs is not used: the key store is never loaded and nothing is encrypted.
    apiKeys: new VoiceApiKeyStore({
      path: join(temporary, "voice-api-key.json"),
      cipher: { canPersist: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" },
    }),
    spawnHost,
    openStreamSocket: openScribeSocket,
  });
  const results: unknown[] = [];
  let failed = false;
  try {
    const audio = new Map<string, Uint8Array>();
    for (const sample of SAMPLES) audio.set(sample.name, await spokenWav(sample.text, temporary));
    for (const modelId of modelIds.filter(isLocalVoiceModelId)) {
      await Effect.runPromise(voice.setSettings({ modelId, language: "automatic" }));
      const downloadStartedAt = Date.now();
      const status = await Effect.runPromise(voice.downloadModel(modelId));
      if (status.phase !== "ready") throw new Error(`${modelId} is not ready: ${status.phase} ${status.message ?? ""}`);
      const downloadMs = Date.now() - downloadStartedAt;
      for (const sample of SAMPLES) {
        const wavBytes = audio.get(sample.name);
        if (!wavBytes) throw new Error(`No audio for ${sample.name}.`);
        const startedAt = Date.now();
        const { text } = await Effect.runPromise(voice.transcribe(wavBytes));
        const transcriptionMs = Date.now() - startedAt;
        const wer = wordErrorRate(sample.text, text);
        const firstWord = words(text)[0] === words(sample.text)[0];
        const ok = wer <= MAXIMUM_WORD_ERROR_RATE && firstWord;
        failed ||= !ok;
        results.push({
          modelId,
          sample: sample.name,
          expected: sample.text,
          text,
          wer,
          firstWord,
          ok,
          transcriptionMs,
          downloadMs,
        });
        logger.info(`${modelId} ${sample.name}: "${text}" (WER ${(wer * 100).toFixed(1)} %, ${transcriptionMs} ms)`);
      }
    }
    await writeFile(
      join(OUTPUT, "report.json"),
      `${JSON.stringify({ ok: !failed, at: new Date().toISOString(), maximumWordErrorRate: MAXIMUM_WORD_ERROR_RATE, results }, null, 2)}\n`,
    );
    logger.info(`Report: ${join(OUTPUT, "report.json")}`);
  } finally {
    await Effect.runPromise(voice.shutdown());
    await rm(temporary, { recursive: true, force: true });
  }
  if (failed) throw new Error("A transcription missed its first word or had too many word errors.");
}

await main();
