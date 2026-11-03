// Explicit live-account acceptance through the named Electron app, real WebRTC and prerecorded audio.
// No physical microphone is opened. Only verdicts, counts and transport metadata enter the report.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isRealtimeVoiceIdentifier } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "allow-live-subscription": { type: "boolean" },
    instance: { type: "string" },
    agent: { type: "string" },
    name: { type: "string" },
    "history-canary": { type: "string" },
    audio: { type: "string", multiple: true },
  },
  strict: true,
});
if (
  !values["allow-live-subscription"] ||
  !values.instance ||
  !values.agent ||
  !values.name ||
  values.audio?.length !== 2
)
  throw new Error(
    "Pass --allow-live-subscription --instance=<id> --agent=<id> --name=<name> --audio=<identity-question.wav> --audio=<follow-up.wav>. This uses the signed-in local host's subscription and saves call context.",
  );
if (!isRealtimeVoiceIdentifier(values.agent) || values.name.length > 128)
  throw new Error("Invalid test agent identity.");
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = readDevInstanceRecords().find(
  (record) => record.projectRoot === projectRoot && record.service === "app" && record.instanceId === values.instance,
);
if (!instance) throw new Error("The named app is not a live instance of this checkout.");
assertMutationAllowed({
  command: "live subscription voice acceptance",
  allowMutations: true,
  instanceNamed: true,
  target: instance.instanceId,
});
const waves = [];
for (const path of values.audio) {
  const bytes = await readFile(path);
  if (
    bytes.length > 2 * 1024 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Use two WAV identity questions under 2 MiB each.");
  waves.push(bytes.toString("base64"));
}
const probe = await readFile(new URL("./fixtures/subscription-voice-live-probe.js", import.meta.url), "utf8");
const session = await connectToDevApp(
  instance.remoteDebuggingPort,
  createOpenBotLogger("voice-live-e2e", () => {}, "error"),
  { expectedRendererPort: instance.rendererPort, ownerPid: instance.pid },
);
try {
  const result = await session.page.evaluate(
    `(${probe})(${JSON.stringify({ waves, agentId: values.agent, expectedName: values.name, historyCanary: values["history-canary"] })})`,
  );
  if (!isDynamicRecord(result) || !Array.isArray(result.answers)) throw new Error("Invalid voice acceptance result.");
  const passed =
    result.error === undefined &&
    isDynamicRecord(result.startup) &&
    result.startup.greeted === true &&
    result.startup.selectedAgent === true &&
    result.startup.historyReplayed === false &&
    result.startup.delegated === 0 &&
    result.answers.length === 2 &&
    result.answers.every(
      (answer) =>
        isDynamicRecord(answer) &&
        answer.userTurnCaptured === true &&
        answer.selectedAgent === true &&
        answer.chatGPTSelf === false,
    );
  const output = join(projectRoot, ".openbot-build/subscription-voice-live-e2e");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "report.json"), `${JSON.stringify({ passed, ...result }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed, report: join(output, "report.json") })}\n`);
  assert.ok(passed, "Both spoken identity questions must reach the selected agent and retain its identity.");
} finally {
  await session.close();
}
