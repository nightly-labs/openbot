import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  // Voice transcription errors.
  "error.voice.downloadFailed": "無法下載語音模型，請重試。",
  "error.voice.downloadStopped": "語音模型下載已停止。",
  "error.voice.removeBusy": "請等語音轉錄結束後再移除該模型。",
  "error.voice.removeFailed": "無法移除語音模型，請重試。",
  "error.voice.runtimeUnavailable": "該平臺不支援本地語音轉錄。",
  "error.voice.busy": "已有語音轉錄正在進行。",
  "error.voice.modelUnavailable": "語音模型不可用。",
  "error.voice.transcriptionTimedOut": "語音轉錄超時。",
  "error.voice.prepareRequired": "本地語音轉錄不可用。請執行 `bun run voice:prepare` 並重啟 OpenBot。",
  "error.voice.transcriptionFailed": "OpenBot 無法轉錄這段錄音。",
  "error.voice.cloud.keyRequired": "請在「設定 → 語音」中新增 ElevenLabs API 金鑰。",
  "error.voice.cloud.keyRejected": "ElevenLabs 未接受該 API 金鑰，請在「設定 → 語音」中檢查。",
  "error.voice.cloud.quotaExceeded": "你的 ElevenLabs 配額已用完。",
  "error.voice.cloud.rateLimited": "ElevenLabs 正忙，請稍後重試。",
  "error.voice.cloud.termsRequired": "請先在你的 ElevenLabs 帳號中接受條款，然後重試。",
  "error.voice.cloud.streamEnded": "聽寫流已結束，請重新錄製。",
  "error.voice.cloud.tooLong": "錄音過長。",
  "error.voice.cloud.keySaveFailed": "無法儲存 ElevenLabs API 金鑰。",
  "error.voice.speech.runtimeUnavailable": "該平臺不支援本地語音。",
  "error.voice.speech.modelRequired": "請在「設定 → 語音」中下載語音模型。",
  "error.voice.speech.timedOut": "朗讀回覆超時。",
  "error.voice.speech.failed": "OpenBot 無法朗讀該回復。",
  "error.voice.recordingNotKept": "OpenBot 無法保留該錄音。",
} as const satisfies PartialTranslation<typeof source>;
