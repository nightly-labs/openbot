// Run: bun scripts/mobile-qa-routing-smoke.ts
// Exercises the real instruction generator without starting a provider or device.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { developerInstructions } from "../src/backend/agent/developer-instructions";

const agent: AgentSummary = {
  id: "synthetic-routing",
  name: "Routing fixture",
  title: "",
  description: "",
  notifications: false,
  provider: "codex",
  model: "synthetic",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/synthetic/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: "synthetic",
  avatarHue: null,
  avatarUrl: null,
};
const cases = [];
for (const computerUse of [true, false]) {
  for (const sideThread of [true, false]) {
    for (const computerUseInOwnChat of [true, false]) {
      const text = developerInstructions(
        { ...agent, computerUse },
        "/synthetic/shared",
        [],
        "/synthetic/automation",
        DEFAULT_AGENT_DEFAULTS,
        { sideThread, computerUseInOwnChat },
      );
      const allowed = computerUse && !sideThread && !computerUseInOwnChat;
      assert.equal(text.includes("use the registered Appium MCP tools"), allowed);
      assert.equal(text.includes("QA through Appium is not permitted"), !allowed);
      assert.ok(text.includes("Use openbot_browser tools for browser work"));
      assert.ok(text.includes("Never ask for a secret in chat"));
      if (computerUse) assert.ok(text.includes("for desktop GUI tasks outside the embedded browser"));
      else assert.ok(text.toLowerCase().includes("do not control desktop applications outside the embedded browser"));
      if (allowed) {
        assert.ok(text.includes("Tool registration is not permission"));
        assert.ok(text.includes("take over a device without explicit approval"));
        assert.ok(text.includes("do not ask the user to relay prompts"));
      }
      cases.push({ computerUse, sideThread, computerUseInOwnChat, allowed, status: "pass" });
    }
  }
}
await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/mobile-qa-routing-smoke.json", JSON.stringify({ status: "pass", cases }, null, 2));
process.stdout.write(`PASS: ${cases.length} instruction-routing cases; no provider or device started.\n`);
