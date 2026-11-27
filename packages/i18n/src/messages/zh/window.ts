import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot 本地主机",
  "window.localClientTitle": "OpenBot 本地客户端",
  "window.computerUsePermissionTitle": "开启 Computer Use",
  "window.rendererStoppedTitle": "OpenBot 已停止工作",
  "window.rendererStoppedBody": "窗口多次停止运行。你的聊天已保存，智能体仍在继续工作。",
  "window.rendererStoppedReload": "重新加载",
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "window.restore": "还原",
} as const satisfies PartialTranslation<typeof source>;
