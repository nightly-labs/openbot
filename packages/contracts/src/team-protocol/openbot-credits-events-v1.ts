import { isDynamicRecord } from "../runtime-values";

export const OPENBOT_CREDITS_EVENTS_CAPABILITY = "openbot-credits-events-v1";

export type OpenBotCreditsEvent = { type: "openbot-credits-changed" };

export function openBotCreditsEvent(value: unknown): OpenBotCreditsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "openbot-credits-changed") return null;
  return { type: "openbot-credits-changed" };
}
