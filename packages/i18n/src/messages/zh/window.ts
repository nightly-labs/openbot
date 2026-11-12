import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "OpenBot 本地主机",
  "window.localClientTitle": "OpenBot 本地客户端",
  "window.computerUsePermissionTitle": "开启 Computer Use",
  "window.controls.label": "窗口",
  "window.controls.minimize": "最小化",
  "window.controls.maximize": "最大化",
  "window.controls.restore": "还原",
  "window.controls.close": "关闭",
} as const satisfies PartialTranslation<typeof source>;
