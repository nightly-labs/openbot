import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

const memoryId = z.string().min(1).max(INPUT_LIMITS.identifier);

export const searchMemoriesInput = z.strictObject({
  query: z.string().trim().min(1).max(256),
  limit: z.number().int().min(1).max(10).optional(),
});

export const listMemoriesInput = z.strictObject({
  after: memoryId.nullable().optional(),
});

export const setMemoryInclusionInput = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        memoryId,
        inclusion: z.enum(["essential", "searchable"]),
        expectedRevision: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(25),
});

export const MEMORY_RECALL_TOOL_DEFINITIONS = [
  {
    name: "search_memories",
    description:
      "Search your saved memories when a past preference, decision, or fact can help with the current task. Returns committed entries and their selection revisions. Search terms are literal words, not query operators. No match means the fact was not found; do not invent it.",
    shape: searchMemoriesInput.shape,
  },
  {
    name: "list_memories",
    description:
      "Read a bounded page of your saved memories for review or maintenance. Pass nextCursor as after to continue. Search is usually better for a specific fact.",
    shape: listMemoriesInput.shape,
  },
  {
    name: "set_memory_inclusion",
    description:
      "Stage selection of memories to include in every prompt. Use essential only for facts needed across tasks, and searchable for other facts. Read current revisions with search_memories or list_memories. Changes commit together only after a successful turn, within the prompt budget. User-controlled choices cannot be changed. This never deletes memory text.",
    shape: setMemoryInclusionInput.shape,
  },
];
