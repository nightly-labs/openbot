import type {
  InstanceTransferAgent,
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
} from "@openbot/contracts/ipc";
import { AGENT_IMPORT_PREVIEW } from "./agent-import-fixtures";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function transferAgent(
  id: string,
  name: string,
  title: string,
  counts: Omit<InstanceTransferAgent, "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl">,
): InstanceTransferAgent {
  return { id, name, title, avatarSeed: id, avatarHue: null, avatarUrl: null, ...counts };
}

/** This computer, as `instanceTransfer.summary` answers it. */
export const INSTANCE_TRANSFER_SUMMARY: InstanceTransferSummary = {
  agents: [
    transferAgent("research", "Research", "Market research analyst", {
      skillCount: 4,
      routineCount: 2,
      memoryCount: 38,
      fileCount: 312,
      fileBytes: Math.round(184 * MB),
    }),
    transferAgent("inbox", "Inbox Triage", "Email assistant", {
      skillCount: 1,
      routineCount: 3,
      memoryCount: 12,
      fileCount: 0,
      fileBytes: 0,
    }),
    transferAgent("site", "Website Builder", "Landing pages and hosted sites", {
      skillCount: 6,
      routineCount: 0,
      memoryCount: 21,
      fileCount: 2_480,
      fileBytes: Math.round(0.9 * GB),
    }),
    transferAgent("finance", "Finance and Invoicing Assistant for the Kraków Office", "Monthly close and VAT reports", {
      skillCount: 3,
      routineCount: 4,
      memoryCount: 50,
      fileCount: 96,
      fileBytes: Math.round(22 * MB),
    }),
    transferAgent("devops", "DevOps", "Watches deploys and CI", {
      skillCount: 5,
      routineCount: 6,
      memoryCount: 29,
      fileCount: 640,
      fileBytes: Math.round(71 * MB),
    }),
  ],
};

/** A transfer file, as `instanceTransfer.choose` answers it. */
export const INSTANCE_TRANSFER_PREVIEW: InstanceTransferPreview = {
  token: "transfer-preview",
  appVersion: "0.9.4",
  exportedAt: "2026-10-12T18:20:00.000Z",
  agents: AGENT_IMPORT_PREVIEW.agents,
  hasSettings: true,
  warnings: [],
};

export const INSTANCE_TRANSFER_WARNINGS = [
  'Research: the model "llama-4-70b" is not available here yet, so the agent uses the default model. Choose the model again when its provider is ready.',
  "GitHub: the MCP server is added turned off. Check its command, enter its values and full address again, and turn it on in Marketplace, Apps.",
];

export const INSTANCE_TRANSFER_RESULT: Omit<InstanceTransferResult, "agents"> = {
  skipped: [{ key: "sales", name: "Sales Outbound", reason: "SKILL.md must begin with YAML frontmatter." }],
  signIn: ["claude", "codex"],
  warnings: INSTANCE_TRANSFER_WARNINGS,
};
