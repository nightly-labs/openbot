// Frozen wire shape for the optional host-analytics capability. Do not import current IPC types here.
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV1JsonObject } from "./v1";

function record(value: unknown) {
  if (!isDynamicRecord(value)) throw new Error("Invalid analytics response.");
  return value;
}
function text(value: unknown): string {
  if (!isString(value) || value.length > 256) throw new Error("Invalid analytics text.");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid analytics number.");
  return value;
}
function totals(value: unknown): TeamProtocolV1JsonObject {
  const input = record(value);
  const output: TeamProtocolV1JsonObject = {};
  for (const key of ["uncachedInput", "cachedInput", "cacheCreation", "output", "estimatedCostUsd"])
    output[key] = input[key] === null ? null : number(input[key]);
  for (const key of [
    "processedTokens",
    "sessions",
    "userMessages",
    "assistantMessages",
    "turns",
    "missingUsageTurns",
    "unpricedRecords",
    "incompleteRecords",
  ])
    output[key] = number(input[key]);
  return output;
}
export function decodeHostAnalyticsV1Response(value: unknown): TeamProtocolV1JsonObject {
  const input = record(value);
  if (!Array.isArray(input.daily) || !Array.isArray(input.models)) throw new Error("Invalid analytics rows.");
  return {
    ...(input.agentId === undefined ? {} : { agentId: text(input.agentId) }),
    startDate: text(input.startDate),
    endDate: text(input.endDate),
    timeZone: text(input.timeZone),
    collectionStartedAt: text(input.collectionStartedAt),
    updatedAt: input.updatedAt === null ? null : text(input.updatedAt),
    totals: totals(input.totals),
    daily: input.daily.map((value) => {
      const day = record(value);
      return { ...totals(day), date: text(day.date) };
    }),
    models: input.models.map((value) => {
      const model = record(value);
      const share = number(model.share);
      if (share > 1) throw new Error("Invalid analytics share.");
      return { ...totals(model), provider: text(model.provider), model: text(model.model), share };
    }),
  };
}
