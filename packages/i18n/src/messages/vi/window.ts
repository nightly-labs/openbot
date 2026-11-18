import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot – Host cục bộ",
  "window.localClientTitle": "OpenBot – Máy khách cục bộ",
  "window.computerUsePermissionTitle": "Bật Điều khiển máy tính",
} as const satisfies PartialTranslation<typeof source>;
