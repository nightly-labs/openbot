import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "OpenBot 本地主机",
  "window.localClientTitle": "OpenBot 本地客户端",
  "window.computerUsePermissionTitle": "开启 Computer Use",
} as const satisfies PartialTranslation<typeof source>;
