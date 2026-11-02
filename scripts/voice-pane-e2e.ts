// Drives the Voice pane in this worktree's two-client harness (`bun run dev:test-client`). The
// microphone is a fake: the app's own speech model says a question, and getUserMedia plays it once.
//   1. Local: the host app talks to its Chief agent. The message keeps a WebM/Opus recording and
//      shows a player; the reply is read aloud.
//   2. Remote: the test client talks to the same agent through the host server. Only the text goes;
//      no player, and no recording draft stays on the client.
//   3. Storage: the host lists the recording and deletes it; the message keeps its text, no player.
//   4. Interrupt: the host's microphone stays open while the agent thinks and speaks. The question
//      said again interrupts the agent and becomes the next turn; then the Stop button interrupts it.
//      Neither interrupt opens the microphone again.
//   5. Offline: the host stops serving. The client's pane releases the microphone, shows the offline
//      error and does not listen. The client stays disconnected after this case: run
//      `bun run dev:stop` and `bun run dev:test-client` before the next run.
//   6. Analytics: each window's OpenPanel requests are captured. The pane, turn and spoken reply
//      events arrive with their metadata, and no request holds what the user said.
// Start the harness with the capture address, then run the script with `--allow-mutations`:
//   OPENBOT_ANALYTICS_CAPTURE_URL=http://localhost:47322 bun run dev:test-client
//   bun scripts/voice-pane-e2e.ts --allow-mutations
// Writes .openbot-build/voice-pane/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { OpenBotDesktopApi, StoredFileRow } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { ANALYTICS_GENERATIONS } from "@openbot/telemetry";
import type { Page } from "playwright-core";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
    voicePaneE2E?: { arm: (streams?: number) => void; calls: () => number; liveTracks: () => number };
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/voice-pane");
const AGENT = "Chief";
const AGENT_ID = "chief";
const QUESTION = "What is two plus two? Answer in five words or fewer.";
/** 120 s of Opus at 32 kbps is about 480 KB; a short question must stay far below this. */
const MAXIMUM_RECORDING_BYTES = 600_000;
const TURN_TIMEOUT_MS = 180_000;
/** The app sends analytics here only when it starts with this capture address; no server listens on it. */
const ANALYTICS_URL = "http://localhost:47322";
const EVENT_TIMEOUT_MS = 15_000;

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

const records = readDevInstanceRecords().filter((record) => resolve(record.projectRoot) === resolve(process.cwd()));
const hostRecord = records.find((record) => record.service === "app");
const clientRecord = records.find((record) => record.service === "test-client");
assert.ok(hostRecord && clientRecord, "Start `bun run dev:test-client` for this worktree first.");
for (const record of [hostRecord, clientRecord])
  assertMutationAllowed({
    command: "voice-pane-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: record.instanceId,
  });

const logger = createOpenBotLogger("voice-pane-e2e");
const connect = (record: DevInstanceRecord) =>
  connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
  });
const hostSession = await connect(hostRecord);
const clientSession = await connect(clientRecord);
const host = hostSession.page;
const client = clientSession.page;
for (const page of [host, client]) page.setDefaultTimeout(30_000);

mkdirSync(OUT, { recursive: true });
const checks: Check[] = [];
type Turn = Awaited<ReturnType<typeof speakOneTurn>>;
// The body comes from `JSON.parse`, so every value is JSON. `z.json()` in a record makes TypeScript 7.1
// report TS5115.
const trackBody = z.object({
  type: z.literal("track"),
  payload: z.object({ name: z.string(), properties: z.record(z.string(), z.unknown()) }),
});
type EventProperties = z.infer<typeof trackBody>["payload"]["properties"];
interface AnalyticsEvent {
  window: "host" | "client";
  name: string;
  properties: EventProperties;
}
const events: AnalyticsEvent[] = [];
/** Every analytics request body, to check that none holds what the user said. */
const analyticsBodies: string[] = [];
const report: {
  checks: Check[];
  local?: Turn;
  remote?: Turn;
  recording?: StoredFileRow | null;
  analytics: AnalyticsEvent[];
} = { checks, analytics: events };
const check = (name: string, passed: boolean, detail: unknown = null) => {
  checks.push({ name, passed, detail });
  logger.info(`${passed ? "Passed" : "Failed"}: ${name}.`);
};

/** A fake microphone. `arm(n)` makes each of the next `n` streams say the question once; others are silent. */
async function installMicrophone(page: Page): Promise<void> {
  await page.evaluate(async (text) => {
    const speech = await window.openbot.voice.speak({ text, language: "en" });
    const context = new AudioContext();
    const samples = new Int16Array(speech.pcm.buffer, speech.pcm.byteOffset, speech.pcm.byteLength / 2);
    const buffer = context.createBuffer(1, samples.length, speech.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = (samples[index] ?? 0) / 32_768;
    let armed = 0;
    let calls = 0;
    const streams: MediaStream[] = [];
    navigator.mediaDevices.getUserMedia = async () => {
      calls += 1;
      await context.resume();
      const destination = context.createMediaStreamDestination();
      if (armed > 0) {
        armed -= 1;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        source.start(context.currentTime + 0.8);
      }
      streams.push(destination.stream);
      return destination.stream;
    };
    window.voicePaneE2E = {
      arm: (streams = 1) => {
        armed = streams;
      },
      calls: () => calls,
      liveTracks: () =>
        streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length,
    };
  }, QUESTION);
}

/** Answers the window's OpenPanel requests in the page and keeps each event. */
async function captureAnalytics(page: Page, window: AnalyticsEvent["window"]): Promise<void> {
  const info = await page.evaluate(() => globalThis.window.openbot.getAppInfo());
  assert.equal(
    info.analyticsCaptureUrl,
    ANALYTICS_URL,
    `Start the harness with OPENBOT_ANALYTICS_CAPTURE_URL=${ANALYTICS_URL} bun run dev:test-client.`,
  );
  await page.route(`${ANALYTICS_URL}/**`, async (route) => {
    const body = route.request().postData() ?? "";
    if (body) {
      analyticsBodies.push(body);
      const parsed = trackBody.safeParse(JSON.parse(body));
      if (parsed.success)
        events.push({ window, name: parsed.data.payload.name, properties: parsed.data.payload.properties });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      body: "{}",
    });
  });
}

/** Waits for an event that the app sends after a state the script already waited for. */
async function waitForEvent(
  window: AnalyticsEvent["window"],
  name: string,
  match: (properties: EventProperties) => boolean,
): Promise<AnalyticsEvent | null> {
  const deadline = Date.now() + EVENT_TIMEOUT_MS;
  for (;;) {
    const event = events.find((entry) => entry.window === window && entry.name === name && match(entry.properties));
    if (event || Date.now() > deadline) return event ?? null;
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function checkEvent(
  label: string,
  window: AnalyticsEvent["window"],
  name: string,
  match: (properties: EventProperties) => boolean,
): Promise<void> {
  const event = await waitForEvent(window, name, match);
  check(label, event !== null, event ?? events.filter((entry) => entry.window === window && entry.name === name));
}

const isDuration = (value: unknown) => typeof value === "number" && value > 0;

async function openAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${AGENT},`) }).click();
  await page.getByRole("heading", { name: AGENT, level: 1 }).waitFor();
}

async function openVoicePane(page: Page, streams = 1): Promise<void> {
  const panel = page.locator(".voice-panel");
  if (await panel.count()) {
    await panel.getByRole("button", { name: "End voice conversation", exact: true }).click();
    await panel.waitFor({ state: "detached" });
  }
  await page.evaluate((count) => window.voicePaneE2E?.arm(count), streams);
  await page.getByRole("button", { name: "Add to prompt", exact: true }).click();
  await page.getByRole("menuitem", { name: "Voice", exact: true }).click();
  await panel.waitFor();
}

async function closeVoicePane(page: Page): Promise<void> {
  const panel = page.locator(".voice-panel");
  if (!(await panel.count())) return;
  await panel.getByRole("button", { name: "End voice conversation", exact: true }).click();
  await panel.waitFor({ state: "detached" });
}

const paneState = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".voice-panel");
    return {
      phase: panel?.querySelector(".voice-panel-phase")?.textContent?.trim() ?? null,
      error: panel?.querySelector(".voice-panel-error")?.textContent?.trim() ?? null,
    };
  });

/** Waits until the pane shows `phase` or an error. Returns each phase it showed, in sequence. */
async function waitForPhase(page: Page, phase: string): Promise<string[]> {
  const phases: string[] = [];
  const started = Date.now();
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const state = await paneState(page);
    const label = `${state.phase}${state.error ? ` | ${state.error}` : ""}`;
    if (phases.at(-1) !== label) phases.push(label);
    if (state.phase === phase || state.error) break;
    await page.waitForTimeout(100);
  }
  return phases;
}

/** Waits for one spoken turn after `openVoicePane`: the reply is read aloud, then the pane listens again. */
async function speakOneTurn(page: Page, name: string) {
  const phases: string[] = [];
  const started = Date.now();
  let spoke = false;
  let error: string | null = null;
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const state = await paneState(page);
    const label = `${state.phase}${state.error ? ` | ${state.error}` : ""}`;
    if (phases.at(-1)?.endsWith(label) !== true) phases.push(`${Date.now() - started}ms ${label}`);
    if (state.phase === "Speaking" && !spoke) {
      spoke = true;
      await page.screenshot({ path: join(OUT, `${name}-speaking.png`) });
    }
    if (state.error) {
      error = state.error;
      break;
    }
    if (spoke && state.phase === "Listening") break;
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: join(OUT, `${name}-end.png`) });
  // The test client shows its own message under its account name, not "You".
  const mine = page.getByRole("article", { name: new RegExp(`^Message from (?!${AGENT}$)`) }).last();
  return {
    phases,
    spoke,
    error,
    userMessage: (await mine.textContent())?.trim() ?? null,
    hasPlayer: (await mine.getByRole("button", { name: "Play voice message", exact: true }).count()) > 0,
  };
}

async function hostFiles(): Promise<StoredFileRow[]> {
  const usage = await host.evaluate(() => window.openbot.storage.getUsage({ scope: "host", force: true }, "local"));
  return usage?.files ?? [];
}

function draftEntries(record: DevInstanceRecord): string[] {
  const directory = join(homedir(), "Library", "Application Support", record.profile, "attachment-drafts");
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

let hostStopped = false;
try {
  await captureAnalytics(host, "host");
  await captureAnalytics(client, "client");
  await installMicrophone(host);
  await installMicrophone(client);

  // 1. Local.
  await openAgent(host);
  const recordingsBefore = new Set(
    (await hostFiles()).filter((file) => file.mimeType.startsWith("audio/")).map((file) => file.id),
  );
  await openVoicePane(host);
  const local = await speakOneTurn(host, "local");
  report.local = local;
  check("local: the reply is read aloud", local.spoke && local.error === null, local.phases);
  check("local: the spoken message shows a player", local.hasPlayer, local.userMessage);
  await closeVoicePane(host);
  await checkEvent(
    "analytics: the local pane start is sent",
    "host",
    "voice_conversation_action",
    (event) => event.action === "start" && event.result === "succeeded" && event.server_kind === "local",
  );
  await checkEvent(
    "analytics: the local turn is sent with its kept recording",
    "host",
    "voice_turn",
    (event) =>
      event.result === "succeeded" &&
      event.server_kind === "local" &&
      event.recording_kept === true &&
      isDuration(event.audio_duration_seconds) &&
      isDuration(event.duration_ms),
  );
  await checkEvent(
    "analytics: the spoken reply is sent with its first audio time",
    "host",
    "speech_reply",
    (event) =>
      event.trigger === "voice_conversation" &&
      event.result === "succeeded" &&
      event.completed === true &&
      isDuration(event.first_audio_ms) &&
      isDuration(event.audio_duration_seconds),
  );
  await checkEvent(
    "analytics: the local pane end is sent with its turn count",
    "host",
    "voice_conversation_action",
    (event) => event.action === "end" && event.turn_count === 1 && isDuration(event.duration_ms),
  );
  const recording = (await hostFiles()).find(
    (file) => file.mimeType.startsWith("audio/") && !recordingsBefore.has(file.id),
  );
  report.recording = recording ?? null;
  check(
    "local: the recording is WebM/Opus and small",
    recording?.name === "voice.webm" && recording.mimeType === "audio/webm" && recording.size < MAXIMUM_RECORDING_BYTES,
    recording && { name: recording.name, mimeType: recording.mimeType, size: recording.size },
  );

  // 2. Remote.
  const remote = (await client.evaluate(() => window.openbot.servers.list())).find(
    (server) => server.kind === "remote" && server.state === "online",
  );
  assert.ok(remote, "The test client has no online remote server.");
  await client.evaluate((id) => window.openbot.servers.select(id), remote.id);
  await openAgent(client);
  const draftsBefore = draftEntries(clientRecord);
  await openVoicePane(client);
  const remoteTurn = await speakOneTurn(client, "remote");
  report.remote = remoteTurn;
  check("remote: the reply is read aloud", remoteTurn.spoke && remoteTurn.error === null, remoteTurn.phases);
  check("remote: the message has text and no player", !remoteTurn.hasPlayer, remoteTurn.userMessage);
  await checkEvent(
    "analytics: the remote turn is sent with no kept recording",
    "client",
    "voice_turn",
    (event) => event.result === "succeeded" && event.server_kind === "remote" && event.recording_kept === false,
  );
  const draftsAfter = draftEntries(clientRecord);
  check(
    "remote: no recording draft stays on the client",
    draftsAfter.filter((entry) => !draftsBefore.includes(entry)).length === 0,
    { draftsBefore, draftsAfter },
  );

  // 3. Storage: delete the local recording.
  if (recording) {
    // A Storage row has a message id only for a thread placement, so find the message by its recording.
    const page = await host.evaluate(
      (id) =>
        window.openbot.agent.readConversationPage({ agentId: id, anchor: { type: "latest" }, limit: 20 }, "local"),
      AGENT_ID,
    );
    const message = page.messages.find((candidate) => candidate.voiceRecording?.id === recording.id);
    check("storage: the recording belongs to the spoken message", message !== undefined, recording.id);
    await host.evaluate((fileId) => window.openbot.storage.deleteFile({ fileId }, "local"), recording.id);
    const listed = (await hostFiles()).some((file) => file.id === recording.id);
    check("storage: the deleted recording is no longer listed", !listed);
    const url = recording.previewUrl;
    const status = url ? await host.evaluate(async (target) => (await fetch(target)).status, url) : null;
    check("storage: the recording file is gone", status === 404, { status });
    if (message) {
      // The chat history keeps the message as it was sent; the bubble hides the player of a gone file.
      await host.reload();
      await openAgent(host);
      const bubble = host.getByRole("article", { name: "Message from You" }).filter({ hasText: message.text }).last();
      await bubble.waitFor();
      await bubble.getByRole("button", { name: "Play voice message", exact: true }).waitFor({ state: "detached" });
      await host.screenshot({ path: join(OUT, "storage-deleted.png") });
      check("storage: the message keeps its text and has no player", true, message.text);
    }
  }

  // 4. Interrupt. The first stream says the question; the second, opened while the agent thinks, says
  // it again. A fast reply can start before it: the interrupt event shows that the voice stopped it. The storage case reloaded the host, which removed its microphone.
  await installMicrophone(host);
  await openVoicePane(host, 2);
  const thinking = await waitForPhase(host, "Thinking");
  const byVoice = await waitForPhase(host, "Listening");
  const voiceCalls = await host.evaluate(() => window.voicePaneE2E?.calls() ?? -1);
  check(
    "interrupt: speech while the agent thinks or speaks interrupts it, on the open microphone",
    byVoice[0] === "Thinking" && byVoice.at(-1) === "Listening",
    { thinking, byVoice },
  );
  // The next turn is short: the click must come while the agent thinks, before any event check waits.
  const next = await waitForPhase(host, "Thinking");
  // The microphone opens again after the send. The click waits for it, so the Stop button finds it open.
  await host.waitForFunction(() => window.voicePaneE2E?.calls() === 3);
  await host.getByRole("button", { name: "Interrupt", exact: true }).click();
  const byButton = await waitForPhase(host, "Listening");
  const buttonCalls = await host.evaluate(() => window.voicePaneE2E?.calls() ?? -1);
  check(
    "interrupt: the Stop button interrupts the next turn, on the open microphone",
    next.at(-1) === "Thinking" && byButton.at(-1) === "Listening" && !byButton.includes("Speaking"),
    { next, byButton },
  );
  // The listening turn, the one open while the agent thought, and the one open while it thought again.
  check("interrupt: no interrupt opens the microphone again", voiceCalls === 2 && buttonCalls === 3, {
    voiceCalls,
    buttonCalls,
  });
  await checkEvent(
    "analytics: the interrupt by voice is sent",
    "host",
    "voice_conversation_action",
    (event) => event.action === "interrupt" && event.trigger === "voice" && event.server_kind === "local",
  );
  await checkEvent(
    "analytics: the interrupt by the Stop button is sent",
    "host",
    "voice_conversation_action",
    (event) => event.action === "interrupt" && event.trigger === "button" && event.server_kind === "local",
  );
  await closeVoicePane(host);

  // 5. Offline. The client's pane listens; the host stops serving. The dev client reaches the host
  // through a local API port that a restarted host does not open again, so the client stays
  // disconnected after this case, and the return to online is not checked here.
  await client.getByText("Listening", { exact: true }).first().waitFor();
  await host.evaluate(() => window.openbot.host.stop());
  hostStopped = true;
  const offlineText = "The server is not connected. The conversation continues when it connects again.";
  await client.locator(".voice-panel-error", { hasText: offlineText }).waitFor({ timeout: 60_000 });
  await client.screenshot({ path: join(OUT, "offline.png") });
  const offline = {
    ...(await paneState(client)),
    ...(await client.evaluate(() => ({
      liveTracks: window.voicePaneE2E?.liveTracks() ?? -1,
      calls: window.voicePaneE2E?.calls() ?? -1,
    }))),
  };
  check(
    "offline: the pane says it is not connected and releases the microphone",
    offline.phase === "Not connected" && offline.liveTracks === 0,
    offline,
  );
  await host.evaluate(() => window.openbot.host.start());
  hostStopped = false;
  const later = await client.evaluate(() => ({
    calls: window.voicePaneE2E?.calls() ?? -1,
    error: document.querySelector(".voice-panel-error")?.textContent?.trim() ?? null,
  }));
  check(
    "offline: the pane does not open the microphone while the server is offline",
    later.calls === offline.calls && later.error === offlineText,
    later,
  );
  await closeVoicePane(client);
  await checkEvent(
    "analytics: the remote pane end is sent",
    "client",
    "voice_conversation_action",
    (event) => event.action === "end" && event.server_kind === "remote",
  );
  const said = analyticsBodies.filter((body) => body.toLowerCase().includes("two plus two"));
  check("analytics: no request holds what the user said", said.length === 0, said);
  const versions = [
    ...new Set(
      events
        .filter((event) => /^(?:voice_conversation_action|voice_turn|speech_reply)$/u.test(event.name))
        .map((event) => event.properties.event_schema_version),
    ),
  ];
  check(
    `analytics: voice events use desktop schema ${ANALYTICS_GENERATIONS.desktop}`,
    versions.length === 1 && versions[0] === ANALYTICS_GENERATIONS.desktop,
    versions,
  );
} finally {
  if (hostStopped) await host.evaluate(() => window.openbot.host.start()).catch(() => undefined);
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await hostSession.close();
  await clientSession.close();
}
const failed = checks.filter((item) => !item.passed);
for (const item of failed) logger.error(`Failed: ${item.name}.`, { detail: item.detail });
assert.equal(failed.length, 0, `${failed.length} of ${checks.length} voice pane checks failed.`);
logger.info(`Passed ${checks.length} voice pane checks. Wrote ${join(OUT, "report.json")}.`);
