// Prepare the offline fixture, start `bun run dev`, and select English in this profile's UI.
// bun scripts/markdown-files-filter-e2e.ts --phase=before|after --instance=<worktree-id> --allow-mutations
// Phase changes only the artifact directory. The baseline must fail Documents/README.markdown.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { developmentUserDataName } from "../src/main/development-profile";
import {
  type AutomationSession,
  assertMutationAllowed,
  connectToDevApp,
  verifyBrowserOwnership,
} from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";
import {
  FILENAMES,
  FIXTURE_BODY,
  FIXTURE_HEADING,
  FIXTURE_NAME,
  INSTANCE,
  ROOT,
  requireFixture,
} from "./markdown-files-filter-fixture";

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
if (phase !== "before" && phase !== "after") throw new Error("Pass --phase=before or --phase=after.");
const out = resolve(ROOT, ".openbot-build/markdown-files-filter-e2e", phase);
const sources = [
  "packages/ui/src/features/files/files-view.ts",
  "packages/ui/src/features/files/FileList.tsx",
  "packages/contracts/src/attachment-files.ts",
  "packages/contracts/src/ipc-attachments.ts",
  "scripts/markdown-files-filter-e2e.ts",
  "scripts/markdown-files-filter-fixture.ts",
];
function sourceHashes() {
  return Object.fromEntries(
    sources.map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(resolve(ROOT, path)))
        .digest("hex"),
    ]),
  );
}
interface Case {
  filter: string;
  filename: string;
  expected: true;
  observed: boolean | null;
  passed: boolean;
}
interface Report {
  phase: "before" | "after";
  sourceHashes: Record<string, string>;
  sourceHashesAfter: Record<string, string>;
  instance: Pick<DevInstanceRecord, "instanceId" | "rendererPort" | "remoteDebuggingPort" | "pid"> | null;
  cases: Case[];
  screenshots: string[];
  failures: string[];
  cleanup: { disconnected: boolean; fixture: string };
  passed: boolean;
}
const report: Report = {
  phase,
  sourceHashes: {},
  sourceHashesAfter: {},
  instance: null,
  cases: [],
  screenshots: [],
  failures: [],
  cleanup: { disconnected: false, fixture: "Retained. Stop the app, then run the offline fixture cleanup command." },
  passed: false,
};
let session: AutomationSession | undefined;
let stage = "Require mutation opt-in and this worktree's named instance";
try {
  mkdirSync(out, { recursive: true });
  report.sourceHashes = sourceHashes();
  const named = process.argv.find((arg) => arg.startsWith("--instance="))?.slice(11);
  assertMutationAllowed({
    command: "markdown-files-filter-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: Boolean(named),
  });
  assert.equal(named, INSTANCE, "Require this worktree's isolated instance.");
  requireFixture();
  stage = "Verify same-worktree registry ownership";
  const records = readDevInstanceRecords().filter((entry) => entry.service === "app" && entry.instanceId === named);
  assert.equal(records.length, 1, "Require one live named app record.");
  const instance = records[0];
  assert.ok(instance);
  assert.equal(realpathSync(instance.projectRoot), realpathSync(ROOT), "Refuse a foreign worktree.");
  assert.equal(instance.profile, developmentUserDataName("app", INSTANCE), "Refuse a shared profile.");
  report.instance = {
    instanceId: instance.instanceId,
    rendererPort: instance.rendererPort,
    remoteDebuggingPort: instance.remoteDebuggingPort,
    pid: instance.pid,
  };
  stage = "Connect to the registered development app";
  session = await connectToDevApp(
    instance.remoteDebuggingPort,
    createOpenBotLogger("markdown-files-filter-e2e", () => undefined),
    { expectedRendererPort: instance.rendererPort, ownerPid: instance.pid },
  );
  assert.ok(
    await verifyBrowserOwnership(session.browser, instance.pid),
    "CDP process does not belong to the registry owner.",
  );
  const page = session.page;
  page.setDefaultTimeout(10_000);
  stage = "Select the synthetic fixture agent in the English UI";
  await page.getByRole("button", { name: /^Markdown filter fixture(?:,|\.|$)/u }).click();
  const conversation = page.getByRole("main", { name: "Conversation", exact: true });
  await conversation.getByRole("heading", { level: 1, name: FIXTURE_NAME, exact: true }).waitFor({ state: "visible" });
  stage = "Open the supported chat Files pane";
  const panel = page.getByRole("complementary", { name: `Files in ${FIXTURE_NAME}`, exact: true });
  if (!(await panel.isVisible())) {
    const toggle = page.getByRole("button", { name: "Open side panel", exact: true });
    if (await toggle.isVisible()) await toggle.click();
    const open = page.getByRole("button", { name: "Open Files", exact: true });
    if (await open.isVisible()) await open.click();
    else await page.getByRole("tab", { name: "Files", exact: true }).click();
  }
  await panel.waitFor({ state: "visible" });
  const filters = panel.getByRole("group", { name: "File type", exact: true });
  const search = panel.getByRole("searchbox", { name: "Search files", exact: true });
  await search.fill("README.");
  for (const filter of ["All", "Documents", "All again"]) {
    stage = `Check ${filter} filenames`;
    const label = filter === "All again" ? "All" : filter;
    await filters.getByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`, "u") }).click();
    // The .md control is the render barrier for each filter, including the missing-.markdown case.
    await panel.getByRole("button", { name: "Preview README.md", exact: true }).waitFor({ state: "visible" });
    for (const filename of FILENAMES) {
      const row = panel.getByRole("button", { name: `Preview ${filename}`, exact: true });
      const observed = await row.getByText(filename, { exact: true }).isVisible();
      report.cases.push({ filter, filename, expected: true, observed, passed: observed });
      if (!observed) report.failures.push(`${filter} omits ${filename}.`);
    }
    const screenshot = resolve(out, `${filter.toLowerCase().replaceAll(" ", "-")}.png`);
    await panel.screenshot({ path: screenshot });
    report.screenshots.push(screenshot);
  }
  stage = "Preview the .markdown attachment through the real FilePreviewPanel";
  await panel.getByRole("button", { name: "Preview README.markdown", exact: true }).click();
  const preview = page.getByRole("complementary", { name: "File preview", exact: true });
  await preview.getByRole("heading", { name: "README.markdown", exact: true }).waitFor({ state: "visible" });
  await preview.getByRole("heading", { level: 1, name: FIXTURE_HEADING, exact: true }).waitFor({ state: "visible" });
  await preview.getByText(FIXTURE_BODY, { exact: true }).waitFor({ state: "visible" });
  const screenshot = resolve(out, "preview.png");
  await preview.screenshot({ path: screenshot });
  report.screenshots.push(screenshot);
  await preview.getByRole("button", { name: "Close file preview", exact: true }).click();
} catch (error) {
  // Keep app content, Playwright call logs, profile state and credentials out of the report.
  report.failures.push(`${stage} failed (${error instanceof Error ? error.name : "unknown error"}).`);
  if (session) {
    try {
      const panel = session.page.getByRole("complementary", { name: `Files in ${FIXTURE_NAME}`, exact: true });
      if (await panel.isVisible()) {
        const screenshot = resolve(out, "failure.png");
        await panel.screenshot({ path: screenshot });
        report.screenshots.push(screenshot);
      }
    } catch {
      report.failures.push("Failure screenshot could not be saved.");
    }
  }
} finally {
  try {
    await session?.close();
    report.cleanup.disconnected = true;
  } catch {
    report.failures.push("CDP disconnect failed.");
  }
  try {
    report.sourceHashesAfter = sourceHashes();
    assert.deepEqual(report.sourceHashesAfter, report.sourceHashes);
  } catch {
    report.failures.push("Source hashes could not be verified or changed during the run.");
  }
  report.passed =
    report.failures.length === 0 && report.cases.length === 6 && report.cases.every((entry) => entry.passed);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `markdown-files-filter-e2e: ${report.passed ? "PASS" : "FAIL"}; ${resolve(out, "report.json")}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}
