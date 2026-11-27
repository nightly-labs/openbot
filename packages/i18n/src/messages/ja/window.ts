import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot ローカルホスト",
  "window.localClientTitle": "OpenBot ローカルクライアント",
  "window.computerUsePermissionTitle": "Computer Use をオンにする",
  "window.rendererStoppedTitle": "OpenBot が停止しました",
  "window.rendererStoppedBody":
    "ウィンドウが何度か停止しました。チャットは保存されており、エージェントは動作を続けています。",
  "window.rendererStoppedReload": "再読み込み",
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "window.restore": "元に戻す",
} as const satisfies PartialTranslation<typeof source>;
