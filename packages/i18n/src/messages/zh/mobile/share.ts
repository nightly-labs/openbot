import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "登录后即可分享",
  "mobile.share.signInDescription": "扫描电脑上 OpenBot 显示的二维码，然后就能选择由哪个助手接收你分享的内容。",
  "mobile.share.reading": "正在读取你分享的内容…",
  "mobile.share.readFailed": "OpenBot 无法读取你分享的内容，请重新分享。",
  "mobile.share.content": "待分享内容",
  "mobile.share.footer": "对话会带着这段内容打开并填入输入框，在你发送之前不会发出任何内容。",
  "mobile.share.lastUsed": "最近使用",
  "mobile.share.noAgents": "没有助手",
  "mobile.share.chooseAgent": "选择助手",
  "mobile.share.action": "分享给{name}",
} as const satisfies PartialTranslation<typeof source>;
