import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

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
  ])
  .describe("Routine schedule. Weekdays use 0 for Sunday through 6 for Saturday; clock values use HH:mm local time.");
