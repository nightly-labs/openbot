import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "OpenBot ローカルホスト",
  "window.localClientTitle": "OpenBot ローカルクライアント",
  "window.computerUsePermissionTitle": "Computer Use をオンにする",
  "window.controls.label": "ウィンドウ",
  "window.controls.minimize": "最小化",
  "window.controls.maximize": "最大化",
  "window.controls.restore": "元のサイズに戻す",
  "window.controls.close": "閉じる",
} as const satisfies PartialTranslation<typeof source>;
