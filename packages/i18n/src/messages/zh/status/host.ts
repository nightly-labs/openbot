import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "已将本 OpenBot 注册用于 WebRTC 访问。",
  "status.host.keyRotated": "服务器密钥已更改，已配对的设备仍保持配对。",
  "status.host.identityUpdated": "服务器身份信息已更新。",
  "status.host.starting": "正在启动 WebRTC 主机…",
  "status.host.ready": "本 OpenBot 已可用于 WebRTC 连接。",
  "status.host.stopping": "正在将本 OpenBot 设为私有…",
  "status.host.private": "本 OpenBot 已设为私有。",
} as const satisfies PartialTranslation<typeof source>;
