// Runs the real `acp` provider driver over one fake agent, installed as `omp` and as `other-agent`, to
// check the missing-session rules of the custom agent flavors (`src/backend/acp-flavor.ts`). After a
// restart, `session/load` fails. The exact omp error for this session and the protocol's `-32002`
// error must replace the session for both commands. An internal error, also omp's error for another
// session, must keep it.
// `bun run test:acp-flavors`. Writes .openbot-build/acp-flavor-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-flavor-e2e");

const COMMANDS = ["omp", "other-agent"] as const;
/** Each `session/load` error, and whether it names a missing session. */
const LOAD_ERRORS = [
  ["unsupported", true],
  ["unsupported-other", false],
  ["not-found", true],
  ["internal", false],
] as const;
type LoadError = (typeof LOAD_ERRORS)[number][0];

interface CaseResult {
  command: (typeof COMMANDS)[number];
  loadError: LoadError;
  loaded: boolean;
  missingSession: boolean;
}

interface Report {
  passed: boolean;
  cases: CaseResult[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-flavor-e2e-"));
const report: Report = { passed: false, cases: [] };
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  const agents: {
    id: string;
    command: (typeof COMMANDS)[number];
    loadError: LoadError;
    missingSession: boolean;
    log: string;
  }[] = [];
  for (const command of COMMANDS) {
    const executable = join(root, "bin", command);
    await installFakeAgent(executable, "session-errors");
    for (const [loadError, missingSession] of LOAD_ERRORS) {
      const agent = {
        id: `${command}-${loadError}`,
        command,
        loadError,
        missingSession,
        log: join(root, `${command}-${loadError}.jsonl`),
      };
      agents.push(agent);
      await runCauseEffect(
        store.save({
          id: agent.id,
          name: agent.id,
          command: executable,
          args: ["acp"],
          env: [
            { name: "FAKE_LOAD_ERROR", value: loadError },
            { name: "FAKE_LOG", value: agent.log },
          ],
          usagePrompt: null,
        }),
      );
    }
  }

  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const open = () => {
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    return client;
  };

  // One session for each agent, then a new process for each agent that must load its session again.
  let client = open();
  const threads = new Map<string, string>();
  for (const agent of agents) {
    threads.set(agent.id, await startThread(client, { model: `${agent.id}/default`, cwd: workspace }));
  }
  await runCauseEffect(client.stop());
  client = open();
  for (const agent of agents) {
    const threadId = threads.get(agent.id);
    const resumed = await runCauseEffect(
      client.request("thread/resume", { threadId, model: `${agent.id}/default`, cwd: workspace }, (v) => v),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const requests = await readJsonl<{ method: string }>(agent.log);
    const result: CaseResult = {
      command: agent.command,
      loadError: agent.loadError,
      loaded: requests.some((request) => request.method === "session/load"),
      missingSession: isMissingProviderSessionError(resumed, "acp"),
    };
    report.cases.push(result);
    assert.ok(resumed instanceof Error, `${agent.id}: the failed session/load fails thread/resume.`);
    assert.equal(result.loaded, true, `${agent.id}: the new process loads the saved session.`);
    assert.equal(
      result.missingSession,
      agent.missingSession,
      `${agent.id}: the ${agent.loadError} error ${agent.missingSession ? "replaces" : "keeps"} the session.`,
    );
  }

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
