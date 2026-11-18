import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot מארח מקומי",
  "window.localClientTitle": "OpenBot לקוח מקומי",
  "window.computerUsePermissionTitle": "הפעלת שליטה במחשב",
} as const satisfies PartialTranslation<typeof source>;
