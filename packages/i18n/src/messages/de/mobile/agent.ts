import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/agent";

export const messages = {
  "mobile.agent.home.markAllRead": "Alle als gelesen markieren",
} as const satisfies PartialTranslation<typeof source>;
