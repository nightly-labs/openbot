// Adapted from the reproduction in nightly-labs/openbot#1824.
// A custom ACP agent whose interpreter is only on the user's login-shell PATH, with OpenBot started
// the way Finder, the Dock or a login item starts it: PATH=/usr/bin:/bin:/usr/sbin:/sbin.
// Most ACP adapters are `#!/usr/bin/env node` scripts and Node comes from Homebrew, nvm or mise, so
// this is the normal macOS setup. Both ways the agent starts must work: Check agent, and the `acp`
// provider driver that lists its models. `bun run test:custom-agents:login-path`; exit 0 = both
// worked. Writes .openbot-build/custom-acp-agent-login-path-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import type { AgentClient } from "../src/backend/agent-client";
import { runInLoginShell } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { createCustomAgentChanges } from "../src/main/custom-agent-changes";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { stopClients, xorCipher } from "./provider-fakes/host";

// The interpreter has a name no system folder holds, so the result does not depend on whether this
// machine also has a `node` in /usr/bin.
const INTERPRETER = "openbot-login-path-node";

const FAKE_AGENT = `#!/usr/bin/env ${INTERPRETER}
const NL = String.fromCharCode(10);
let buffer = "";
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: "fake", version: "1.0.0" }, agentCapabilities: {} } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: { sessionId: "s-1", models: { availableModels: [{ modelId: "fast", name: "Fast" }], currentModelId: "fast" } } });
    return;
  }
  write({ id: message.id, result: {} });
}
setInterval(() => {}, 1000);
`;

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-acp-agent-login-path-e2e");
const report: { passed: boolean; check?: unknown; models?: unknown; error?: string } = { passed: false };

const root = await mkdtemp(join(tmpdir(), "openbot-login-path-e2e-"));
const clients: AgentClient[] = [];
let passed = false;

try {
  // The user's login shell puts a tool folder on PATH, as Homebrew's `brew shellenv` or nvm does.
  const home = join(root, "home");
  const tools = join(home, "tools");
  await mkdir(tools, { recursive: true });
  await symlink(process.execPath, join(tools, INTERPRETER));
  const profile = `export PATH="${tools}:$PATH"\n`;
  for (const name of [".zprofile", ".zshrc", ".bash_profile", ".profile"]) await writeFile(join(home, name), profile);
  process.env.HOME = home;
  delete process.env.ZDOTDIR;
  if (process.platform !== "darwin") process.env.SHELL = "/bin/bash";

  // OpenBot started from Finder, the Dock or a login item.
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  // Control run: the same agent with the tool folder on OpenBot's own PATH, as when started from a terminal.
  if (process.env.LOGIN_PATH_CONTROL) process.env.PATH = `${tools}:${process.env.PATH}`;

  const found = await runCauseEffect(runInLoginShell(`command -v ${INTERPRETER}`));
  assert.ok(found.trim().endsWith(`/tools/${INTERPRETER}`), "Precondition: the login shell finds the interpreter.");

  const executable = join(root, "fake-acp-agent");
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);
  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  await runCauseEffect(
    store.save({ id: "alpha", name: "Alpha", command: executable, args: [], env: [], usagePrompt: null }),
  );

  // Check agent, before the user saves an agent. Only the store's environment check is used.
  const unused = () => Effect.die(new Error("Check agent changes no agent."));
  const changes = createCustomAgentChanges({
    service: {
      saveCustomAgent: unused,
      removeCustomAgent: unused,
      reloadCustomAgents: unused,
      customAgentUsage: unused,
    },
    customAgents: store,
  });
  const check = await runCauseEffect(changes.check({ command: executable, args: [], env: [] }));
  report.check = check;
  assert.equal(check.agentName, "fake", "Check agent starts the agent.");

  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const client = driver.createClient(cli, 20_000, context, undefined);
  clients.push(client);
  client.start();
  const models = await runCauseEffect(client.request("model/list", {}, (value) => value));
  const text = JSON.stringify(models);
  report.models = models;
  assert.ok(text.includes('"alpha/fast"'), "The agent lists its model.");
  passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
}

report.passed = passed;
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(passed ? 0 : 1);
