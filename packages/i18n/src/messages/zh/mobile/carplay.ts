import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "已置顶",
  "mobile.carplay.new": "新消息",
  "mobile.carplay.agents": "助手",
  "mobile.carplay.noAgents": "还没有助手",
  "mobile.carplay.locked": "请在 iPhone 上解锁 OpenBot",
  "mobile.carplay.signedOut": "请在 iPhone 上登录 OpenBot",
  "mobile.carplay.voice.listening": "正在聆听…",
  "mobile.carplay.voice.muted": "已静音",
  "mobile.carplay.voice.thinking": "{name} 正在思考",
  "mobile.carplay.voice.offline": "服务器离线",
  "mobile.carplay.voice.unavailable": "请在 iPhone 上设置语音",
} as const satisfies PartialTranslation<typeof source>;
