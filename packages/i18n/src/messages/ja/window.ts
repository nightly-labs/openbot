import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot ローカルホスト",
  "window.localClientTitle": "OpenBot ローカルクライアント",
  "window.computerUsePermissionTitle": "Computer Use をオンにする",
} as const satisfies PartialTranslation<typeof source>;
