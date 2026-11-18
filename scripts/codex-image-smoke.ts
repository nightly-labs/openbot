// Runs one real Codex turn with the OpenBot thread settings and asks for one image. It checks that
// `codex app-server` sends an `imageGeneration` item that the backend can store: a file in
// `saved_path`, or the image data in `result` (`image-generation.ts`). Runs the real
// `codex app-server` with a copy of the user's Codex login (see `codex-agent-harness.ts`).
// Costs one GPT-6 Luna turn with one image. `bun scripts/codex-image-smoke.ts`; `--model=<id>`
// replaces GPT-6 Luna. Writes .openbot-build/codex-image-smoke/report.json and a copy of the image.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeGeneratedImage, generatedImageName } from "../src/backend/agent/image-generation";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getRecord, getString, isRecord } from "../src/backend/protocol";
import { makeCodexHome, makeGitWorkspace, openbotConfig, removeRun, startCodexAgent } from "./codex-agent-harness";

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const MODEL = argument("model") ?? "gpt-6-luna";
const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-image-smoke");
const PROMPT =
  "Generate one square image of a red apple on a white table with your image generation tool. Then reply DONE.";

interface ImageItem {
  event: string;
  status: string | null;
  savedPath: string | null;
  resultBytes: number;
  revisedPrompt: string | null;
}

const report: {
  passed: boolean;
  model: string;
  items: ImageItem[];
  copy?: string;
  bytes?: number;
  error?: string;
} = { passed: false, model: MODEL, items: [] };

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-codex-image-smoke-")));
const workspace = join(root, "ws");
await makeGitWorkspace(workspace);
const home = await makeCodexHome(join(root, "home"));
const cli = await runCauseEffect(resolveCodexCli());
const agent = await startCodexAgent(cli, home, workspace);
/** The last completed image item. The notification handler sets it. */
const completed: { image: { savedPath: string | null; result: string | null } | null } = { image: null };
agent.client.on("notification", (notification) => {
  if (notification.method !== "item/started" && notification.method !== "item/completed") return;
  const item = isRecord(notification.params) ? getRecord(notification.params, "item") : null;
  if (!item || (item.type !== "imageGeneration" && item.type !== "image_generation_call")) return;
  const result = getString(item, "result");
  report.items.push({
    event: notification.method,
    status: getString(item, "status"),
    savedPath: getString(item, "saved_path") ?? getString(item, "savedPath"),
    resultBytes: result?.length ?? 0,
    revisedPrompt: getString(item, "revised_prompt") ?? getString(item, "revisedPrompt"),
  });
  if (notification.method === "item/completed")
    completed.image = { savedPath: getString(item, "saved_path") ?? getString(item, "savedPath"), result };
});

try {
  const thread = await agent.startThread(workspace, MODEL, openbotConfig(agent.read));
  await agent.runTurn(thread.id, PROMPT, 300_000);
  const done = completed.image;
  if (!done) throw new Error("Codex sent no completed imageGeneration item.");
  mkdirSync(OUT, { recursive: true });
  if (done.savedPath && existsSync(done.savedPath)) {
    report.copy = join(OUT, generatedImageName(done.savedPath));
    copyFileSync(done.savedPath, report.copy);
  } else if (done.result) {
    const bytes = decodeGeneratedImage(done.result);
    report.copy = join(OUT, "generated-image.png");
    writeFileSync(report.copy, bytes);
    report.bytes = bytes.byteLength;
  } else throw new Error("The imageGeneration item has no file and no image data.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await agent.stop();
  await removeRun(root);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "Passed" : `Failed: ${report.error}`}\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.passed ? 0 : 1);
