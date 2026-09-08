import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

const handoff = {
  recipientAgentId: z.string(),
  task: z.string().min(1).max(INPUT_LIMITS.messageText),
  expectedResult: z.string().min(1).max(INPUT_LIMITS.messageText),
  sourceMessageIds: z.array(z.string()).min(1),
  resources: z
    .array(z.string())
    .describe(
      "Use host for exclusive work, browser for the shared browser, or workspace:<absolute path>. Omission reserves the host. Use none only for work that does not use files or the browser. Declare every resource the task will use.",
    )
    .optional(),
  dependencies: z.array(z.string()).optional(),
};

export const CHANNEL_TOOL_DEFINITIONS: readonly { name: string; description: string; shape: z.ZodRawShape }[] = [
  {
    name: "channel_history",
    description:
      "Read earlier shared channel messages or an agent conversation on this server. This never starts another agent.",
    shape: {
      beforeSequence: z.number().int().min(0).optional(),
      threadId: z.string().optional(),
      cursor: z.string().optional(),
      attachmentId: z.string().optional(),
    },
  },
  {
    name: "channel_assign",
    description:
      "Assign one specific subtask to another channel member. Keep ownership of the parent task. End your turn while waiting for required results.",
    shape: handoff,
  },
  {
    name: "channel_transfer",
    description: "Transfer this task to another channel member. End your turn after the transfer.",
    shape: handoff,
  },
  {
    name: "channel_result",
    description: "Publish the requested task result once in the shared chat. End your turn without repeating it.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.messageText) },
  },
];
