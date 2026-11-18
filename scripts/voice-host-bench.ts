// Measures the local voice hosts on this computer: load time, decode or synthesis time and resident
// memory for each ONNX Runtime thread count and session settings file. Then it checks that the real
// services stop an idle host.
//
// The hosts run in Electron as Node through `child_process.fork`, as in `voice-transcription-smoke.ts`.
// macOS `say` speaks the fixed clips in Samantha. By default each model runs with the ONNX Runtime
// defaults ("default") and with the settings file that the app gives it. Memory is the resident set
// size that `ps` reports for the host process.
//
// Writes `report.json` to `.openbot-build/voice-host-bench/`.
// Run `bun run voice:prepare-runtime` first. Models download with the pinned checksums. macOS only.
//
//   bun scripts/voice-host-bench.ts [--threads=4,6,8] [--runs=5] [--models=parakeet-tdt-0.6b-v3,...]
//                                   [--configs=default,no-arena.cfg,...] [--no-speech] [--no-idle]

import { execFileSync, fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { isLocalVoiceModelId, type LocalVoiceModelId } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { SpeechPreferenceStore } from "../src/main/speech-preference-store";
import { VoiceApiKeyStore } from "../src/main/voice-api-key-store";
import { openScribeSocket } from "../src/main/voice-cloud-stream";
import {
  BARK_PLUS_MODEL_DIRECTORY,
  COHERE_TRANSCRIBE_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  SPEECH_SESSION_CONFIG,
  SUPERTONIC_MODEL_DIRECTORY,
  TRANSCRIPTION_SESSION_CONFIGS,
  transcriptionHostThreads,
  VOICE_RUNTIME_ADDON,
  VOICE_SESSION_CONFIGS,
  type VoiceSessionConfig,
  WHISPER_TURBO_MODEL_DIRECTORY,
} from "../src/main/voice-model-service";
import { VoicePreferenceStore } from "../src/main/voice-preference-store";
import type {
  VoiceSpeechHostProcess,
  VoiceSpeechRequest,
  VoiceSpeechResponse,
} from "../src/main/voice-speech-protocol";
import { VoiceSpeechService } from "../src/main/voice-speech-service";
import type {
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
} from "../src/main/voice-transcription-protocol";
import { MODEL_ENGINES, VoiceTranscriptionService } from "../src/main/voice-transcription-service";

const RESOURCES_ROOT = resolve(".openbot-build/voice");
const RUNTIME = join(RESOURCES_ROOT, "runtime");
const OUTPUT = resolve(".openbot-build/voice-host-bench");
const TRANSCRIPTION_HOST = resolve("src/main/voice-transcription-host.ts");
const SPEECH_HOST = resolve("src/main/voice-speech-host.ts");
const ELECTRON = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const MODEL_DIRECTORIES: Record<LocalVoiceModelId, string> = {
  "parakeet-tdt-0.6b-v3": join(RESOURCES_ROOT, "model"),
  "parakeet-unified-en-0.6b": join(RESOURCES_ROOT, PARAKEET_UNIFIED_MODEL_DIRECTORY),
  "bark-3.0-plus": join(RESOURCES_ROOT, BARK_PLUS_MODEL_DIRECTORY),
  "whisper-turbo": join(RESOURCES_ROOT, WHISPER_TURBO_MODEL_DIRECTORY),
  "cohere-transcribe-03-2026": join(RESOURCES_ROOT, COHERE_TRANSCRIBE_MODEL_DIRECTORY),
};
const PCM_FROM_JSON = `data:text/javascript,process.prependListener("message",(m)=>{if(m&&typeof m==="object"&&Array.isArray(m.pcm))m.pcm=Uint8Array.from(m.pcm)});`;
/** The services stop an idle host after 60 s; the check fails when it waits longer than this. */
const IDLE_STOP_LIMIT_MS = 90_000;

const CLIPS: readonly { name: string; text: string }[] = [
  { name: "short", text: "Open the settings." },
  {
    name: "medium",
    text: "Read the latest reply from the team and summarize it for me, then send the report to everyone on the project.",
  },
  {
    name: "long",
    text: "Can you check why the build failed on the main branch this morning? I think the new test for the login page is flaky, so please run it again and tell me what you find. If it fails a second time, open an issue with the log, assign it to me, and add the release label so that we look at it before the next version ships.",
  },
  {
    // About 40 s: a long turn, which the live preview decodes again about once per second.
    name: "extended",
    text: "Can you check why the build failed on the main branch this morning? I think the new test for the login page is flaky, so please run it again and tell me what you find. If it fails a second time, open an issue with the log, assign it to me, and add the release label so that we look at it before the next version ships. After that, read the latest reply from the team and summarize it for me, then send the report to everyone on the project. Also look at the open pull requests that wait for my review, sort them by age, and tell me which of them touch the voice settings or the speech model, because I want to test those first on the Windows laptop before the release goes out on Friday afternoon.",
  },
];
const SPEECH_TEXT =
  "I found two failing tests. Both read the old settings file, so I updated the fixture and they pass now.";

const logger = createOpenBotLogger("voice-host-bench");

function option(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(
    sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0),
  );
}

function residentMegabytes(pid: number | undefined): number {
  if (pid === undefined) return 0;
  return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) / 1024);
}

/** Spoken 16 kHz mono PCM of the text, without the WAV header. */
async function spokenPcm(text: string, directory: string): Promise<Uint8Array> {
  const path = join(directory, "clip.wav");
  execFileSync("say", ["-v", "Samantha", "-o", path, "--data-format=LEI16@16000", "--channels=1", text]);
  const file = await readFile(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = 12;
  while (offset + 8 <= file.byteLength) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return Uint8Array.from(file.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error("`say` wrote a WAV file with no data chunk.");
}

/** The canonical 44-byte WAV that dictation sends. */
function wav(pcm: Uint8Array): Uint8Array {
  const file = new Uint8Array(44 + pcm.byteLength);
  const header = new DataView(file.buffer);
  file.set(new TextEncoder().encode("RIFF"), 0);
  header.setUint32(4, 36 + pcm.byteLength, true);
  file.set(new TextEncoder().encode("WAVEfmt "), 8);
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, 16_000, true);
  header.setUint32(28, 32_000, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  file.set(new TextEncoder().encode("data"), 36);
  header.setUint32(40, pcm.byteLength, true);
  file.set(pcm, 44);
  return file;
}

/** A transcription request as JSON sends it: `PCM_FROM_JSON` turns the array back into bytes in the host. */
type TranscriptionWireRequest = Omit<VoiceTranscriptionRequest, "pcm"> & { pcm: number[] };

/** One forked host that answers one request at a time. */
function startHost<
  Request extends TranscriptionWireRequest | VoiceSpeechRequest,
  Response extends VoiceTranscriptionResponse | VoiceSpeechResponse,
>(path: string, extraArgv: readonly string[], decode: (message: unknown) => Response) {
  const child = fork(path, [], {
    execPath: ELECTRON,
    execArgv: [...extraArgv],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    serialization: "json",
    stdio: "inherit",
  });
  let pending: { resolve: (response: Response) => void; reject: (error: Error) => void } | null = null;
  child.on("message", (message: unknown) => {
    const request = pending;
    pending = null;
    if (!request) return;
    const response = decode(message);
    if ("error" in response) request.reject(new Error(`The host failed: ${response.error}`));
    else request.resolve(response);
  });
  const exited = new Promise<void>((resolveExit) =>
    child.once("exit", () => {
      pending?.reject(new Error("The host exited during a request."));
      resolveExit();
    }),
  );
  return {
    pid: child.pid,
    async request(message: Request): Promise<{ ms: number; response: Response }> {
      const startedAt = performance.now();
      const response = await new Promise<Response>((resolveRequest, reject) => {
        pending = { resolve: resolveRequest, reject };
        child.send(message);
      });
      return { ms: Math.round(performance.now() - startedAt), response };
    },
    async stop(): Promise<void> {
      child.kill();
      await exited;
    },
  };
}

async function benchTranscription(
  modelId: LocalVoiceModelId,
  sessionConfig: VoiceSessionConfig,
  numThreads: number,
  runs: number,
  clips: ReadonlyMap<string, Uint8Array>,
) {
  const host = startHost<TranscriptionWireRequest, VoiceTranscriptionResponse>(
    TRANSCRIPTION_HOST,
    ["--import", PCM_FROM_JSON],
    transcriptionResponse,
  );
  let id = 0;
  const transcribe = (pcm: Uint8Array) => {
    const request: VoiceTranscriptionRequest = {
      id: id++,
      addonPath: join(RUNTIME, VOICE_RUNTIME_ADDON),
      modelDirectory: MODEL_DIRECTORIES[modelId],
      engine: MODEL_ENGINES[modelId],
      language: "",
      leadingSilenceSamples: 0,
      numThreads,
      sessionConfig,
      pcm,
    };
    return host.request({ ...request, pcm: Array.from(pcm) });
  };
  try {
    const first = clips.get("short") ?? new Uint8Array(0);
    const cold = await transcribe(first);
    const loadedMb = residentMegabytes(host.pid);
    const decode: Record<string, { medianMs: number; audioSeconds: number; text: string }> = {};
    for (const [name, pcm] of clips) {
      const times: number[] = [];
      let text = "";
      for (let run = 0; run < runs; run += 1) {
        const result = await transcribe(pcm);
        times.push(result.ms);
        text = "text" in result.response ? result.response.text : "";
      }
      decode[name] = { medianMs: median(times), audioSeconds: pcm.byteLength / 32_000, text };
    }
    const shortMs = decode.short?.medianMs ?? 0;
    return {
      modelId,
      sessionConfig: sessionConfig || "default",
      numThreads,
      coldMs: cold.ms,
      loadMs: Math.max(0, cold.ms - shortMs),
      residentAfterFirstMb: loadedMb,
      residentAfterRunsMb: residentMegabytes(host.pid),
      decode,
    };
  } finally {
    await host.stop();
  }
}

async function benchSpeech(sessionConfig: VoiceSessionConfig, numThreads: number, runs: number) {
  const host = startHost<VoiceSpeechRequest, VoiceSpeechResponse>(SPEECH_HOST, [], speechResponse);
  let id = 0;
  const speak = (loadOnly: boolean) => {
    const request: VoiceSpeechRequest = {
      id: id++,
      addonPath: join(RUNTIME, VOICE_RUNTIME_ADDON),
      modelDirectory: join(RESOURCES_ROOT, SUPERTONIC_MODEL_DIRECTORY),
      text: SPEECH_TEXT,
      language: "en",
      speakerId: 0,
      loadOnly,
      numThreads,
      sessionConfig,
    };
    return host.request(request);
  };
  try {
    const load = await speak(true);
    const loadedMb = residentMegabytes(host.pid);
    const times: number[] = [];
    let audioSeconds = 0;
    for (let run = 0; run < runs; run += 1) {
      const result = await speak(false);
      times.push(result.ms);
      if ("pcm" in result.response) audioSeconds = result.response.pcm.byteLength / 2 / result.response.sampleRate;
    }
    return {
      sessionConfig: sessionConfig || "default",
      numThreads,
      loadMs: load.ms,
      residentAfterLoadMb: loadedMb,
      residentAfterRunsMb: residentMegabytes(host.pid),
      synthesisMedianMs: median(times),
      audioSeconds: Math.round(audioSeconds * 10) / 10,
    };
  } finally {
    await host.stop();
  }
}

/** The services read a host reply as a protocol response; JSON turns a `Uint8Array` into an object. */
function transcriptionResponse(message: unknown): VoiceTranscriptionResponse {
  if (typeof message !== "object" || message === null || !("id" in message) || typeof message.id !== "number")
    throw new Error("The host sent a message with no id.");
  if ("error" in message) return { id: message.id, error: "inference-failed" };
  return { id: message.id, text: "text" in message && typeof message.text === "string" ? message.text : "" };
}

function speechResponse(message: unknown): VoiceSpeechResponse {
  if (typeof message !== "object" || message === null || !("id" in message) || typeof message.id !== "number")
    throw new Error("The host sent a message with no id.");
  if ("error" in message) return { id: message.id, error: "inference-failed" };
  const pcm = "pcm" in message && typeof message.pcm === "object" && message.pcm !== null ? message.pcm : {};
  const bytes = Object.values(pcm).filter((byte) => typeof byte === "number");
  const sampleRate = "sampleRate" in message && typeof message.sampleRate === "number" ? message.sampleRate : 0;
  return { id: message.id, pcm: Uint8Array.from(bytes), sampleRate };
}

/** Resolves with the time from the last reply to the host's exit, or rejects after the limit. */
function exitAfterReply(exit: Promise<void>): Promise<number> {
  const repliedAt = Date.now();
  return new Promise<number>((resolveStop, reject) => {
    const timer = setTimeout(() => reject(new Error("The idle host did not stop.")), IDLE_STOP_LIMIT_MS);
    void exit.then(() => {
      clearTimeout(timer);
      resolveStop(Date.now() - repliedAt);
    });
  });
}

/** The bench saves no key. */
const NO_CIPHER = { canPersist: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" };

/** The cloud dictation keys, with none saved: the bench transcribes with local models only. */
function noDictationKeys(temporary: string) {
  return {
    elevenlabs: new VoiceApiKeyStore({ path: join(temporary, "voice-api-key.json"), cipher: NO_CIPHER }),
    groq: new VoiceApiKeyStore({ path: join(temporary, "groq-api-key.json"), cipher: NO_CIPHER }),
  };
}

/** The cloud speech keys, with none saved: the bench reads with Supertonic only. */
function noSpeechKeys(temporary: string) {
  return {
    elevenlabs: new VoiceApiKeyStore({ path: join(temporary, "speech-elevenlabs-key.json"), cipher: NO_CIPHER }),
    xai: new VoiceApiKeyStore({ path: join(temporary, "speech-xai-key.json"), cipher: NO_CIPHER }),
  };
}

/** Uses the real services: each must stop its host when no request comes for its idle time. */
async function checkIdleStop(modelId: LocalVoiceModelId, temporary: string, clip: Uint8Array, speech: boolean) {
  const exits: { transcription?: Promise<void>; speech?: Promise<void> } = {};
  const transcriptionService = new VoiceTranscriptionService({
    resourcesRoot: RESOURCES_ROOT,
    modelDirectories: MODEL_DIRECTORIES,
    preferences: new VoicePreferenceStore(join(temporary, "voice-preference.json")),
    apiKeys: noDictationKeys(temporary),
    spawnHost: (): VoiceTranscriptionHostProcess => {
      const child = fork(TRANSCRIPTION_HOST, [], {
        execPath: ELECTRON,
        execArgv: ["--import", PCM_FROM_JSON],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        serialization: "json",
        stdio: "inherit",
      });
      const exit = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      exits.transcription = exit;
      return {
        send: (request) => child.send({ ...request, pcm: Array.from(request.pcm) }),
        onResponse: (listener) => child.on("message", (message: unknown) => listener(transcriptionResponse(message))),
        onExit: (listener) => void exit.then(listener),
        kill: () => child.kill(),
      };
    },
    openStreamSocket: openScribeSocket,
  });
  const speechService = new VoiceSpeechService({
    resourcesRoot: RESOURCES_ROOT,
    modelDirectory: join(RESOURCES_ROOT, SUPERTONIC_MODEL_DIRECTORY),
    preferences: new SpeechPreferenceStore(join(temporary, "speech-preference.json")),
    apiKeys: noSpeechKeys(temporary),
    spawnHost: (): VoiceSpeechHostProcess => {
      const child = fork(SPEECH_HOST, [], {
        execPath: ELECTRON,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        serialization: "json",
        stdio: "inherit",
      });
      const exit = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      exits.speech = exit;
      return {
        send: (request) => child.send(request),
        onResponse: (listener) => child.on("message", (message: unknown) => listener(speechResponse(message))),
        onExit: (listener) => void exit.then(listener),
        kill: () => child.kill(),
      };
    },
  });
  try {
    await Effect.runPromise(transcriptionService.setSettings({ modelId, language: "automatic" }));
    const { text } = await Effect.runPromise(transcriptionService.transcribe(wav(clip)));
    if (!exits.transcription) throw new Error("The transcription service started no host.");
    const checks = [exitAfterReply(exits.transcription)];
    if (speech) {
      const audio = await Effect.runPromise(speechService.speak({ text: SPEECH_TEXT, language: "en" }));
      if (!exits.speech || audio.pcm.byteLength === 0) throw new Error("The speech service read nothing aloud.");
      checks.push(exitAfterReply(exits.speech));
    }
    const [transcriptionStopMs, speechStopMs] = await Promise.all(checks);
    return { transcribedText: text, transcriptionStopMs, speechStopMs: speechStopMs ?? null };
  } finally {
    await Effect.runPromise(transcriptionService.shutdown());
    await Effect.runPromise(speechService.shutdown());
  }
}

async function main(): Promise<void> {
  const threads = (option("threads") ?? [...new Set([4, transcriptionHostThreads(), 6, 8])].join(","))
    .split(",")
    .map(Number);
  if (!threads.every((count) => Number.isInteger(count) && count >= 1 && count <= 64))
    throw new Error("--threads takes whole numbers from 1 to 64.");
  const runs = Number(option("runs") ?? "5");
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs takes a whole number of 1 or more.");
  const modelIds = (option("models") ?? "parakeet-tdt-0.6b-v3").split(",");
  const unknown = modelIds.find((modelId) => !isLocalVoiceModelId(modelId));
  if (unknown) throw new Error(`Not a local dictation model: ${unknown}`);
  const configNames = option("configs")
    ?.split(",")
    .map((name) => (name === "default" ? "" : name));
  const unknownConfig = configNames?.find((name) => name !== "" && !(name in VOICE_SESSION_CONFIGS));
  if (unknownConfig !== undefined) throw new Error(`Not a session settings file: ${unknownConfig}`);
  const configs = configNames?.filter(
    (name): name is VoiceSessionConfig => name === "" || name in VOICE_SESSION_CONFIGS,
  );
  const configsFor = (chosen: VoiceSessionConfig): VoiceSessionConfig[] =>
    configs ?? [...new Set<VoiceSessionConfig>(["", chosen])];
  const speech = !process.argv.includes("--no-speech");
  const idle = !process.argv.includes("--no-idle");

  await mkdir(OUTPUT, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "openbot-voice-host-bench-"));
  try {
    // The services download any missing model with the pinned checksums.
    const downloader = new VoiceTranscriptionService({
      resourcesRoot: RESOURCES_ROOT,
      modelDirectories: MODEL_DIRECTORIES,
      preferences: new VoicePreferenceStore(join(temporary, "download-preference.json")),
      apiKeys: noDictationKeys(temporary),
      spawnHost: () => {
        throw new Error("The download needs no host.");
      },
      openStreamSocket: openScribeSocket,
    });
    for (const modelId of modelIds.filter(isLocalVoiceModelId)) {
      const status = await Effect.runPromise(downloader.downloadModel(modelId));
      if (status.phase !== "ready") throw new Error(`${modelId} is not ready: ${status.phase}`);
    }
    if (speech) {
      const speechDownloader = new VoiceSpeechService({
        resourcesRoot: RESOURCES_ROOT,
        modelDirectory: join(RESOURCES_ROOT, SUPERTONIC_MODEL_DIRECTORY),
        preferences: new SpeechPreferenceStore(join(temporary, "download-speech-preference.json")),
        apiKeys: noSpeechKeys(temporary),
        spawnHost: () => {
          throw new Error("The download needs no host.");
        },
      });
      const status = await Effect.runPromise(speechDownloader.downloadModel());
      if (status.phase !== "ready") throw new Error(`The speech model is not ready: ${status.phase}`);
    }

    const clips = new Map<string, Uint8Array>();
    for (const clip of CLIPS) clips.set(clip.name, await spokenPcm(clip.text, temporary));

    const transcription = [];
    for (const modelId of modelIds.filter(isLocalVoiceModelId))
      for (const numThreads of threads)
        for (const sessionConfig of configsFor(TRANSCRIPTION_SESSION_CONFIGS[modelId])) {
          const result = await benchTranscription(modelId, sessionConfig, numThreads, runs, clips);
          transcription.push(result);
          const times = Object.entries(result.decode).map(([name, value]) => `${name} ${value.medianMs} ms`);
          logger.info(
            `${modelId} ${result.sessionConfig} ${numThreads} threads: load ${result.loadMs} ms, ${times.join(", ")}, ${result.residentAfterRunsMb} MB`,
          );
        }

    const synthesis = [];
    if (speech)
      for (const numThreads of threads)
        for (const sessionConfig of configsFor(SPEECH_SESSION_CONFIG)) {
          const result = await benchSpeech(sessionConfig, numThreads, runs);
          synthesis.push(result);
          logger.info(
            `supertonic ${result.sessionConfig} ${numThreads} threads: load ${result.loadMs} ms, ${result.synthesisMedianMs} ms for ${result.audioSeconds} s, ${result.residentAfterRunsMb} MB`,
          );
        }

    let idleStop: Awaited<ReturnType<typeof checkIdleStop>> | null = null;
    if (idle) {
      logger.info("Waiting for the services to stop the idle hosts…");
      // The first requested model is already downloaded, so the check downloads nothing more.
      const idleModel = modelIds.find(isLocalVoiceModelId) ?? "parakeet-tdt-0.6b-v3";
      idleStop = await checkIdleStop(idleModel, temporary, clips.get("short") ?? new Uint8Array(0), speech);
      logger.info(`Idle stop: transcription ${idleStop.transcriptionStopMs} ms, speech ${idleStop.speechStopMs} ms`);
    }

    const report = {
      at: new Date().toISOString(),
      machine: {
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model ?? "",
        availableParallelism: availableParallelism(),
        memoryGb: Math.round(totalmem() / 1024 ** 3),
      },
      runs,
      appSettings: {
        transcriptionThreads: transcriptionHostThreads(),
        transcriptionSessionConfigs: TRANSCRIPTION_SESSION_CONFIGS,
        speechSessionConfig: SPEECH_SESSION_CONFIG,
      },
      clips: CLIPS.map((clip) => ({ name: clip.name, text: clip.text })),
      transcription,
      synthesis,
      idleStop,
    };
    await writeFile(join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    logger.info(`Report: ${join(OUTPUT, "report.json")}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
