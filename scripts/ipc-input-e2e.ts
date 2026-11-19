import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/ipc-input-e2e");
const TOO_LONG_ID = "x".repeat(INPUT_LIMITS.identifier + 1);

interface Check {
  name: string;
  method: readonly string[];
  args: readonly unknown[];
  refusal: string;
}

const CHECKS: readonly Check[] = [
  {
    name: "openExternal opens no address that the renderer invents",
    method: ["openExternal"],
    args: ["https://attacker.example/"],
    refusal: "Unknown external destination.",
  },
  {
    name: "the browser refuses a javascript: address",
    method: ["browser", "navigate"],
    args: [{ tabId: "ipc-input-e2e", url: "javascript:alert(1)" }],
    refusal: en["error.backend.browserUrlProtocol"],
  },
  {
    name: "the browser refuses a file: address",
    method: ["browser", "navigate"],
    args: [{ tabId: "ipc-input-e2e", url: "file:///etc/passwd" }],
    refusal: en["error.backend.browserUrlProtocol"],
  },
  {
    name: "the server scope is checked before the inner decoder sees the payload",
    method: ["agent", "deleteChannel"],
    args: [42, ""],
    refusal: "serverId is required.",
  },
  {
    name: "a channel id must be a string",
    method: ["agent", "deleteChannel"],
    args: [42],
    refusal: "channelId is required.",
  },
  {
    name: "a channel id has a length limit",
    method: ["agent", "deleteChannel"],
    args: [TOO_LONG_ID],
    refusal: "channelId is too long.",
  },
  {
    name: "an attachment id has a length limit",
    method: ["agent", "discardDraftAttachment"],
    args: [TOO_LONG_ID],
    refusal: "attachmentId is too long.",
  },
  {
    name: "an attachment id that is a path opens no file",
    method: ["agent", "openAttachment"],
    args: [{ attachmentId: "../../../../etc/passwd", action: "open" }],
    refusal: en["error.attachment.unavailable"],
  },
  {
    name: "a shared file path cannot leave the shared folder",
    method: ["agent", "openSharedFile"],
    args: [{ path: "../../../../etc/passwd", action: "open" }],
    refusal: en["error.backend.sharedFileOutside"],
  },
  {
    name: "only a shipped app language is saved",
    method: ["setAppLanguagePreference"],
    args: [{ language: "../../xx" }],
    refusal: "Language preference is required.",
  },
];

async function refusal(page: Page, check: Check): Promise<string | null> {
  const call = `window.openbot.${check.method.join(".")}(${check.args.map((arg) => JSON.stringify(arg)).join(", ")})`;
  const result = await page.evaluate(`(async () => {
    try {
      await ${call};
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })()`);
  return typeof result === "string" ? result : null;
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "ipc-input-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("ipc-input-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

mkdirSync(OUT, { recursive: true });
const page = session.page;
const languageBefore = await page.evaluate(() => window.openbot.getAppLanguagePreference());
const results: { name: string; refusal: string | null; passed: boolean }[] = [];
try {
  for (const check of CHECKS) {
    const message = await refusal(page, check);
    results.push({ name: check.name, refusal: message, passed: message?.includes(check.refusal) ?? false });
  }
  const languageAfter = await page.evaluate(() => window.openbot.getAppLanguagePreference());
  results.push({
    name: "a refused language request leaves the saved language unchanged",
    refusal: null,
    passed: languageAfter.language === languageBefore.language,
  });
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ results }, null, 2)}\n`);
  await session.close();
}
const failed = results.filter((result) => !result.passed);
for (const result of failed) logger.error(`Failed: ${result.name}.`, { refusal: result.refusal });
assert.equal(failed.length, 0, `${failed.length} of ${results.length} IPC input checks failed.`);
logger.info(`Passed ${results.length} IPC input checks. Wrote ${resolve(OUT, "report.json")}.`);
