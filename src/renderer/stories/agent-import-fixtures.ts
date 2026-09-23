import type { AgentImportPreview } from "@openbot/contracts/ipc";

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
    },
  ],
  warnings: [],
};

export const AGENT_IMPORT_WARNINGS = [
  "Research: routine “Hourly price check” is skipped because its name, text, or schedule is invalid.",
  "Sales Outbound: an agent with this name already exists. The import adds a second one.",
];
