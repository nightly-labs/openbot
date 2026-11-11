import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";
import { CHANNEL_REPLY_CHARACTERS, CHANNEL_REPLY_LIMIT } from "./channel-replies";
import {
  routineInstructionZodSchema,
  routineLimitPolicyZodSchema,
  routineMissedPolicyUpdateZodSchema,
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
      messageId: z.string().optional(),
      offset: z.number().int().min(0).optional(),
    },
  },
  {
    name: "channel_assign",
    description:
      "Give a subtask to another member only when the person asks for that member or for help, or a part needs their role. You stay the owner: integrate the result and report. End your turn to wait for needed results. In a channel task only; else use openbot.send_message.",
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
    name: "channel_reply",
    description: `Reply in the shared chat to a message of another channel member, in a short message, when you must ask it a question, agree on something with it, or correct it before you can finish. That member gets one turn to answer, and you continue this task with its answer: end your turn after the call. Use channel_assign for work. A request allows ${CHANNEL_REPLY_LIMIT} member replies, and none after your result. Do not reply only to thank or acknowledge, or when you can answer the person without it.`,
    shape: {
      messageId: z.string().min(1).max(INPUT_LIMITS.identifier),
      text: z.string().min(1).max(CHANNEL_REPLY_CHARACTERS),
    },
  },
  {
    name: "channel_cancel",
    description: `Cancel a run that you own when a person asks to drop that work. Give the taskId of its request message or of a subtask: the whole run ends, with its running and queued subtasks. Messages stay. Not for the run of your current task. ${PERSON_ONLY}`,
    shape: { taskId: z.string().min(1).max(INPUT_LIMITS.identifier) },
  },
  {
    name: "channel_remember",
    // The advertised schema has no maxLength, so the limit is in the description.
    description: `Save one durable fact for every channel member to keep, up to ${INPUT_LIMITS.agentMemoryText} characters. Save the same text again to correct it. This writes immediately.`,
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
      missedPolicy: routineMissedPolicyUpdateZodSchema.optional(),
    },
  },
  {
    name: "channel_delete_routine",
    description: `Delete a scheduled routine of this channel. ${PERSON_ONLY}`,
    shape: { routineId: z.string().min(1).max(INPUT_LIMITS.identifier) },
  },
];
