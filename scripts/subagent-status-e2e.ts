// Checks that a running subagent keeps its agent at work, and that a failed subagent alerts. Runs the
// real agent service on a temporary profile with the fake OpenCode agent of `acp-subagents-e2e.ts`
// (`provider-fakes/agents/subagents.ts`):
// 1. The prompt `work` starts two subagents; one fails. The service sends one `subagent-failed` event,
//    and the desktop notification path turns it into a notice at the "all" level only.
// 2. The prompt `background` starts a subagent that runs on after its turn. After `turn-completed`, the
//    runtime snapshot still names the agent in `subagentTurns`. When the subagent ends, a new runtime
//    snapshot drops it.
// `bun run test:subagent-status`. Writes .openbot-build/subagent-status-e2e/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import { notificationForAgentEvent } from "@openbot/team-client/agent-notifications";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { desktopAgentEventLevel } from "../src/main/desktop-notifications";

const OUT = resolve(import.meta.dirname, "../.openbot-build/subagent-status-e2e");
const BACKGROUND_MS = 1_500;
const root = await mkdtemp(join(tmpdir(), "openbot-subagent-status-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeOpenCode = join(root, "bin", "opencode");

// Before the service modules load: the provider process and the stores read the home folder.
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_DATA_HOME = join(home, ".local/share");
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.XDG_STATE_HOME = join(home, ".local/state");
process.env.OPENBOT_OPENCODE_PATH = fakeOpenCode;
mkdirSync(join(root, "bin"), { recursive: true });
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface Report {
  passed: boolean;
  failedEvents?: Array<{ title: string; threadIsAgentChat: boolean }>;
  notification?: { all: { title: string; body: string } | null; needsMe: string | null; preview: string | null };
  background?: {
    /** The `subagentTurns` of the runtime snapshot just after `turn-completed`. */
    afterTurn: string[];
    /** The `subagentTurns` of the last runtime snapshot event after the subagent ended. */
    afterSubagent: string[];
    /** Each runtime snapshot event and turn end, in order. */
    timeline: string[];
  };
  error?: string;
}

const report: Report = { passed: false };

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

/** Waits for a state of the service. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

// The fake answers `--version` here: the ACP fake serves only the protocol.
const fakeAgent = resolve(import.meta.dirname, "provider-fakes/agents/subagents.ts");
await writeFile(
  fakeOpenCode,
  [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then echo 2.2.5; exit 0; fi',
    "export FAKE_STYLE=opencode",
    `export FAKE_BACKGROUND_MS=${BACKGROUND_MS}`,
    `exec "${process.execPath}" "${fakeAgent}" "$@"`,
    "",
  ].join("\n"),
);
await chmod(fakeOpenCode, 0o755);

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  requestTimeoutMs: 5_000,
  preferredProvider: "opencode",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "opencode"),
});
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Subagent status",
      description: "Checks the status of subagents.",
      avatarSeed: "subagent-status",
      avatarHue: null,
      initialMessage: "work",
    }),
  );
  const turnEnds = () =>
    events.filter(
      (event): event is Extract<AgentEvent, { type: "turn-completed" }> =>
        event.type === "turn-completed" && event.agentId === agent.id,
    );
  await waitFor("the first turn to end", () => turnEnds().length === 1);

  // 1. A failed subagent.
  const failed = events.filter(
    (event): event is Extract<AgentEvent, { type: "subagent-failed" }> => event.type === "subagent-failed",
  );
  const threadId = agents.listAgents().find((one) => one.id === agent.id)?.threadId ?? null;
  report.failedEvents = failed.map((event) => ({ title: event.title, threadIsAgentChat: event.threadId === threadId }));
  const failure = failed[0];
  if (!failure) throw new Error("No subagent-failed event.");
  const server = { notificationsMuted: false, notificationLevel: "all" as const };
  const translate = translateFor("en");
  const notice = (level: "all" | "needs-me", preview: boolean) => {
    const shown = desktopAgentEventLevel(failure, { ...server, notificationLevel: level }, true, null);
    return shown
      ? notificationForAgentEvent(
          failure,
          agents.listAgents(),
          translate,
          shown,
          preview ? { reply: null, redact: redactText } : null,
        )
      : null;
  };
  const all = notice("all", false);
  report.notification = {
    all: all && { title: all.title, body: all.body },
    needsMe: notice("needs-me", false)?.body ?? null,
    preview: notice("all", true)?.body ?? null,
  };

  // 2. A background subagent keeps its agent at work after the turn.
  const timeline: string[] = [];
  const turns = (snapshot: { subagentTurns?: Array<{ agentId: string }> }) =>
    (snapshot.subagentTurns ?? []).filter((turn) => turn.agentId === agent.id).map((turn) => turn.agentId);
  agents.on("event", (event) => {
    if (event.type === "runtime-snapshot") timeline.push(`snapshot: ${turns(event.snapshot).length} running`);
    else if (event.type === "turn-completed" && event.agentId === agent.id) timeline.push("turn-completed");
  });
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "background" }));
  await waitFor("the second turn to end", () => turnEnds().length === 2);
  const afterTurn = turns(agents.getRuntimeSnapshot());
  await waitFor("the background subagent to end", () => turns(agents.getRuntimeSnapshot()).length === 0, 10_000);
  const lastSnapshot = events.findLast(
    (event): event is Extract<AgentEvent, { type: "runtime-snapshot" }> => event.type === "runtime-snapshot",
  );
  report.background = {
    afterTurn,
    afterSubagent: lastSnapshot ? turns(lastSnapshot.snapshot) : ["no snapshot"],
    timeline,
  };

  const expected = {
    failedEvents: [{ title: "Run the tests", threadIsAgentChat: true }],
    notification: {
      all: { title: "Subagent status", body: "A subagent stopped with an error." },
      needsMe: null,
      preview: "A subagent stopped with an error: Run the tests",
    },
    afterTurn: [agent.id],
    afterSubagent: [],
  };
  const actual = {
    failedEvents: report.failedEvents,
    notification: report.notification,
    afterTurn: report.background.afterTurn,
    afterSubagent: report.background.afterSubagent,
  };
  report.passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!report.passed) report.error = `Expected ${JSON.stringify(expected)}.`;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
