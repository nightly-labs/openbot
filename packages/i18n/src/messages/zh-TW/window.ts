import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "OpenBot 本地主機",
  "window.localClientTitle": "OpenBot 本地客戶端",
  "window.computerUsePermissionTitle": "開啟 Computer Use",
} as const satisfies PartialTranslation<typeof source>;
