// Run: bun scripts/mobile-qa-routing-smoke.ts
// Exercises the real instruction generator and the real Appium classifier without starting a provider
// or a device. Each case builds MCP configurations, and derives "Appium configured" the way the thread
// lifecycle does: the per-agent list, then the Appium classifier.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS, type McpServerConfig } from "@openbot/contracts/ipc";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import { agentMcpServers, isAppiumMcpServer } from "../src/backend/mcp-provider-shapes";

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

function server(overrides: Partial<McpServerConfig> & Pick<McpServerConfig, "id" | "name">): McpServerConfig {
  return {
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

/** A registered Appium MCP server, as a user registers it from npx, and an unrelated server. */
const appium = server({ id: "synthetic-appium", name: "appium-mcp", args: ["-y", "appium-mcp"] });
const unrelated = server({
  id: "synthetic-github",
  name: "github",
  transport: "http",
  command: "",
  url: "https://example.invalid/mcp",
});
const registrations = { registered: [appium, unrelated], unregistered: [unrelated] } as const;

// Tool identifiers and capability keys that the iOS recipe must expose only when Appium is configured and allowed.
const IOS_RECIPE_IDENTIFIERS = [
  "appium_session_management",
  "select_device",
  "appium_get_page_source",
  "prepare_ios_simulator",
  "appium:usePrebuiltWDA false",
  "appium:noReset true",
  "appium:forceAppLaunch false",
  "appium:shouldTerminateApp false",
];
const UPSTREAM_QA_SENTENCE = "For explicitly scoped native iOS or Android QA, use the registered Appium MCP tools";
const DENIED_QA_SENTENCE = "QA through Appium is not permitted";

interface RoutingCase {
  registration: string;
  computerUse: boolean;
  sideThread: boolean;
  computerUseInOwnChat: boolean;
  permitted: boolean;
  appiumConfigured: boolean;
  recipe: boolean;
  status: "pass";
}
const cases: RoutingCase[] = [];
for (const [registration, configs] of Object.entries(registrations)) {
  for (const computerUse of [true, false]) {
    for (const sideThread of [true, false]) {
      for (const computerUseInOwnChat of [true, false]) {
        // The same rule as ThreadLifecycle: the per-agent list, then the Appium classifier.
        const appiumConfigured = agentMcpServers(configs, computerUse).some(isAppiumMcpServer);
        const text = developerInstructions(
          { ...agent, computerUse },
          "/synthetic/shared",
          [],
          "/synthetic/automation",
          DEFAULT_AGENT_DEFAULTS,
          { sideThread, computerUseInOwnChat, appiumConfigured },
        );
        const permitted = computerUse && !sideThread && !computerUseInOwnChat;
        assert.equal(
          appiumConfigured,
          registration === "registered" && computerUse,
          "The classifier matches the list.",
        );
        // The denial is for every conversation that is not permitted, configured or not. The rule is for a
        // permitted conversation with a configured server. A permitted one without a server has no Appium line.
        assert.equal(
          text.includes(UPSTREAM_QA_SENTENCE),
          appiumConfigured && permitted,
          "The rule needs a server and permission.",
        );
        assert.equal(
          text.includes(DENIED_QA_SENTENCE),
          !permitted,
          "The denial is for every conversation not permitted.",
        );
        assert.ok(text.includes("Use openbot_browser tools for browser work"));
        assert.ok(text.includes("Never ask for a secret in chat"));
        if (computerUse) {
          const route = permitted && appiumConfigured;
          assert.ok(
            text.includes(
              route
                ? "for desktop GUI tasks outside the embedded browser"
                : "for every GUI task outside the embedded browser",
            ),
          );
        } else
          assert.ok(text.toLowerCase().includes("do not control desktop applications outside the embedded browser"));
        if (permitted && appiumConfigured) {
          assert.ok(text.includes("Tool registration is not permission"));
          assert.ok(text.includes("take over a device without explicit approval"));
          assert.ok(text.includes("do not ask the user to relay prompts"));
        }
        for (const identifier of IOS_RECIPE_IDENTIFIERS) {
          const expected = permitted && appiumConfigured;
          assert.equal(text.includes(identifier), expected, `${identifier} is ${expected ? "present" : "absent"}.`);
        }
        if (registration === "unregistered" && permitted) {
          // Upstream, byte for byte: no Appium line and the "every GUI task" wording.
          assert.ok(!text.includes("Appium"), "A permitted conversation without Appium has no Appium line.");
          assert.ok(text.includes("for every GUI task outside the embedded browser"));
        }
        cases.push({
          registration,
          computerUse,
          sideThread,
          computerUseInOwnChat,
          permitted,
          appiumConfigured,
          recipe: permitted && appiumConfigured,
          status: "pass",
        });
      }
    }
  }
}
// The two real cases that the policy turns on, named: Computer Use off after the filter, and an eligible
// chat with a registered server.
const offFiltered = cases.find(
  (c) => c.registration === "registered" && !c.computerUse && !c.sideThread && !c.computerUseInOwnChat,
);
const eligibleRegistered = cases.find(
  (c) => c.registration === "registered" && c.computerUse && !c.sideThread && !c.computerUseInOwnChat,
);
assert.equal(offFiltered?.appiumConfigured, false, "Computer Use off: the filter removes the Appium server.");
assert.equal(offFiltered?.permitted, false, "Computer Use off is not permitted.");
assert.equal(eligibleRegistered?.appiumConfigured, true, "An eligible chat keeps its registered server.");
assert.equal(eligibleRegistered?.recipe, true, "An eligible chat with a registered server gets the recipe.");
await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/mobile-qa-routing-smoke.json", JSON.stringify({ status: "pass", cases }, null, 2));
process.stdout.write(`PASS: ${cases.length} instruction-routing cases; no provider or device started.\n`);
