// Checks that a Telegram voice note reaches the agent with its transcript. Runs the real Telegram
// driver, messaging service and transcription service (a real local model in the Electron-as-Node
// host) on a temporary profile. A fake relay stands in for Signal. espeak-ng speaks the note and
// ffmpeg makes it OGG/Opus, as Telegram does. Without a transcription, and with a model that is not
// installed or audio that cannot be decoded, the delivery must stay as it was before.
// `bun run voice:prepare-runtime`, then `bun scripts/messaging-voice-transcription-e2e.ts`.
// Writes .openbot-build/messaging-voice-transcription-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AUTOMATIC_VOICE_LANGUAGE, type LocalVoiceModelId } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { MessagingThreads } from "../src/backend/messaging/messaging-threads";
import {
  type IngressHandler,
  MessagingAdapterError,
  type MessagingIngress,
} from "../src/backend/messaging/messaging-types";
import { telegramDriver } from "../src/backend/messaging/telegram/telegram-driver";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { VoiceApiKeyStore } from "../src/main/voice-api-key-store";
import { openScribeSocket } from "../src/main/voice-cloud-stream";
import { transcribeVoiceMessage } from "../src/main/voice-message-transcription";
import {
  BARK_PLUS_MODEL_DIRECTORY,
  COHERE_TRANSCRIBE_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  WHISPER_TURBO_MODEL_DIRECTORY,
} from "../src/main/voice-model-service";
import { VoicePreferenceStore } from "../src/main/voice-preference-store";
import type {
  VoiceTranscriptionFailure,
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionResponse,
} from "../src/main/voice-transcription-protocol";
import { VoiceTranscriptionService } from "../src/main/voice-transcription-service";

const MODEL_ID: LocalVoiceModelId = "parakeet-unified-en-0.6b";
const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-voice-transcription-e2e");
const REPORT = join(OUT, "report.json");
const RESOURCES_ROOT = resolve(".openbot-build/voice");
const HOST = resolve("src/main/voice-transcription-host.ts");
const ELECTRON =
  process.platform === "darwin"
    ? resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : resolve("node_modules/electron/dist/electron");
const PCM_FROM_JSON = `data:text/javascript,process.prependListener("message",(m)=>{if(m&&typeof m==="object"&&Array.isArray(m.pcm))m.pcm=Uint8Array.from(m.pcm)});`;
const FAILURES: readonly VoiceTranscriptionFailure[] = ["runtime-unavailable", "model-load-failed", "inference-failed"];
const MAXIMUM_WORD_ERROR_RATE = 0.15;
const WAIT_MS = 30_000;
const SPOKEN = "Please remind the team that the quarterly budget review moves to Thursday morning.";
const CHAT = "4712001";
const USER = "4712002";
const BOT = "4712999";
const VOICE_NAME = "voice.ogg";

const root = await mkdtemp(join(tmpdir(), "openbot-messaging-voice-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { steps: Step[]; passed: boolean; unverified: string[] } = {
  steps: [],
  passed: false,
  unverified: [
    "The Signal relay socket and the real Telegram download: a fake relay copies the OGG/Opus file that espeak-ng and ffmpeg made.",
    "WhatsApp, Slack and Discord voice notes: they use the same service code path, but this check sends only Telegram updates.",
    "An agent turn: the check reads the delivery that a turn would get, and no provider runs.",
    "The Electron utility process of the app: the host runs in Electron as Node, as in the voice smoke checks.",
  ],
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const entry: Step = { name, passed: false };
  report.steps.push(entry);
  try {
    entry.detail = await run();
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

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

function voiceService(resourcesRoot: string, workDirectory: string): VoiceTranscriptionService {
  const cipher = { canPersist: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" };
  return new VoiceTranscriptionService({
    resourcesRoot,
    modelDirectories: {
      "parakeet-tdt-0.6b-v3": join(resourcesRoot, "model"),
      "parakeet-unified-en-0.6b": join(resourcesRoot, PARAKEET_UNIFIED_MODEL_DIRECTORY),
      "bark-3.0-plus": join(resourcesRoot, BARK_PLUS_MODEL_DIRECTORY),
      "whisper-turbo": join(resourcesRoot, WHISPER_TURBO_MODEL_DIRECTORY),
      "cohere-transcribe-03-2026": join(resourcesRoot, COHERE_TRANSCRIBE_MODEL_DIRECTORY),
    },
    preferences: new VoicePreferenceStore(join(workDirectory, "voice-preference.json")),
    apiKeys: {
      elevenlabs: new VoiceApiKeyStore({ path: join(workDirectory, "voice-api-key.json"), cipher }),
      groq: new VoiceApiKeyStore({ path: join(workDirectory, "groq-api-key.json"), cipher }),
    },
    spawnHost,
    openStreamSocket: openScribeSocket,
  });
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

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

interface RelayCall {
  method: string;
  messageId: number | null;
}

const relayCalls: RelayCall[] = [];
const waiters: Array<{ match: (call: RelayCall) => boolean; resolve: () => void }> = [];
const downloadSources = new Map<string, string>();
let relayHandler: IngressHandler | null = null;

function waitForCall(match: (call: RelayCall) => boolean): Promise<void> {
  if (relayCalls.some(match)) return Promise.resolve();
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("The expected Telegram call did not come.")), WAIT_MS);
    waiters.push({
      match,
      resolve: () => {
        clearTimeout(timer);
        done();
      },
    });
  });
}

let nextPostId = 9000;
const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: (handler) => {
    relayHandler = handler;
  },
  telegram: {
    available: () => true,
    call: (_botId, method, params) =>
      Effect.sync(() => {
        const call: RelayCall = { method, messageId: "message_id" in params ? params.message_id : null };
        relayCalls.push(call);
        for (const waiter of waiters.splice(0)) {
          if (waiter.match(call)) waiter.resolve();
          else waiters.push(waiter);
        }
        if (method === "getFile" && "file_id" in params) return { fileToken: String(params.file_id), fileSize: 1 };
        nextPostId += 1;
        return { messageId: nextPostId };
      }),
    download: (fileToken, destination) =>
      Effect.tryPromise({
        try: async () => {
          const source = downloadSources.get(fileToken);
          if (!source) throw new Error("no_such_file");
          await copyFile(source, destination);
        },
        catch: (cause) => new MessagingAdapterError({ cause }),
      }),
    upload: unused,
  },
  reconnect: () => {},
  discord: unused,
  onDiscordRoutes: () => () => {},
};

function memoryCredentials(): MessagingCredentials {
  const values = new Map<string, Record<string, string>>();
  return {
    keys: () => [...values.keys()],
    status: (connectionId) => (values.has(connectionId) ? "saved" : "missing"),
    get: (connectionId) => values.get(connectionId) ?? null,
    set: (connectionId, value) => Effect.sync(() => void values.set(connectionId, value)),
    clear: (connectionId) => Effect.sync(() => void values.delete(connectionId)),
    retain: (connectionIds) =>
      Effect.sync(() => {
        for (const key of values.keys()) if (!connectionIds.has(key)) values.delete(key);
      }),
  };
}
const credentials = memoryCredentials();

interface Booted {
  messaging: MessagingService;
  mailbox: MailboxStore;
  threads: MessagingThreads;
}

async function boot<T>(
  transcribeAudio: MessagingServiceTranscriber | undefined,
  use: (services: Booted) => Promise<T>,
): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  const threads = new MessagingThreads(store.database, mailbox, {
    schedule: () => {},
    queueChanged: () => {},
    busy: () => false,
    interrupt: unused,
    forgetThread: () => Effect.void,
    ownChat: () => false,
    contextSession: () => null,
    progressUpdates: () => null,
  });
  const messaging = new MessagingService({
    threads,
    agents: {
      listAgents: () => agents.listAgents(),
      respondToApproval: (input) => agents.respondToApproval(input),
      onEvent: () => () => {},
      createAgentProfile: (input) => agents.createAgentProfile(input),
      createMemory: (input) => agents.createMemory(input),
      ensureDeletable: (agentId) => agents.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => agents.deleteAgent(agentId),
      sidebarChatIds: () => agents.sidebarChatIds(),
    },
    credentials,
    drivers: [telegramDriver({ ingress })],
    downloadsRoot: join(userData, "messaging-downloads"),
    ingress,
    sidebar,
    ...(transcribeAudio ? { transcribeAudio } : {}),
  });
  await runCauseEffect(messaging.start());
  try {
    return await use({ messaging, mailbox, threads });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
  }
}

type MessagingServiceTranscriber = ReturnType<typeof transcribeVoiceMessage>;

let nextMessageId = 100;

interface Delivered {
  text: string;
  attachments: string[];
}

async function sendVoiceNote(services: Booted, source: string, label: string): Promise<Delivered> {
  nextMessageId += 1;
  const messageId = nextMessageId;
  const fileId = `voice-file-${label}-${messageId}`;
  downloadSources.set(fileId, source);
  const update = {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1_000),
      chat: { id: Number(CHAT), type: "private", first_name: "Ana" },
      from: { id: Number(USER) + messageId, is_bot: false, first_name: "Ana" },
      voice: { file_id: fileId, file_unique_id: fileId, duration: 5, mime_type: "audio/ogg", file_size: 1 },
    },
  };
  const reacted = waitForCall((call) => call.method === "setMessageReaction" && call.messageId === messageId);
  const handler = relayHandler;
  assert.ok(handler, "The messaging service has no relay handler.");
  const answer = await runCauseEffect(
    handler(CHAT, {
      platform: "telegram",
      botId: BOT,
      body: new TextEncoder().encode(JSON.stringify(update)),
      linked: false,
    }),
  );
  assert.equal(answer.status, 200);
  await reacted;
  const record = services.threads.store.connectionForWorkspace("telegram", CHAT);
  assert.ok(record, "The Telegram connection is missing.");
  const context = services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHAT}:${messageId}`);
  assert.ok(context, "The voice note has no delivery.");
  return {
    text: context.delivery.text,
    attachments: context.managedAttachments.map((attachment) => attachment.name),
  };
}

const TRANSCRIPT_NOTE = /\(Transcript of voice\.ogg: ([\s\S]*)\)$/u;

try {
  await mkdir(OUT, { recursive: true });
  const samples = join(root, "samples");
  await mkdir(samples, { recursive: true });
  const spokenWav = join(samples, "spoken.wav");
  const voiceNote = join(samples, VOICE_NAME);
  const brokenNote = join(samples, "broken.ogg");
  execFileSync("espeak-ng", ["-v", "en-us", "-s", "150", "-w", spokenWav, SPOKEN]);
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    spokenWav,
    "-c:a",
    "libopus",
    "-b:a",
    "24k",
    "-f",
    "ogg",
    voiceNote,
  ]);
  await writeFile(brokenNote, "This is not audio.");

  await boot(undefined, async ({ messaging, threads }) => {
    const record = threads.store.ensureConnection("telegram", CHAT, "Ana");
    threads.store.updateConnection(record.connectionId, { enabled: true });
    await runCauseEffect(
      credentials.set(record.connectionId, {
        botId: BOT,
        chatId: CHAT,
        botUsername: "openbot_e2e_bot",
        chatTitle: "Ana",
      }),
    );
    await runCauseEffect(messaging.addTelegramOrchestrator({}));
  });

  let baseline: Delivered = { text: "", attachments: [] };
  await boot(undefined, async (services) => {
    await step("without a transcriber, the voice note is delivered as an audio file only", async () => {
      baseline = await sendVoiceNote(services, voiceNote, "baseline");
      assert.ok(!baseline.text.includes("Transcript of"), "The baseline delivery has a transcript note.");
      assert.deepEqual(baseline.attachments, [VOICE_NAME]);
      return baseline;
    });
  });

  const missing = await mkdtemp(join(tmpdir(), "openbot-voice-missing-"));
  await mkdir(join(missing, "resources"), { recursive: true });
  await symlink(join(RESOURCES_ROOT, "runtime"), join(missing, "resources", "runtime"));
  const missingModel = voiceService(join(missing, "resources"), missing);
  const readyDirectory = await mkdtemp(join(tmpdir(), "openbot-voice-ready-"));
  const readyModel = voiceService(RESOURCES_ROOT, readyDirectory);
  try {
    await boot(
      transcribeVoiceMessage(() => missingModel),
      async (services) => {
        await step("with no model installed, the delivery is the same as without a transcriber", async () => {
          const status = await Effect.runPromise(missingModel.getModelStatus());
          assert.equal(status.phase, "missing");
          const delivered = await sendVoiceNote(services, voiceNote, "no-model");
          assert.deepEqual(delivered, baseline);
          return { phase: status.phase, delivered };
        });
      },
    );

    const downloaded = await Effect.runPromise(readyModel.downloadModel(MODEL_ID));
    assert.equal(downloaded.phase, "ready", `${MODEL_ID} is not ready: ${downloaded.phase}`);
    await Effect.runPromise(readyModel.setSettings({ modelId: MODEL_ID, language: AUTOMATIC_VOICE_LANGUAGE }));

    await boot(
      transcribeVoiceMessage(() => readyModel),
      async (services) => {
        await step("with a model ready, audio that cannot be decoded is delivered as it was before", async () => {
          const delivered = await sendVoiceNote(services, brokenNote, "broken");
          assert.deepEqual({ ...delivered, attachments: [] }, { ...baseline, attachments: [] });
          assert.ok(!delivered.text.includes("Transcript of"));
          return delivered;
        });

        await step("with a model ready, the agent gets the transcript and the audio file", async () => {
          const delivered = await sendVoiceNote(services, voiceNote, "spoken");
          const transcript = TRANSCRIPT_NOTE.exec(delivered.text)?.[1];
          assert.ok(transcript, `The delivery has no transcript note: ${JSON.stringify(delivered.text)}`);
          const wer = wordErrorRate(SPOKEN, transcript);
          assert.ok(wer <= MAXIMUM_WORD_ERROR_RATE, `The transcript has too many word errors (${wer}): ${transcript}`);
          assert.deepEqual(delivered.attachments, [VOICE_NAME]);
          return { spoken: SPOKEN, transcript, wer, attachments: delivered.attachments };
        });

        await step("two voice notes at once are both transcribed", async () => {
          const [first, second] = await Promise.all([
            sendVoiceNote(services, voiceNote, "first"),
            sendVoiceNote(services, voiceNote, "second"),
          ]);
          for (const delivered of [first, second]) assert.ok(TRANSCRIPT_NOTE.test(delivered.text), delivered.text);
          return { first: first.text, second: second.text };
        });
      },
    );
  } finally {
    await Effect.runPromise(missingModel.shutdown());
    await Effect.runPromise(readyModel.shutdown());
    await rm(missing, { recursive: true, force: true });
    await rm(readyDirectory, { recursive: true, force: true });
  }

  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Voice note transcription check passed. Report: ${REPORT}\n`);
