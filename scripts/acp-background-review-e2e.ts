import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { AcpAgentClient } from "../src/backend/acp-client";
import { DEFAULT_ACP_FLAVOR } from "../src/backend/acp-flavor";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";
import { installFakeAgent, runTurn, startThread, stopClients } from "./provider-fakes/host";

const root = await mkdtemp(join(tmpdir(), "openbot-acp-review-"));
const executable = join(root, "bin", "fake-agent");
const workspace = join(root, "workspace");
await mkdir(workspace);
await installFakeAgent(executable, "background-review");
const saved: string[] = [];
const client = new AcpAgentClient({ executable, version: "1", source: "managed" }, 20_000, {
  provider: "opencode",
  flavor: DEFAULT_ACP_FLAVOR,
  argv: [],
  env: {},
  signInMessage: "Sign in",
  allowNoModels: true,
  history: {
    append: (_id, fragment) =>
      Effect.sync(() => {
        saved.push(JSON.stringify(fragment));
      }),
  },
});
try {
  client.start();
  const thread = await startThread(client, { cwd: workspace });
  let resolveNotice!: () => void;
  const notice = new Promise<void>((resolve) => {
    resolveNotice = resolve;
  });
  let text = "";
  client.on("notification", (event: AppServerNotification) => {
    if (event.method !== "item/completed") return;
    const item = getRecord(event.params, "item");
    if (getString(item, "text") === "Skill example patched") {
      text = "Skill example patched";
      resolveNotice();
    }
  });
  const result = await runTurn(client, thread);
  assert.equal(result.reply, "Task done");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      notice,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Review notice did not arrive after the turn")), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(text, "Skill example patched");
  assert.ok(
    saved.some((value) => value.includes("Skill example patched")),
    "Review notice is saved",
  );
  const secondNotice = new Promise<void>((resolve) => {
    client.on("notification", (event: AppServerNotification) => {
      const item = getRecord(event.params, "item");
      if (event.method === "item/completed" && getString(item, "text") === "Skill second patched") resolve();
    });
  });
  const second = await runTurn(client, thread, { text: "during" });
  assert.equal(second.reply, "Second task done");
  try {
    await Promise.race([
      secondNotice,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Review notice during a turn did not arrive")), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.ok(
    saved.some((value) => value.includes("Skill second patched")),
    "Later notice is saved",
  );
  process.stdout.write("ACP background review notification passed\n");
} finally {
  await stopClients([client]);
  await rm(root, { recursive: true, force: true });
}
