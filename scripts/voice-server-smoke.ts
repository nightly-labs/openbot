// Sets up a voice server in Settings → Voice of a running dev app, and checks that dictation and
// spoken replies go to it. The server is a fake OpenAI-compatible server on 127.0.0.1, which this
// script starts: `GET /v1/models`, `GET /v1/audio/voices`, `POST /v1/audio/transcriptions` and
// `POST /v1/audio/speech`, behind a Bearer key.
//   1. Dialog: a wrong key shows its error under the key field; the right key shows both routes;
//      Save shows the server, its models and its voice in the Voice tab.
//   2. Tab: no local dictation model is "In use", the dictation language can be set, and the
//      Supertonic voice row is hidden.
//   3. Main: prepareModel is ready at once, transcribe sends the WAV and the model, and speak sends
//      the model and voice and plays the WAV that comes back. Neither the settings nor a test
//      result holds the key.
//   4. Composer: dictation with a fake microphone puts the server's text in the message field.
//   5. Reverse: "Use" on the local model turns server dictation off; Remove deletes the server.
// The app must have no voice server when the script starts. Needs an English window and
// `--allow-mutations`, because it changes the voice settings.
//
// Run: bun scripts/voice-server-smoke.ts --allow-mutations
// It writes .openbot-build/voice-server-smoke/report.json and screenshots, and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenBotDesktopApi, VoiceServerSettings } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/voice-server-smoke");
const t = translateFor("en");
const KEY = "smoke-voice-key-7f3a";
const TRANSCRIPTION_MODEL = "Systran/faster-whisper-small";
const SPEECH_MODEL = "speaches-ai/Kokoro-82M-v1.0-ONNX";
const VOICES = ["af_heart", "am_adam"];
const TRANSCRIPT = "Voice server smoke transcript";
const SPEECH_RATE = 24_000;
const SPEECH_SAMPLES = 6_000;
/** The name of each "Use" button of a local dictation model. */
const useLabel = new RegExp(
  `^${t("settings.voice.model.useLabel", { name: "\u0000" })
    .split("\u0000")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".+")}$`,
  "u",
);

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

interface ServerRequest {
  method: string;
  path: string;
  authorized: boolean;
  /** For a transcription: the form fields and the size of the file. For speech: the JSON body. */
  body: unknown;
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "voice-server-smoke",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("voice-server-smoke");

/** A WAV file of 16-bit mono samples. */
function wav(samples: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.alloc(44 + samples.byteLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.byteLength, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.byteLength, 40);
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(buffer, 44);
  return Uint8Array.from(buffer);
}

function tone(count: number, sampleRate: number): Int16Array {
  const samples = new Int16Array(count);
  for (let index = 0; index < count; index += 1)
    samples[index] = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 8_000);
  return samples;
}

const requests: ServerRequest[] = [];
const fake = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const authorized = request.headers.get("authorization") === `Bearer ${KEY}`;
    const entry: ServerRequest = { method: request.method, path: url.pathname, authorized, body: null };
    requests.push(entry);
    if (!authorized) return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
    if (request.method === "GET" && url.pathname === "/v1/models")
      return Response.json({
        object: "list",
        data: [
          { id: TRANSCRIPTION_MODEL, object: "model", task: "automatic-speech-recognition" },
          { id: SPEECH_MODEL, object: "model", task: "text-to-speech" },
        ],
      });
    if (request.method === "GET" && url.pathname === "/v1/audio/voices") return Response.json({ voices: VOICES });
    if (request.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
      const form = await request.formData();
      const file = form.get("file");
      entry.body = {
        model: form.get("model"),
        language: form.get("language"),
        responseFormat: form.get("response_format"),
        fileName: file instanceof File ? file.name : null,
        fileType: file instanceof File ? file.type : null,
        fileBytes: file instanceof File ? file.size : 0,
        riff: file instanceof File ? new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4)) : null,
      };
      return Response.json({ text: ` ${TRANSCRIPT} ` });
    }
    if (request.method === "POST" && url.pathname === "/v1/audio/speech") {
      entry.body = await request.json();
      return new Response(wav(tone(SPEECH_SAMPLES, SPEECH_RATE), SPEECH_RATE), {
        headers: { "content-type": "audio/wav" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});
const address = `http://127.0.0.1:${fake.port}/v1`;
const host = `127.0.0.1:${fake.port}`;

const checks: Check[] = [];
const skipped: string[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => {
  checks.push({ name, passed, detail });
  logger.info(`${passed ? "Passed" : "Failed"}: ${name}.`);
};
const lastRequest = (path: string) => requests.findLast((entry) => entry.path === path);
const server = (page: Page) => page.evaluate(() => window.openbot.voice.getServer());

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function settingsTitle(page: Page) {
  return page.getByRole("heading", { level: 1, name: t("app.settingsPage.title"), exact: true });
}

async function openVoiceTab(page: Page) {
  const title = settingsTitle(page);
  if (!(await title.isVisible()))
    await page
      .getByRole("navigation", { name: t("app.rail.label") })
      .getByRole("button", { name: t("app.rail.settings"), exact: true })
      .click();
  await title.waitFor();
  await page.getByRole("tab", { name: t("settings.tab.voice.title"), exact: true }).click();
  await serverSection(page).waitFor();
}

async function closeSettings(page: Page) {
  // A focused settings tab keeps Escape for itself, so Escape goes from the title.
  await settingsTitle(page).focus();
  await page.keyboard.press("Escape");
  await settingsTitle(page).waitFor({ state: "hidden" });
}

function serverSection(page: Page) {
  return page.locator('[data-settings-row="settings.voice.server.section"]');
}

function dialog(page: Page) {
  return page.getByRole("dialog", { name: t("settings.voice.server.dialog.setUpTitle") });
}

async function setUpServer(page: Page) {
  await serverSection(page)
    .getByRole("button", { name: t("settings.voice.server.setUp"), exact: true })
    .click();
  const form = dialog(page);
  await form.waitFor();
  await form.getByLabel(t("settings.voice.server.address")).fill(address);
  await form.getByLabel(t("settings.voice.server.apiKey")).fill("wrong-key");
  await form.getByRole("button", { name: t("settings.voice.server.connect"), exact: true }).click();
  const refused = t("error.voice.server.keyRefused", { host });
  const keyError = form.getByText(refused, { exact: true });
  await keyError.waitFor();
  check("a wrong key shows its error under the key field", await keyError.isVisible(), refused);
  await form.screenshot({ path: resolve(OUT, "dialog-wrong-key.png") });

  await form.getByLabel(t("settings.voice.server.apiKey")).fill(KEY);
  await form.getByRole("button", { name: t("settings.voice.server.connect"), exact: true }).click();
  const routes = form.getByRole("region", { name: t("settings.voice.server.useFor") });
  await routes.waitFor();
  const switches = routes.getByRole("switch");
  await waitFor(
    () => switches.evaluateAll((items) => items.map((item) => item.getAttribute("aria-checked"))),
    (states) => states.length === 2 && states.every((state) => state === "true"),
  );
  const shown = (await routes.innerText()).replace(/\s+/gu, " ");
  check(
    "a server with both routes turns both on, with its first models and voice",
    shown.includes("faster-whisper-small") && shown.includes("Kokoro-82M-v1.0-ONNX") && shown.includes(VOICES[0] ?? ""),
    shown,
  );
  await form.screenshot({ path: resolve(OUT, "dialog-connected.png") });
  await form.getByRole("button", { name: t("common.save"), exact: true }).click();
  await form.waitFor({ state: "hidden" });
}

mkdirSync(OUT, { recursive: true });
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
page.setDefaultTimeout(15_000);
let saved: VoiceServerSettings | null = null;
try {
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en", "Set the app language to English.");
  assert.equal(await server(page), null, "Remove the voice server in Settings → Voice first.");

  // 1. Dialog.
  await openVoiceTab(page);
  await setUpServer(page);
  saved = await waitFor(
    () => server(page),
    (value) => value !== null,
  );
  check(
    "the saved server has both routes, the first models and voice, and a key",
    saved?.address === address &&
      saved.hasApiKey &&
      saved.routes.dictation &&
      saved.routes.speech &&
      saved.routes.transcriptionModel === TRANSCRIPTION_MODEL &&
      saved.routes.speechModel === SPEECH_MODEL &&
      saved.routes.voice === VOICES[0],
    saved,
  );
  check("the saved settings do not hold the key", !JSON.stringify(saved).includes(KEY));
  const summary = (await serverSection(page).innerText()).replace(/\s+/gu, " ");
  check(
    "the Voice tab shows the server, its models and its voice",
    summary.includes(host) &&
      summary.includes(t("settings.voice.server.dictationSummary", { model: "faster-whisper-small" })) &&
      summary.includes(
        t("settings.voice.server.speechSummary", { model: "Kokoro-82M-v1.0-ONNX", voice: VOICES[0] ?? "" }),
      ),
    summary,
  );

  // 2. Tab.
  const badges = await page.getByRole("tabpanel").getByText(t("settings.voice.model.inUse"), { exact: true }).count();
  check("no local dictation model is in use", badges === 0, badges);
  const language = page
    .locator('[data-settings-row="settings.voice.language.title"]')
    .getByRole("button", { name: t("settings.voice.language.title") });
  check("the dictation language can be set for the server", await language.isEnabled());
  const voiceRows = await page.locator('[data-settings-row="settings.voice.speech.voice.title"]').count();
  check("the Supertonic voice row is hidden", voiceRows === 0, voiceRows);
  await page.getByRole("tabpanel").screenshot({ path: resolve(OUT, "voice-tab.png") });

  // 3. Main.
  const prepared = await page.evaluate(() => window.openbot.voice.prepareModel());
  check("the dictation model is ready at once", prepared.phase === "ready", prepared);
  const probe = await page.evaluate((target) => window.openbot.voice.probeServer(target), {
    address,
    apiKey: null,
  });
  check("a test with no key uses the saved key", probe.ok, probe);
  check("a test result does not hold the key", !JSON.stringify(probe).includes(KEY));
  const recording = Array.from(wav(tone(8_000, 16_000), 16_000));
  const transcript = await page.evaluate(
    (audio) => window.openbot.voice.transcribe({ audio: new Uint8Array(audio) }),
    recording,
  );
  const transcription = lastRequest("/v1/audio/transcriptions");
  check("transcribe returns the server's text", transcript.text === TRANSCRIPT, transcript);
  check(
    "transcribe sends the WAV and the model with the key",
    transcription?.authorized === true &&
      JSON.stringify(transcription.body).includes(TRANSCRIPTION_MODEL) &&
      JSON.stringify(transcription.body).includes('"riff":"RIFF"'),
    transcription,
  );
  const speech = await page.evaluate(async () => {
    const audio = await window.openbot.voice.speak({ text: "Hello from the voice server.", language: "en" });
    return { sampleRate: audio.sampleRate, bytes: audio.pcm.byteLength };
  });
  const speechRequest = lastRequest("/v1/audio/speech");
  check(
    "speak plays the server's WAV",
    speech.sampleRate === SPEECH_RATE && speech.bytes === SPEECH_SAMPLES * 2,
    speech,
  );
  check(
    "speak sends the model, the voice and the text with the key",
    speechRequest?.authorized === true &&
      JSON.stringify(speechRequest.body) ===
        JSON.stringify({
          model: SPEECH_MODEL,
          input: "Hello from the voice server.",
          voice: VOICES[0],
          response_format: "wav",
        }),
    speechRequest,
  );

  // 4. Composer.
  await closeSettings(page);
  const before = requests.length;
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      return destination.stream;
    };
  });
  const start = page.getByRole("button", { name: t("composer.voice.start"), exact: true }).first();
  if (await start.isVisible()) {
    await start.click();
    const stop = page.getByRole("button", { name: t("composer.voice.stop"), exact: true }).first();
    await stop.waitFor();
    // The length of the recording is input, not a wait for state.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await stop.click();
    const composer = page.getByRole("textbox").first();
    const text = await waitFor(
      async () => (await composer.innerText().catch(() => "")) || (await composer.inputValue().catch(() => "")),
      (value) => value.includes(TRANSCRIPT),
    );
    const sent = requests.slice(before).filter((entry) => entry.path === "/v1/audio/transcriptions");
    check("composer dictation puts the server's text in the message field", text.includes(TRANSCRIPT), {
      text,
      requests: sent,
    });
    check(
      "composer dictation sends one recording and no live preview",
      sent.length === 1,
      sent.map((entry) => entry.body),
    );
    await page.screenshot({ path: resolve(OUT, "composer.png") });
    // Leave the message field as it was.
    await composer.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
  } else check("composer dictation", false, "Open a chat in the dev app first: no voice button is visible.");

  // 5. Reverse.
  await openVoiceTab(page);
  // Edit: the dialog tests the saved server again with the saved key, and dictation turns off.
  await serverSection(page)
    .getByRole("button", { name: t("common.edit"), exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: t("settings.voice.server.dialog.editTitle") });
  const dictationSwitch = edit.getByRole("switch", { name: t("settings.voice.server.route.dictation"), exact: true });
  await dictationSwitch.and(page.locator(":enabled")).waitFor();
  // The input is under the switch's control, so the keyboard turns it.
  await dictationSwitch.focus();
  await page.keyboard.press("Space");
  await waitFor(
    () => dictationSwitch.getAttribute("aria-checked"),
    (state) => state === "false",
  );
  await edit.screenshot({ path: resolve(OUT, "dialog-edit.png") });
  await edit.getByRole("button", { name: t("common.save"), exact: true }).click();
  await edit.waitFor({ state: "hidden" });
  const afterEdit = await waitFor(
    () => server(page),
    (value) => value?.routes.dictation === false,
  );
  check(
    "Edit turns server dictation off, and keeps spoken replies and the saved key",
    afterEdit?.routes.dictation === false && afterEdit.routes.speech && afterEdit.hasApiKey,
    afterEdit,
  );
  const summaryAfterEdit = (await serverSection(page).innerText()).replace(/\s+/gu, " ");
  check(
    "the Voice tab no longer shows server dictation",
    !summaryAfterEdit.includes(t("settings.voice.server.dictationSummary", { model: "faster-whisper-small" })),
    summaryAfterEdit,
  );

  // Use: needs a local model that is ready. A fresh dev profile has none, so the step is then skipped.
  const use = page.locator('[data-settings-row="settings.voice.models.title"]').getByRole("button", { name: useLabel });
  if (afterEdit && (await use.count()) > 0) {
    // Server dictation on again, so that Use has something to turn off.
    await page.evaluate((current) => window.openbot.voice.setServer({ server: { ...current, apiKey: null } }), {
      address: afterEdit.address,
      routes: { ...afterEdit.routes, dictation: true },
    });
    await use.first().click();
    const afterUse = await waitFor(
      () => server(page),
      (value) => value?.routes.dictation === false,
    );
    check(
      "Use on a local model turns server dictation off and keeps spoken replies",
      afterUse?.routes.dictation === false && afterUse.routes.speech && afterUse.hasApiKey,
      afterUse,
    );
  } else skipped.push("Use on a local model: no local dictation model is ready in this dev profile.");
  await serverSection(page)
    .getByRole("button", { name: t("common.remove"), exact: true })
    .click();
  const removed = await waitFor(
    () => server(page),
    (value) => value === null,
  );
  check("Remove deletes the server", removed === null, removed);
  saved = removed;
  await page.getByRole("tabpanel").screenshot({ path: resolve(OUT, "voice-tab-removed.png") });
  await closeSettings(page);
} finally {
  // Leave no server and no open dialog behind, also after a failure.
  const open = page.getByRole("dialog").getByRole("button", { name: t("common.close"), exact: true });
  if (await open.isVisible().catch(() => false)) await open.click().catch(() => undefined);
  if (saved !== null)
    await page.evaluate(() => window.openbot.voice.setServer({ server: null })).catch(() => undefined);
  await session.close();
  await fake.stop(true);
}

const failures = checks.filter((entry) => !entry.passed);
writeFileSync(
  resolve(OUT, "report.json"),
  `${JSON.stringify({ address, checks, failures, skipped, requests: requests.map(({ body: _body, ...entry }) => entry) }, null, 2)}\n`,
);
logger.info(`${checks.length - failures.length}/${checks.length} checks passed, ${skipped.length} skipped`);
if (failures.length > 0) {
  logger.error("the voice server smoke failed", failures);
  process.exitCode = 1;
}
