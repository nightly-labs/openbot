import type { AgentImportPreview, HermesImportPreview } from "@openbot/contracts/ipc";

const MB = 1024 ** 2;

/** A Grok Bot export with three agents, as `agentImport.choose` answers it. */
export const AGENT_IMPORT_PREVIEW: AgentImportPreview = {
  token: "import-preview",
  sourceApp: "grok-bot",
  exportedAt: "2026-09-22T16:40:00.000Z",
  agents: [
    {
      key: "research",
      name: "Research",
      title: "Market research analyst",
      description: "Finds sources, compares competitors, and writes short cited briefs.",
      avatarUrl: null,
      skillCount: 3,
      routineCount: 2,
      memoryCount: 14,
      fileCount: 48,
      fileBytes: Math.round(12.4 * MB),
      nameExists: false,
    },
    {
      key: "inbox",
      name: "Inbox Triage",
      title: "Email assistant",
      description: "Sorts email each morning and drafts replies for review.",
      avatarUrl: null,
      skillCount: 1,
      routineCount: 1,
      memoryCount: 6,
      fileCount: 0,
      fileBytes: 0,
      nameExists: false,
    },
    {
      key: "sales",
      name: "Sales Outbound",
      title: "",
      description: "Writes first-touch emails from a lead list.",
      avatarUrl: null,
      skillCount: 0,
      routineCount: 0,
      memoryCount: 3,
      fileCount: 8,
      fileBytes: Math.round(0.4 * MB),
      nameExists: true,
    },
  ],
  channels: [
    {
      key: "pipeline",
      name: "Pipeline review",
      title: "Weekly deal review",
      memberKeys: ["research", "sales"],
      leadKey: "sales",
      memoryCount: 4,
      routineCount: 1,
    },
    {
      key: "desk",
      name: "Front desk",
      title: "",
      memberKeys: ["research", "inbox", "sales"],
      leadKey: null,
      memoryCount: 0,
      routineCount: 0,
    },
  ],
  warnings: [],
};

export const AGENT_IMPORT_WARNINGS = [
  "Research: routine “Hourly price check” is skipped because its name, text, or schedule is invalid.",
];

/** The start of the export skill, as `agentImport.readSkill` answers it. */
export const AGENT_IMPORT_SKILL = `---
name: openbot-export
description: Export the user's Grok Bot agents into one .zip file that OpenBot imports.
---

# Export agents for OpenBot
`;

/** The start of the Hermes export skill, as `agentImport.readSkill("hermes-agent")` answers it. */
export const HERMES_EXPORT_SKILL = `---
name: openbot-export
description: Export the user's Hermes Agent profiles into one .zip file that OpenBot imports.
---

# Export Hermes profiles for OpenBot
`;

/** Three Hermes profiles, as `agentImport.readHermes` answers them. */
export const HERMES_IMPORT_PREVIEW: HermesImportPreview = {
  token: "hermes-preview",
  home: "~/.hermes",
  profiles: [
    {
      key: "default",
      name: "Hermes",
      path: "~/.hermes",
      model: "openrouter · nousresearch/hermes-4-405b",
      agent: null,
      items: [
        { id: "instructions", kind: "instructions", status: "ready", names: [], count: 1840, reason: null },
        { id: "memories", kind: "memories", status: "ready", names: [], count: 25, reason: null },
        {
          id: "skills",
          kind: "skills",
          status: "ready",
          names: ["obsidian-notes", "himalaya-email", "arxiv-search", "daily-brief"],
          count: 4,
          reason: null,
        },
        {
          id: "skill:github-pr-review",
          kind: "skill",
          status: "approve",
          names: ["github-pr-review"],
          count: 1,
          reason: "scripts",
        },
        { id: "builtInSkills", kind: "builtInSkills", status: "skipped", names: [], count: 71, reason: "builtIn" },
        {
          id: "mcp:filesystem",
          kind: "mcpServer",
          status: "approve",
          names: ["filesystem"],
          count: 1,
          reason: "mcpOff",
        },
        { id: "mcp:github", kind: "mcpServer", status: "skipped", names: ["github"], count: 1, reason: "mcpNameTaken" },
        {
          id: "routines",
          kind: "routines",
          status: "ready",
          names: ["Morning brief", "Inbox zero"],
          count: 2,
          reason: null,
        },
        {
          id: "secrets",
          kind: "secrets",
          status: "skipped",
          names: ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "TELEGRAM_BOT_TOKEN"],
          count: 3,
          reason: "secrets",
        },
        { id: "history", kind: "history", status: "skipped", names: [], count: 0, reason: "history" },
      ],
    },
    {
      key: "coder",
      name: "Coder",
      path: "~/.hermes/profiles/coder",
      model: "anthropic · claude-sonnet-5-5",
      agent: null,
      items: [
        { id: "instructions", kind: "instructions", status: "ready", names: [], count: 620, reason: null },
        { id: "memories", kind: "memories", status: "ready", names: [], count: 9, reason: null },
        {
          id: "skills",
          kind: "skills",
          status: "ready",
          names: ["git-workflow", "test-runner", "code-review"],
          count: 3,
          reason: null,
        },
        { id: "mcp:linear", kind: "mcpServer", status: "approve", names: ["linear"], count: 1, reason: "mcpOff" },
        { id: "terminal", kind: "terminal", status: "skipped", names: ["docker"], count: 0, reason: "terminalBackend" },
        { id: "secrets", kind: "secrets", status: "skipped", names: ["GITHUB_TOKEN"], count: 1, reason: "secrets" },
      ],
    },
    {
      key: "research-desk",
      name: "Research desk",
      path: "~/.hermes/profiles/research-desk",
      model: "nous · hermes-4-70b",
      agent: null,
      items: [
        { id: "instructions", kind: "instructions", status: "ready", names: [], count: 2600, reason: null },
        { id: "memories", kind: "memories", status: "ready", names: [], count: 41, reason: null },
        {
          id: "skills",
          kind: "skills",
          status: "ready",
          names: ["arxiv-search", "market-scan", "digest-writer"],
          count: 3,
          reason: null,
        },
        { id: "routines", kind: "routines", status: "ready", names: ["Monday digest"], count: 1, reason: null },
        {
          id: "routine:0",
          kind: "routine",
          status: "skipped",
          names: ["Price watcher"],
          count: 1,
          reason: "routineScript",
        },
        { id: "gateway", kind: "gateway", status: "skipped", names: ["telegram"], count: 0, reason: "gateway" },
        {
          id: "secrets",
          kind: "secrets",
          status: "skipped",
          names: ["TELEGRAM_BOT_TOKEN", "SERPAPI_KEY"],
          count: 2,
          reason: "secrets",
        },
      ],
    },
  ],
};
