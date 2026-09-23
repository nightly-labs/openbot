import type { GetStorageUsageInput, StorageDesktopApi, StorageUsage } from "@openbot/contracts/ipc";
import {
  FILES_AGENT_USAGE,
  FILES_BREAKDOWN,
  FILES_CHIEF_BREAKDOWN,
  FILES_CONVERSATIONS,
  FILES_ROWS,
} from "../../stories/files-fixtures";

const GB = 1024 ** 3;

/** The Files fixtures as one server's storage, so a delete or clear in the preview shows at once. */
export function createMockStorage(): StorageDesktopApi {
  let files = structuredClone(FILES_ROWS);
  let breakdown = structuredClone(FILES_BREAKDOWN);

  const usage = (input: GetStorageUsageInput): StorageUsage => {
    const inScope = (agentId: string | null, conversationId: string | null) =>
      input.scope === "host" ||
      (input.scope === "agent" ? agentId === input.agentId : conversationId === input.conversationId);
    const scopedFiles = files.filter((file) => inScope(file.agentId, file.conversation?.id ?? null));
    const agentBreakdown = input.scope === "agent" && input.agentId === "chief" ? FILES_CHIEF_BREAKDOWN : [];
    return structuredClone({
      scope: input.scope,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      scannedAt: new Date().toISOString(),
      freeBytes: 182 * GB,
      breakdown: input.scope === "host" ? breakdown : agentBreakdown,
      agents: FILES_AGENT_USAGE.filter((row) => input.scope === "host" || row.agentId === input.agentId),
      conversations: FILES_CONVERSATIONS.filter((row) => inScope(row.agentId, row.id)),
      files: scopedFiles,
      truncated: false,
    });
  };

  return {
    getUsage: async (input) => usage(input),
    deleteFile: async ({ fileId }) => {
      if (!files.some((file) => file.id === fileId)) throw new Error("The file does not exist or is already deleted.");
      files = files.filter((file) => file.id !== fileId);
    },
    clear: async ({ category }) => {
      breakdown = breakdown.map((row) => (row.category === category ? { ...row, bytes: 0 } : row));
    },
    openFile: async () => undefined,
    openLocation: async () => undefined,
  };
}
