import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "已將本 OpenBot 註冊用於 WebRTC 訪問。",
  "status.host.keyRotated": "伺服器金鑰已更改，已配對的裝置仍保持配對。",
  "status.host.identityUpdated": "伺服器身分資訊已更新。",
  "status.host.starting": "正在啟動 WebRTC 主機…",
  "status.host.ready": "本 OpenBot 已可用於 WebRTC 連線。",
  "status.host.stopping": "正在將本 OpenBot 設為私有…",
  "status.host.private": "本 OpenBot 已設為私有。",
} as const satisfies PartialTranslation<typeof source>;
