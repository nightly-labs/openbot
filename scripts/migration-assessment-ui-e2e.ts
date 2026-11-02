// Actual settings components + production preparation/assessment services with generated data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentSummary, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { readMigrationAssessmentInventory } from "../src/main/migration-assessment-inventory";
import { MigrationAssessmentService } from "../src/main/migration-assessment-service";
import { readMigrationAssessmentSource } from "../src/main/migration-assessment-source";
import { MigrationPreparationService } from "../src/main/migration-preparation";
import { readMigrationPreparationInventory } from "../src/main/migration-preparation-inventory";
import { decodeMigrationAssessmentStateForRenderer } from "../src/preload/migration-assessment-decoding";
import { decodeMigrationPreparationStateForRenderer } from "../src/preload/migration-preparation-decoding";
import type { MigrationAssessmentStoryRequest } from "../src/renderer/stories/migration-assessment-calls";
import type { MigrationPreparationStoryRequest } from "../src/renderer/stories/migration-preparation-calls";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const target = new URL(arg("url") ?? "http://localhost:6006");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
const channel = arg("browser-channel") ?? "chrome";
assert.ok(["chrome", "chromium"].includes(channel));
const output = resolve(import.meta.dirname, "../.openbot-build/migration-assessment-ui-e2e");
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await mkdtemp(join(output, "fixture-"));
const profile = join(fixture, "profile");
const managed = join(fixture, "managed");
const database = new OpenBotDatabase(profile);
const now = "2026-01-01T12:00:00.000Z";
const makePreparation = () =>
  new MigrationPreparationService({
    userDataPath: profile,
    now: () => now,
    readInventory: () => readMigrationPreparationInventory(() => database.connection),
  });
let preparation = makePreparation();
const makeAssessment = () =>
  new MigrationAssessmentService({
    userDataPath: profile,
    preparation,
    now: () => now,
    readSource: () =>
      readMigrationAssessmentSource({
        appVersion: () => "1.2.3",
        platform: () => "darwin",
        architecture: () => "arm64",
      }),
    readInventory: () =>
      readMigrationAssessmentInventory({
        connection: () => database.connection,
        userDataRoot: profile,
        managedRoot: managed,
        sourcePlatform: "darwin",
      }),
  });
let assessment = makeAssessment();
const report: {
  passed: boolean;
  cases: string[];
  pageErrors: string[];
  screenshots: string[];
  reactivity: { immutableUpdates: number; untrackedReads: number; untrackedDiagnostics: string[] };
} = {
  passed: false,
  cases: [],
  pageErrors: [],
  screenshots: [],
  reactivity: { immutableUpdates: 0, untrackedReads: 0, untrackedDiagnostics: [] },
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await Effect.runPromise(database.initialize());
  const agent: AgentSummary = {
    id: "PRIVATE_AGENT",
    name: "PRIVATE_NAME",
    title: "Synthetic",
    description: "PRIVATE_DESCRIPTION",
    notifications: false,
    provider: "grok",
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    access: "workspace",
    threadId: "PRIVATE_THREAD",
    workspacePath: join(managed, "Agents", "PRIVATE_WORKSPACE"),
    additionalFolders: [join(fixture, "PRIVATE_EXTERNAL_ROOT")],
    preview: "",
    updatedAt: now,
    avatarSeed: "synthetic",
    avatarHue: null,
    avatarUrl: null,
  };
  database.replaceAgents("fixture", [agent], "agents.updated");
  const conversation: ConversationSnapshot = {
    agentId: agent.id,
    threadId: agent.threadId,
    activeTurnId: null,
    revision: 0,
    messages: [{ id: "PRIVATE_MESSAGE", author: "user", text: "PRIVATE_CONTENT", createdAt: now, status: "completed" }],
  };
  database.persistConversation(conversation, "conversation.saved");
  new AgentRoutineStore(database).create(
    {
      agentId: agent.id,
      name: "PRIVATE_ROUTINE",
      instruction: "Never execute",
      active: true,
      timezone: "Etc/UTC",
      schedule: { kind: "daily", time: "13:00" },
    },
    new Date(now),
  );
  const credentialCanary = join(profile, "PRIVATE_CREDENTIAL_CANARY");
  await writeFile(credentialCanary, "PRIVATE_SYNTHETIC_TOKEN", { mode: 0o600 });
  const hash = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  const sourceFiles = [database.path, `${database.path}-wal`, credentialCanary];
  const before = await Promise.all(sourceFiles.map(hash));
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[IMMUTABLE_UPDATE_IN_STORE]")) report.reactivity.immutableUpdates++;
    if (text.includes("[STRICT_READ_UNTRACKED]")) {
      report.reactivity.untrackedReads++;
      const owner = [...text.matchAll(/<([A-Za-z][A-Za-z0-9.]*)>/g)]
        .map((match) => match[1])
        .slice(-5)
        .join(" > ");
      const description = owner || (text.split("\n")[0] ?? text).slice(0, 240);
      if (
        !report.reactivity.untrackedDiagnostics.includes(description) &&
        report.reactivity.untrackedDiagnostics.length < 8
      )
        report.reactivity.untrackedDiagnostics.push(description);
    }
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["http:", "https:"].includes(url.protocol) && url.origin !== target.origin
      ? route.abort()
      : route.continue();
  });
  await page.exposeFunction(
    "__openbotMigrationPreparationInvoke",
    async (request: MigrationPreparationStoryRequest) => {
      const state =
        request.method === "getState"
          ? await Effect.runPromise(preparation.getState())
          : request.method === "prepare"
            ? await Effect.runPromise(preparation.prepare(request.input))
            : await Effect.runPromise(preparation.cancel(request.input));
      return decodeMigrationPreparationStateForRenderer(state);
    },
  );
  let assessmentRequests = 0;
  let assessmentCalls = 0;
  let loseResponse = false;
  await page.exposeFunction("__openbotMigrationAssessmentInvoke", async (request: MigrationAssessmentStoryRequest) => {
    assessmentCalls++;
    if (request.method === "assess") assessmentRequests++;
    const state =
      request.method === "getState"
        ? await Effect.runPromise(assessment.getState())
        : await Effect.runPromise(assessment.assess(request.input));
    if (request.method === "assess" && loseResponse) {
      loseResponse = false;
      throw new Error("Synthetic response lost after durable append");
    }
    return decodeMigrationAssessmentStateForRenderer(state);
  });
  const url = new URL("/iframe.html", target);
  url.searchParams.set("id", "settings-migration-preparation--offline-assessment");
  url.searchParams.set("viewMode", "story");
  url.searchParams.set("globals", "colorScheme:dark");
  const screenshot = async (name: string) => {
    const path = resolve(output, `${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    report.screenshots.push(path);
  };
  const choice = async (label: string, value: string) => {
    await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
    await page.getByRole("option", { name: value, exact: true }).click();
  };
  const disabledMigration = async () => {
    for (const name of ["Export", "Restore", "Activate"])
      assert.equal(await page.getByRole("button", { name, exact: true }).isEnabled(), false);
  };
  await page.goto(url.href);
  await page.getByRole("button", { name: "Save preparation plan", exact: true }).waitFor({ timeout: 60_000 });
  await choice("Destination type", "Docker host");
  await page.getByRole("button", { name: "Save preparation plan", exact: true }).click();
  const save = page.getByRole("button", { name: "Save offline assessment", exact: true });
  await save.waitFor();
  await page.getByRole("heading", { name: "Offline destination assessment", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("before-offline-assessment-dark");
  await save.click();
  await page.getByText("Insufficient information", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Source metadata", exact: true }).waitFor();
  await page.getByText("Source platform", { exact: true }).waitFor();
  let state = await Effect.runPromise(assessment.getState());
  assert.equal(state.revision, 1);
  assert.equal(state.assessment?.inventory.categories.length, 29);
  assert.equal(state.assessment?.inventoryComplete, false);
  assert.equal(state.assessment?.destinationVerified, false);
  await disabledMigration();
  report.cases.push(
    "Real preparation workflow saves an offline assessment with 29 coverage categories and explicit unknown destination facts; all migration actions remain unavailable",
  );
  await choice("Destination platform", "Linux");
  await choice("Destination architecture", "x64");
  await page.getByRole("textbox", { name: "Destination OpenBot version", exact: true }).fill("1.2.3");
  await page.getByRole("textbox", { name: "Destination schema version", exact: true }).fill("49");
  await choice("Destination executor", "Container");
  await choice("Destination data ownership", "Owned by this destination");
  await choice("Destination persistence", "Persistent");
  await save.click();
  await page.getByText("Mismatch", { exact: true }).waitFor();
  state = await Effect.runPromise(assessment.getState());
  assert.equal(state.revision, 2);
  assert.ok(state.assessment?.findings.includes("workspace-isolation-unsupported"));
  assert.ok(state.assessment?.findings.includes("external-root-mapping-required"));
  assert.ok(state.assessment?.findings.includes("reauthentication-unresolved"));
  assert.equal(state.assessment?.inventory.paths.external, 1);
  await page.getByText("Credential stores", { exact: true }).waitFor();
  await page.getByText("Unclassified files", { exact: true }).waitFor();
  await page.getByText("Mismatch", { exact: true }).scrollIntoViewIfNeeded();
  await screenshot("after-mismatch-comparison-dark");
  await page.getByRole("heading", { name: "Category coverage", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("after-category-coverage-dark");
  await page.getByRole("button", { name: "Activate", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("after-mismatch-coverage-dark");
  report.cases.push(
    "Declared Linux container is flagged for a confined workspace agent, external root mapping and unresolved credentials without changing access or executing work",
  );
  const saved = state;
  preparation = makePreparation();
  assessment = makeAssessment();
  await page.reload();
  await page.getByText("Mismatch", { exact: true }).waitFor();
  assert.deepEqual(await Effect.runPromise(assessment.getState()), saved);
  const requests = assessmentRequests;
  await page.getByRole("textbox", { name: "Destination OpenBot version", exact: true }).fill("invalid://PRIVATE_TOKEN");
  await save.click();
  await page
    .getByText(
      "Check the destination declaration. Use a supported version format and a whole schema version, or leave version fields empty if unknown.",
      { exact: true },
    )
    .waitFor();
  assert.equal(assessmentRequests, requests);
  await page.getByRole("textbox", { name: "Destination OpenBot version", exact: true }).fill("1.2.3");
  loseResponse = true;
  await save.click();
  await page
    .getByText(
      "OpenBot could not confirm the assessment request. Reload the assessment and the preparation plan before you try again.",
      { exact: true },
    )
    .waitFor();
  state = await Effect.runPromise(assessment.getState());
  assert.equal(state.revision, 3);
  assert.equal(assessmentRequests, requests + 1);
  await page.setViewportSize({ width: 560, height: 1000 });
  await page.getByRole("button", { name: "Reload assessment", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("recovered-assessment-narrow-dark");
  report.cases.push(
    "New services and browser reload preserve the report; malformed declaration sends no mutation; lost committed response reloads revision3 without replay",
  );
  const originalPlanId = state.assessment?.planId;
  assert.ok(originalPlanId);
  await page.getByRole("button", { name: "Cancel preparation plan", exact: true }).click();
  await page.getByText("Preparation plan cancelled", { exact: true }).waitFor();
  assert.equal(await save.count(), 0);
  assert.equal((await Effect.runPromise(assessment.getState())).applicability, "stale");
  await page.getByRole("button", { name: "Save a new preparation plan", exact: true }).click();
  await save.waitFor();
  const fresh = await Effect.runPromise(assessment.getState());
  assert.equal(fresh.revision, 0);
  assert.equal(fresh.assessment, null);
  assert.ok((await readdir(join(profile, "openbot-migration-assessments-v1", originalPlanId))).includes("3.json"));
  report.cases.push(
    "Cancelling invalidates report applicability; a new preparation starts a separate empty assessment history while old records remain retained",
  );
  url.searchParams.set("id", "settings-migration-preparation--windows-assessment-unavailable");
  url.searchParams.set("globals", "colorScheme:light");
  const callsBeforeWindows = assessmentCalls;
  await page.goto(url.href);
  await page
    .getByText(
      "Offline destination assessment is not supported on Windows in this version. Saving and reloading assessments are unavailable.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await save.isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "Reload assessment", exact: true }).isEnabled(), false);
  for (const name of [
    "Destination platform",
    "Destination architecture",
    "Destination executor",
    "Destination data ownership",
    "Destination persistence",
  ])
    assert.equal(await page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).isEnabled(), false);
  for (const name of ["Destination OpenBot version", "Destination schema version"])
    assert.equal(await page.getByRole("textbox", { name, exact: true }).isEnabled(), false);
  assert.equal(assessmentCalls, callsBeforeWindows);
  assert.equal(assessmentRequests, requests + 1);
  await save.scrollIntoViewIfNeeded();
  await screenshot("windows-assessment-unavailable-light");
  report.cases.push("Simulated Windows source disables saves and reloads with zero assessment calls for empty history");
  assert.ok(fresh.preparation);
  // Seed through the POSIX fixture service only; this is not native Windows storage validation.
  await Effect.runPromise(
    assessment.assess({
      planId: fresh.preparation.planId,
      expectedPreparationRevision: fresh.preparation.revision,
      expectedAssessmentRevision: 0,
      destination: {
        platform: "unknown",
        architecture: "unknown",
        appVersion: null,
        schemaVersion: null,
        executor: "unknown",
        dataRoot: "unspecified",
        persistence: "unknown",
      },
    }),
  );
  const retained = join(profile, "openbot-migration-assessments-v1", fresh.preparation.planId, "1.json");
  const retainedHash = await hash(retained);
  await page.reload();
  await page
    .getByText(
      "Offline destination assessment is not supported on Windows in this version. Saving and reloading assessments are unavailable.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await save.isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "Reload assessment", exact: true }).isEnabled(), false);
  assert.equal(assessmentCalls, callsBeforeWindows);
  assert.equal(await hash(retained), retainedHash);
  assert.equal(await page.getByRole("heading", { name: "Source metadata", exact: true }).count(), 0);
  assert.equal(await page.getByText("Source platform", { exact: true }).count(), 0);
  await screenshot("windows-existing-assessment-unavailable-light");
  const wire = JSON.stringify(state) + (await page.locator("body").innerText());
  assert.equal(wire.includes("PRIVATE_"), false);
  assert.equal(wire.includes(fixture), false);
  assert.deepEqual(await Promise.all(sourceFiles.map(hash)), before);
  assert.equal(database.connection.prepare("SELECT count(*) AS total FROM projection_routine_runs").get()?.total, 0);
  await disabledMigration();
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.reactivity.immutableUpdates, 0);
  report.cases.push(
    "Simulated Windows source makes zero assessment calls for existing history; retained report, source database/WAL and credential canary remain byte-identical and no routine run is created",
  );
  report.passed = true;
} finally {
  try {
    await browser?.close();
  } finally {
    database.close();
    await rm(fixture, { recursive: true, force: true });
    await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
}
