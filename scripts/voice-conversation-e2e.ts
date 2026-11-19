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
    voiceConversationE2E?: { arm: (streams?: number) => void; calls: () => number; liveTracks: () => number };
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/voice-conversation");
const AGENT = "Chief";
const AGENT_ID = "chief";
const QUESTION = "What is two plus two? Answer in five words or fewer.";
const MAXIMUM_RECORDING_BYTES = 600_000;
const TURN_TIMEOUT_MS = 180_000;
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
    command: "voice-conversation-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: record.instanceId,
  });

const logger = createOpenBotLogger("voice-conversation-e2e");
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
    window.voiceConversationE2E = {
      arm: (streams = 1) => {
        armed = streams;
      },
      calls: () => calls,
      liveTracks: () =>
        streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length,
    };
  }, QUESTION);
}

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

async function openVoicePill(page: Page, streams = 1): Promise<void> {
  const pill = page.locator(".voice-pill-dock");
  if (await pill.count()) {
    await pill.getByRole("button", { name: "End voice conversation", exact: true }).click();
    await pill.waitFor({ state: "detached" });
  }
  await page.evaluate((count) => window.voiceConversationE2E?.arm(count), streams);
  await page.getByRole("button", { name: "Add to prompt", exact: true }).click();
  await page.getByRole("menuitem", { name: "Voice", exact: true }).click();
  await pill.waitFor();
}

async function closeVoicePill(page: Page): Promise<void> {
  const pill = page.locator(".voice-pill-dock");
  if (!(await pill.count())) return;
  await pill.getByRole("button", { name: "End voice conversation", exact: true }).click();
  await pill.waitFor({ state: "detached" });
}

const pillState = (page: Page) =>
  page.evaluate(() => {
    const pill = document.querySelector(".voice-pill-dock");
    return {
      phase: pill?.querySelector(".voice-pill-phase")?.textContent?.trim() ?? null,
      error: pill?.querySelector(".voice-pill-error")?.textContent?.trim() ?? null,
    };
  });

async function waitForPhase(page: Page, phase: string): Promise<string[]> {
  const phases: string[] = [];
  const started = Date.now();
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const state = await pillState(page);
    const label = `${state.phase}${state.error ? ` | ${state.error}` : ""}`;
    if (phases.at(-1) !== label) phases.push(label);
    if (state.phase === phase || state.error) break;
    await page.waitForTimeout(100);
  }
  return phases;
}

async function speakOneTurn(page: Page, name: string) {
  const phases: string[] = [];
  const started = Date.now();
  let spoke = false;
  let error: string | null = null;
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const state = await pillState(page);
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

  await openAgent(host);
  const recordingsBefore = new Set(
    (await hostFiles()).filter((file) => file.mimeType.startsWith("audio/")).map((file) => file.id),
  );
  await openVoicePill(host);
  const local = await speakOneTurn(host, "local");
  report.local = local;
  check("local: the reply is read aloud", local.spoke && local.error === null, local.phases);
  check("local: the spoken message shows a player", local.hasPlayer, local.userMessage);
  await closeVoicePill(host);
  await checkEvent(
    "analytics: the local conversation start is sent",
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
    "analytics: the local conversation end is sent with its turn count",
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

  const remote = (await client.evaluate(() => window.openbot.servers.list())).find(
    (server) => server.kind === "remote" && server.state === "online",
  );
  assert.ok(remote, "The test client has no online remote server.");
  await client.evaluate((id) => window.openbot.servers.select(id), remote.id);
  await openAgent(client);
  const draftsBefore = draftEntries(clientRecord);
  await openVoicePill(client);
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

  if (recording) {
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
      await host.reload();
      await openAgent(host);
      const bubble = host.getByRole("article", { name: "Message from You" }).filter({ hasText: message.text }).last();
      await bubble.waitFor();
      await bubble.getByRole("button", { name: "Play voice message", exact: true }).waitFor({ state: "detached" });
      await host.screenshot({ path: join(OUT, "storage-deleted.png") });
      check("storage: the message keeps its text and has no player", true, message.text);
    }
  }

  await installMicrophone(host);
  await openVoicePill(host, 2);
  const thinking = await waitForPhase(host, "Thinking");
  const byVoice = await waitForPhase(host, "Listening");
  const voiceCalls = await host.evaluate(() => window.voiceConversationE2E?.calls() ?? -1);
  check(
    "interrupt: speech while the agent thinks or speaks interrupts it, on the open microphone",
    byVoice[0] === "Thinking" && byVoice.at(-1) === "Listening",
    { thinking, byVoice },
  );
  const next = await waitForPhase(host, "Thinking");
  await host.waitForFunction(() => window.voiceConversationE2E?.calls() === 3);
  await host.getByRole("button", { name: "Interrupt", exact: true }).click();
  const byButton = await waitForPhase(host, "Listening");
  const buttonCalls = await host.evaluate(() => window.voiceConversationE2E?.calls() ?? -1);
  check(
    "interrupt: the Stop button interrupts the next turn, on the open microphone",
    next.at(-1) === "Thinking" && byButton.at(-1) === "Listening" && !byButton.includes("Speaking"),
    { next, byButton },
  );
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
  await closeVoicePill(host);

  await client.getByText("Listening", { exact: true }).first().waitFor();
  await host.evaluate(() => window.openbot.host.stop());
  hostStopped = true;
  const offlineText = "The server is not connected. The conversation continues when it connects again.";
  await client.locator(".voice-pill-error", { hasText: offlineText }).waitFor({ timeout: 60_000 });
  await client.screenshot({ path: join(OUT, "offline.png") });
  const offline = {
    ...(await pillState(client)),
    ...(await client.evaluate(() => ({
      liveTracks: window.voiceConversationE2E?.liveTracks() ?? -1,
      calls: window.voiceConversationE2E?.calls() ?? -1,
    }))),
  };
  check(
    "offline: the pill says it is not connected and releases the microphone",
    offline.phase === "Not connected" && offline.liveTracks === 0,
    offline,
  );
  await host.evaluate(() => window.openbot.host.start());
  hostStopped = false;
  const later = await client.evaluate(() => ({
    calls: window.voiceConversationE2E?.calls() ?? -1,
    error: document.querySelector(".voice-pill-error")?.textContent?.trim() ?? null,
  }));
  check(
    "offline: the pill does not open the microphone while the server is offline",
    later.calls === offline.calls && later.error === offlineText,
    later,
  );
  await closeVoicePill(client);
  await checkEvent(
    "analytics: the remote conversation end is sent",
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
assert.equal(failed.length, 0, `${failed.length} of ${checks.length} voice conversation checks failed.`);
logger.info(`Passed ${checks.length} voice conversation checks. Wrote ${join(OUT, "report.json")}.`);
