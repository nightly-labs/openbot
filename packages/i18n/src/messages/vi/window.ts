import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "Máy chủ cục bộ OpenBot",
  "window.localClientTitle": "Ứng dụng cục bộ OpenBot",
  "window.computerUsePermissionTitle": "Bật Điều khiển máy tính",
} as const satisfies PartialTranslation<typeof source>;
