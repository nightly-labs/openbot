import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ROUTINE_LIMIT_POLICIES, ROUTINE_MISSED_POLICIES } from "@openbot/contracts/ipc";
import { z } from "zod";
import { WEBHOOK_EVENT_TYPE_MAX_LENGTH, WEBHOOK_FILTERS_LIMIT } from "./webhook-trigger";

const ROUTINE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const routineTimeSchema = z.string().regex(ROUTINE_TIME_PATTERN).describe("Local time in HH:mm format.");
const routineDaySelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every-day") }).strict(),
  z.object({ kind: z.literal("days-of-week"), days: z.array(z.number().int().min(0).max(6)).min(1) }).strict(),
  z.object({ kind: z.literal("days-of-month"), days: z.array(z.number().int().min(1).max(31)).min(1) }).strict(),
]);
const routineTimeSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at-time"), time: routineTimeSchema }).strict(),
  z
    .object({
      kind: z.literal("every"),
      amount: z.number().int().min(1).max(100_000),
      unit: z.enum(["minutes", "hours"]),
    })
    .strict(),
]);

export const routineScheduleZodSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("hourly"), minute: z.number().int().min(0).max(59) }).strict(),
    z.object({ kind: z.literal("daily"), time: routineTimeSchema }).strict(),
    z.object({ kind: z.literal("weekdays"), time: routineTimeSchema }).strict(),
    z.object({ kind: z.literal("weekly"), weekday: z.number().int().min(0).max(6), time: routineTimeSchema }).strict(),
    z.object({ kind: z.literal("monthly"), day: z.number().int().min(1).max(31), time: routineTimeSchema }).strict(),
    z
      .object({
        kind: z.literal("interval"),
        amount: z.number().int().min(1).max(100_000),
        unit: z.enum(["minutes", "hours", "days"]),
        anchorAt: z.string().describe("An ISO 8601 date-time anchoring the interval."),
      })
      .strict(),
    z
      .object({
        kind: z.literal("advanced"),
        months: z.array(z.number().int().min(1).max(12)).min(1),
        days: routineDaySelectionSchema,
        time: routineTimeSelectionSchema,
      })
      .strict(),
    z.object({ kind: z.literal("custom"), expression: z.string().min(1).max(INPUT_LIMITS.routineCron) }).strict(),
    z
      .object({
        kind: z.literal("once"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Local date in YYYY-MM-DD format."),
        time: routineTimeSchema,
      })
      .strict()
      .describe(
        "One run at this local date and time, such as a reminder. The routine then pauses and does not repeat.",
      ),
  ])
  .describe("Routine schedule. Weekdays use 0 for Sunday through 6 for Saturday; clock values use HH:mm local time.");

/**
 * Each run starts a new provider session that reads only the newest chat messages, so an instruction
 * that leans on the chat ("check the mail as before") leaves the run without the way to do it.
 */
export const ROUTINE_INSTRUCTION_RULE =
  "Each run starts a new session that sees only the newest chat messages, so write an instruction that a reader with no chat can follow. Name the service and the tool to use, such as openbot_browser for a website with the site and its signed-in tab, or the MCP tool or teammate. Also name the account, the steps, what to report and where, and when to report nothing. Do not write 'as before' or refer to the chat.";

export const routineInstructionZodSchema = z
  .string()
  .min(1)
  .max(INPUT_LIMITS.routineInstruction)
  .describe(`What each run does. ${ROUTINE_INSTRUCTION_RULE}`);

export const routineLimitPolicyZodSchema = z
  .enum(ROUTINE_LIMIT_POLICIES)
  .describe(
    "What a run does while the agent's provider account is at its usage limit: wait runs it after the reset, skip drops it. New routines use wait. A one-time schedule always uses wait.",
  );

export const routineMissedPolicyZodSchema = z
  .enum(ROUTINE_MISSED_POLICIES)
  .describe(
    "What the routine does with occurrences that came due while OpenBot or its server was off: skip records and drops them, run-once runs the newest one when OpenBot starts and records the others. When a routine is created with no value, a one-time schedule uses run-once and other schedules use skip. An update with no value keeps the saved policy.",
  );

export const webhookEventTypeZodSchema = z
  .string()
  .min(1)
  .max(WEBHOOK_EVENT_TYPE_MAX_LENGTH)
  .nullable()
  .describe(
    'Only a request whose body "type" equals this value starts the routine. Null or omitted accepts every type.',
  );

export const webhookFiltersZodSchema = z
  .array(
    z
      .object({
        pointer: z
          .string()
          .max(2048)
          .describe('A JSON Pointer into the request "data", such as /repository/name. "" selects all of "data".'),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
      .strict(),
  )
  .max(WEBHOOK_FILTERS_LIMIT)
  .describe("A request starts the routine only when every filter matches. Omit for no filter.");
