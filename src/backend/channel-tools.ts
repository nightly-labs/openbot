import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";
import {
  routineInstructionZodSchema,
  routineLimitPolicyZodSchema,
  routineMissedPolicyZodSchema,
  routineScheduleZodSchema,
} from "./routine-tool-schema";

const handoff = {
  recipientAgentId: z.string(),
  task: z.string().min(1).max(INPUT_LIMITS.messageText),
  expectedResult: z.string().min(1).max(INPUT_LIMITS.messageText),
  sourceMessageIds: z.array(z.string()).min(1),
  resources: z
    .array(z.string())
    .describe(
      "Use browser when the task uses the shared browser, and workspace:<absolute path> for each folder it changes. Tasks that declare the same resource run one after the other. Omit it, or use none, when the task needs neither.",
    )
    .optional(),
  dependencies: z.array(z.string()).optional(),
};

const PERSON_ONLY =
  "It changes only this channel, and only in a task that a person's message started, not a routine run.";

export const CHANNEL_TOOL_DEFINITIONS: readonly { name: string; description: string; shape: z.ZodRawShape }[] = [
  {
    name: "channel_history",
    description: "Read earlier shared channel messages. This never starts another agent.",
    shape: {
      beforeSequence: z.number().int().min(0).optional(),
      attachmentId: z.string().optional(),
    },
  },
  {
    name: "channel_assign",
    description:
      "Assign one specific subtask to another channel member. You stay the owner: integrate the result and report to the user. End your turn while waiting for required results. Use only inside a channel task; for direct teammate work outside a channel use openbot.send_message.",
    shape: handoff,
  },
  {
    name: "channel_transfer",
    description:
      "Transfer this whole task to another channel member. You stop working on it. End your turn after the transfer.",
    shape: handoff,
  },
  {
    name: "channel_result",
    description:
      "Publish the requested task result once in the shared chat when answering an assigned or transferred task. End your turn without repeating it.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.messageText) },
  },
  {
    name: "channel_remember",
    description:
      "Save one short, durable fact about this channel that every member should keep. Save the same text again to correct it. This writes immediately.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.agentMemoryText) },
  },
  {
    name: "channel_forget_memory",
    description:
      "Delete one saved channel memory when the user asks the channel to forget it. Give its text exactly as it is listed.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.agentMemoryText) },
  },
  {
    name: "channel_add_member",
    description: `Add an agent to this channel when a person asks for it. Get its id from openbot.list_agents. ${PERSON_ONLY}`,
    shape: { agentId: z.string().min(1).max(INPUT_LIMITS.identifier) },
  },
  {
    name: "channel_remove_member",
    description: `Remove an agent from this channel when a person asks for it. Its open tasks here stop. You cannot remove yourself. ${PERSON_ONLY}`,
    shape: { agentId: z.string().min(1).max(INPUT_LIMITS.identifier) },
  },
  {
    name: "channel_set_instructions",
    description: `Replace the instructions of this channel when a person asks for it. Send the whole new text; an empty text removes them. ${PERSON_ONLY}`,
    shape: { instructions: z.string().max(INPUT_LIMITS.agentDescription) },
  },
  {
    name: "channel_list_routines",
    description:
      "List the scheduled routines of this channel. Use it before you change or delete one. It works only in a task that a person's message started.",
    shape: {},
  },
  {
    name: "channel_create_routine",
    description: `Create a scheduled routine that sends its instruction to this channel. It is active by default. Without a timezone, it uses the server timezone. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. ${PERSON_ONLY}`,
    shape: {
      name: z.string().min(1).max(INPUT_LIMITS.routineName),
      instruction: routineInstructionZodSchema,
      schedule: routineScheduleZodSchema,
      active: z.boolean().optional(),
      timezone: z.string().min(1).max(128).describe("IANA timezone such as Europe/Warsaw.").optional(),
      limitPolicy: routineLimitPolicyZodSchema.optional(),
      missedPolicy: routineMissedPolicyZodSchema.optional(),
    },
  },
  {
    name: "channel_update_routine",
    description: `Change, pause, or resume a scheduled routine of this channel. Fields you leave out keep their saved values. ${PERSON_ONLY}`,
    shape: {
      routineId: z.string().min(1).max(INPUT_LIMITS.identifier),
      name: z.string().min(1).max(INPUT_LIMITS.routineName).optional(),
      instruction: routineInstructionZodSchema.optional(),
      schedule: routineScheduleZodSchema.optional(),
      active: z.boolean().optional(),
      limitPolicy: routineLimitPolicyZodSchema.optional(),
      missedPolicy: routineMissedPolicyZodSchema.optional(),
    },
  },
  {
    name: "channel_delete_routine",
    description: `Delete a scheduled routine of this channel. ${PERSON_ONLY}`,
    shape: { routineId: z.string().min(1).max(INPUT_LIMITS.identifier) },
  },
];
