import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot 无法启动",
  "startup.failedBody": "{message}\n\n你的本地数据没有被重置或覆盖。请查看故障排查指南了解恢复步骤。",
} as const satisfies PartialTranslation<typeof source>;
