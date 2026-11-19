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

  report.newerVersion = {
    missing: isMissingProviderSessionError(await resumeFailure(client, "v1only-1", workspace), "opencode"),
    otherDirectory: isMissingProviderSessionError(await resumeFailure(client, "othercwd-1", workspace), "opencode"),
  };
  assert.equal(report.newerVersion.missing, true, "A session that OpenCode 2.x does not have is replaced.");
  assert.equal(report.newerVersion.otherDirectory, true, "A session of another directory is replaced.");

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
