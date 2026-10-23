// Prepare offline, start this worktree's registered `bun run dev`, then select English in its UI.
// bun scripts/spreadsheet-phonetic-e2e.ts --phase=before|after --instance=<id> --allow-mutations
// Phase selects artifacts only. Both phases require base cell text without rPh annotations.
// Screenshots in .openbot-build/spreadsheet-phonetic-e2e/<phase> are review assets only.
import assert from "node:assert/strict";
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
  CASES,
  FILENAMES,
  FIXTURE_NAME,
  INSTANCE,
  OUT,
  ROOT,
  requireFixture,
  sha256,
  writeWorkbooks,
} from "./spreadsheet-phonetic-fixture";

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
assert.ok(phase === "before" || phase === "after", "Pass --phase=before or --phase=after.");
const out = resolve(OUT, phase);
const sources = [
  "packages/ui/src/features/conversation/SpreadsheetFilePreview.tsx",
  "packages/ui/src/features/conversation/FilePreviewPanel.tsx",
  "scripts/spreadsheet-phonetic-e2e.ts",
  "scripts/spreadsheet-phonetic-fixture.ts",
];
function sourceHashes() {
  return Object.fromEntries(sources.map((path) => [path, sha256(readFileSync(resolve(ROOT, path)))]));
}
interface CellResult {
  filename: string;
  round: "open" | "reopen";
  id: string;
  annotated: boolean;
  expected: string;
  observed: string | null;
  passed: boolean;
}
interface Report {
  phase: "before" | "after";
  sourceHashes: Record<string, string>;
  sourceHashesAfter: Record<string, string>;
  fixtures: { filename: string; sha256: string }[];
  instance: Pick<DevInstanceRecord, "instanceId" | "rendererPort" | "remoteDebuggingPort" | "pid"> | null;
  cells: CellResult[];
  screenshots: string[];
  errors: string[];
  cleanup: { navigationRestored: boolean; disconnected: boolean };
  baselineReproduced: boolean;
  passed: boolean;
}
const report: Report = {
  phase,
  sourceHashes: {},
  sourceHashesAfter: {},
  fixtures: [],
  instance: null,
  cells: FILENAMES.flatMap((filename) =>
    (["open", "reopen"] as const).flatMap((round) =>
      CASES.map(({ id, annotated, expected }) => ({
        filename,
        round,
        id,
        annotated,
        expected,
        observed: null,
        passed: false,
      })),
    ),
  ),
  screenshots: [],
  errors: [],
  cleanup: { navigationRestored: false, disconnected: false },
  baselineReproduced: false,
  passed: false,
};
let session: AutomationSession | undefined;
let stage = "Require --allow-mutations and this worktree's explicit --instance";
let originalConversation: string | null = null;
let navigationOwned = false;
let previewOwned = false;
function chatName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:,|\\.|$)`, "u");
}
try {
  mkdirSync(out, { recursive: true });
  const named = process.argv.find((arg) => arg.startsWith("--instance="))?.slice(11);
  assertMutationAllowed({
    command: "spreadsheet-phonetic-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: Boolean(named),
  });
  assert.equal(named, INSTANCE, "Require this worktree's isolated instance.");
  stage = "Verify the prepared synthetic fixture journal";
  const fixture = requireFixture();
  report.sourceHashes = sourceHashes();
  report.fixtures = writeWorkbooks(phase);
  assert.deepEqual(report.fixtures, fixture.fixtures, "Prepared attachment bytes differ from generated workbooks.");
  stage = "Require one app registry record for this worktree and isolated profile";
  const records = readDevInstanceRecords().filter((record) => record.service === "app" && record.instanceId === named);
  assert.equal(records.length, 1, "Start one registered app in this worktree.");
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
  stage = "Connect to the registered renderer and verify CDP process ownership";
  session = await connectToDevApp(
    instance.remoteDebuggingPort,
    createOpenBotLogger("spreadsheet-phonetic-e2e", () => undefined),
    { expectedRendererPort: instance.rendererPort, ownerPid: instance.pid },
  );
  assert.ok(await verifyBrowserOwnership(session.browser, instance.pid), "CDP process ownership is not confirmed.");
  const page = session.page;
  page.setDefaultTimeout(10_000);
  const conversation = page.getByRole("main", { name: "Conversation", exact: true });
  const panel = page.getByRole("complementary", { name: "File preview", exact: true });
  stage = "Require an English conversation UI with no open preview";
  await conversation.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
  assert.equal(await panel.count(), 0, "Close the existing preview first.");
  originalConversation = await conversation.getByRole("heading", { level: 1 }).innerText();
  const chats = page.getByRole("navigation", { name: "Chat list", exact: true });
  // The restore target must exist before the script changes navigation.
  assert.equal(await chats.getByRole("button", { name: chatName(originalConversation) }).count(), 1);
  stage = "Select Spreadsheet phonetic fixture in the chat list";
  navigationOwned = true;
  await chats.getByRole("button", { name: chatName(FIXTURE_NAME) }).click();
  await conversation.getByRole("heading", { level: 1, name: FIXTURE_NAME, exact: true }).waitFor({ state: "visible" });
  for (const [index, filename] of FILENAMES.entries()) {
    for (const round of ["open", "reopen"] as const) {
      stage = `${round}: find Preview ${filename} in the fixture conversation`;
      const open = conversation.getByRole("button", { name: `Preview ${filename}`, exact: true });
      await open.waitFor({ state: "visible" });
      assert.equal(await open.count(), 1, "Refuse ambiguous attachment buttons.");
      previewOwned = true;
      await open.click();
      stage = `${round}: wait for FilePreviewPanel heading ${filename}`;
      await panel.getByRole("heading", { name: filename, exact: true }).waitFor({ state: "visible" });
      const table = panel.getByRole("table", { name: `Phonetic ${index === 1 ? "shared" : "inline"}`, exact: true });
      stage = `${round}: wait for semantic spreadsheet table in ${filename}`;
      await table.waitFor({ state: "visible" });
      for (const result of report.cells.filter((entry) => entry.filename === filename && entry.round === round)) {
        stage = `${round}: read visible ${filename} cell ${result.id}`;
        const row = table.getByRole("row").filter({ has: page.getByRole("cell", { name: result.id, exact: true }) });
        await row.waitFor({ state: "visible" });
        assert.equal(await row.count(), 1, "Require one row for this case.");
        assert.equal(await row.getByRole("cell").count(), 2, "Require case and value cells.");
        const value = row.getByRole("cell").nth(1);
        await value.waitFor({ state: "visible" });
        // innerText reads actual visible app cell data, including xml:space under the app's pre whitespace rule.
        result.observed = await value.innerText();
        result.passed = result.observed === result.expected;
      }
      stage = `${round}: save review screenshot and close ${filename}`;
      const screenshot = `${index === 1 ? "shared" : "inline"}-${round}.png`;
      await panel.screenshot({ path: resolve(out, screenshot) });
      report.screenshots.push(screenshot);
      await panel.getByRole("button", { name: "Close file preview", exact: true }).click();
      await panel.waitFor({ state: "detached" });
      previewOwned = false;
    }
  }
} catch (error) {
  // Do not export app state, Playwright logs, profile paths, or arbitrary exception messages.
  report.errors.push(`${stage} failed (${error instanceof Error ? error.name : "unknown error"}).`);
} finally {
  if (session) {
    try {
      const page = session.page;
      const panel = page.getByRole("complementary", { name: "File preview", exact: true });
      if (previewOwned && (await panel.isVisible())) {
        await panel.getByRole("button", { name: "Close file preview", exact: true }).click();
        await panel.waitFor({ state: "detached" });
      }
      if (navigationOwned && originalConversation) {
        await page
          .getByRole("navigation", { name: "Chat list", exact: true })
          .getByRole("button", { name: chatName(originalConversation) })
          .click();
        await page
          .getByRole("main", { name: "Conversation", exact: true })
          .getByRole("heading", { level: 1, name: originalConversation, exact: true })
          .waitFor({ state: "visible" });
        report.cleanup.navigationRestored = true;
      }
    } catch {
      report.errors.push("Could not restore owned preview or conversation navigation.");
    }
    try {
      await session.close();
      report.cleanup.disconnected = true;
    } catch {
      report.errors.push("CDP disconnect failed.");
    }
  }
  try {
    report.sourceHashesAfter = sourceHashes();
    assert.deepEqual(report.sourceHashesAfter, report.sourceHashes);
    for (const fixture of report.fixtures)
      assert.equal(sha256(readFileSync(resolve(out, fixture.filename))), fixture.sha256);
  } catch {
    report.errors.push("Source or fixture hashes changed or could not be verified.");
  }
  report.baselineReproduced =
    report.errors.length === 0 &&
    report.cells.every((entry) => (entry.annotated ? entry.observed === `${entry.expected}かんじ` : entry.passed));
  report.passed = report.errors.length === 0 && report.cells.every((entry) => entry.passed);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `spreadsheet-phonetic-e2e: ${report.passed ? "PASS" : "FAIL"}; ${resolve(out, "report.json")}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}
