import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AgentModelOption, type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import { listModelsPayload } from "../src/backend/agent/model-tools";
import { BUILTIN_TOOL_CATALOG, VISIBLE_DYNAMIC_TOOLS } from "../src/backend/agent/tool-catalog";
import { toolGuidance } from "../src/backend/agent/tool-guidance";
import { runDebtRatchet } from "./debt-ratchet";

// Holds the text that OpenBot adds to an agent's context to the byte counts in
// tools/agent-context/budget.json. `scripts/debt-ratchet.ts` has the rules of the baseline: more bytes
// fail, fewer bytes fail until `--write` lowers the baseline. The fixture agent has no user data, so
// the counts measure only OpenBot's own text. Not measured: the schema that the Claude Agent SDK makes
// from the raw Zod shapes of its visible tools (`claude-client.ts`).

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/agent-context-budget");

const agent: AgentSummary = {
  id: "agent-1",
  name: "Tester",
  title: "",
  description: "",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

/** The options that `ThreadLifecycle.#instructions` passes, with nothing connected and no section. */
function instructions(provider: "claude" | "codex"): string {
  const inTurns = provider === "claude";
  return developerInstructions({ ...agent, provider }, "/shared", [], "/automation", DEFAULT_AGENT_DEFAULTS, {
    computerUseInOwnChat: false,
    sideThread: false,
    passwordVault: false,
    storedMemoryCount: 0,
    memoriesInTurns: inTurns,
    teammatesInTurns: inTurns,
    sectionTeammates: null,
    homeSkills: [],
  });
}

/** A large catalog, as OpenRouter or OpenCode report: 180 models for one provider and 20 for another. */
function syntheticModels(): AgentModelOption[] {
  const model = (provider: AgentModelOption["provider"], index: number): AgentModelOption => ({
    provider,
    id: `vendor-${index % 12}/model-${index}`,
    name: `Vendor ${index % 12} Model ${index}`,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  });
  return [
    ...Array.from({ length: 180 }, (_, index) => model("openrouter", index)),
    ...Array.from({ length: 20 }, (_, index) => model("opencode", index)),
  ];
}

const bytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
const sum = (values: readonly unknown[]) => values.reduce<number>((total, value) => total + bytes(value), 0);

function measure(): Map<string, number> {
  const guidance = new Set(BUILTIN_TOOL_CATALOG.flatMap((entry) => toolGuidance(entry.namespace, entry.tool)));
  return new Map([
    ["instructions.claude", bytes(instructions("claude"))],
    ["instructions.codex", bytes(instructions("codex"))],
    ["visible-tools", bytes(VISIBLE_DYNAMIC_TOOLS)],
    ["catalog.schemas", sum(BUILTIN_TOOL_CATALOG.map((entry) => entry.inputSchema))],
    ["catalog.descriptions", sum(BUILTIN_TOOL_CATALOG.map((entry) => entry.description))],
    ["guidance", sum([...guidance])],
    ["list-models.fixture", bytes(listModelsPayload(syntheticModels(), "codex", () => undefined))],
  ]);
}

runDebtRatchet({
  script: "check:agent-context",
  baselinePath: resolve(ROOT, "tools/agent-context/budget.json"),
  noun: "bytes",
  finishedStep: "Remove the entry from the baseline.",
  inspectHint: `Read ${OUT}/report.json for the counts.`,
  count: (names) => {
    const counts = measure();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(Object.fromEntries(counts), null, 2)}\n`);
    return new Map(names.map((name) => [name, counts]));
  },
});
