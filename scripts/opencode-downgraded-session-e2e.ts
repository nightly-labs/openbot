// Runs the real OpenCode driver against a fake `opencode acp` that acts as OpenCode 1.19.3 does on a
// session that OpenCode 2.0 wrote in its `session_v2` table: it advertises `session/resume` and
// `session/list`, does not list the session, and answers each resume with "OpenCode service failure".
// Checks that such a resume ends as a missing session, which the agent replaces and gives the
// transcript; that a session the list still holds is tried once more and kept; that the OpenCode 2.x
// answer for a session it does not have is a missing session, but its answer for a session of another
// directory is not.
// `bun run test:opencode-downgraded-session`. Writes .openbot-build/opencode-downgraded-session-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-downgraded-session-e2e");

interface LogEntry {
  event: "session/resume" | "session/load" | "session/list";
  sessionId?: string;
}

interface Report {
  passed: boolean;
  unreadable?: { error: string; missingSession: boolean; resumes: number; listed: boolean };
  listed?: { error: string; missingSession: boolean; resumes: number };
  newerVersion?: { missing: boolean; otherDirectory: boolean };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-downgraded-session-e2e-"));
const log = join(root, "opencode.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.FAKE_LOG = log;

/** Resumes a thread and answers the failure, which must not be a success. */
async function resumeFailure(client: AgentClient, threadId: string, cwd: string): Promise<Error> {
  try {
    await runCauseEffect(client.request("thread/resume", { threadId, cwd }, (value) => value));
  } catch (error) {
    assert.ok(error instanceof Error, "The client fails with an Error.");
    return error;
  }
  assert.fail(`The resume of ${threadId} must fail.`);
}

try {
  const executable = join(root, "opencode", "bin", "opencode");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await installFakeAgent(executable, "opencode-downgraded-session");
  const cli: AgentCliInfo = { executable, version: "1.19.3", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();

  // 1. A session that this version cannot read is a missing session, so the agent gets a new one
  // with its transcript instead of failing each turn.
  const unreadable = await resumeFailure(client, "v2-1", workspace);
  const first = await readJsonl<LogEntry>(log);
  const unreadableReport = {
    error: unreadable.message,
    missingSession: isMissingProviderSessionError(unreadable, "opencode"),
    resumes: first.filter((entry) => entry.event === "session/resume").length,
    listed: first.some((entry) => entry.event === "session/list"),
  };
  report.unreadable = unreadableReport;
  assert.equal(unreadableReport.missingSession, true, "An unreadable session is replaced.");
  assert.equal(unreadableReport.listed, true, "The session list decides that the session is missing.");
  assert.equal(unreadableReport.resumes, 1, "A session that is not listed is not resumed again.");

  // 2. A session that the list holds is kept: one more resume, then the service failure is reported.
  await rm(log, { force: true });
  const kept = await resumeFailure(client, "kept-1", workspace);
  const keptReport = {
    error: kept.message,
    missingSession: isMissingProviderSessionError(kept, "opencode"),
    resumes: (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "session/resume").length,
  };
  report.listed = keptReport;
  assert.equal(keptReport.missingSession, false, "A listed session is not replaced.");
  assert.equal(keptReport.resumes, 2, "A listed session is resumed once more.");
  assert.equal(keptReport.error, sourceText("error.provider.opencodeServiceFailure"));

  // 3. OpenCode 2.x copies 1.x sessions once, so it does not have a session that 1.x wrote later.
  // That session is replaced; a session of another directory is not.
  report.newerVersion = {
    missing: isMissingProviderSessionError(await resumeFailure(client, "v1only-1", workspace), "opencode"),
    otherDirectory: isMissingProviderSessionError(await resumeFailure(client, "othercwd-1", workspace), "opencode"),
  };
  assert.equal(report.newerVersion.missing, true, "A session that OpenCode 2.x does not have is replaced.");
  assert.equal(report.newerVersion.otherDirectory, false, "A session of another directory is not replaced.");

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
