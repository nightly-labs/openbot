import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Lokale OpenBot-host",
  "window.localClientTitle": "Lokale OpenBot-client",
  "window.computerUsePermissionTitle": "Zet Computerbesturing aan",
} as const satisfies PartialTranslation<typeof source>;
