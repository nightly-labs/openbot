import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "ピン留め",
  "mobile.carplay.new": "新着",
  "mobile.carplay.agents": "エージェント",
  "mobile.carplay.noAgents": "エージェントはまだいません",
  "mobile.carplay.locked": "iPhoneでOpenBotのロックを解除してください",
  "mobile.carplay.signedOut": "iPhoneでOpenBotにサインインしてください",
  "mobile.carplay.voice.listening": "聞いています…",
  "mobile.carplay.voice.muted": "ミュート中",
  "mobile.carplay.voice.thinking": "{name}が考えています",
  "mobile.carplay.voice.offline": "サーバーはオフラインです",
  "mobile.carplay.voice.unavailable": "iPhoneで音声を設定してください",
} as const satisfies PartialTranslation<typeof source>;
