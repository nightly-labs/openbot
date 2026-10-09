import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/agent";

export const messages = {
  "mobile.agent.home.markAllRead": "Marcar todo como leído",
} as const satisfies PartialTranslation<typeof source>;
