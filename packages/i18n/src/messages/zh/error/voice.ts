import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  // Voice transcription errors.
  "error.voice.downloadFailed": "无法下载语音模型，请重试。",
  "error.voice.downloadStopped": "语音模型下载已停止。",
  "error.voice.removeBusy": "请等语音转写结束后再移除该模型。",
  "error.voice.removeFailed": "无法移除语音模型，请重试。",
  "error.voice.runtimeUnavailable": "该平台不支持本地语音转写。",
  "error.voice.modelUnavailable": "语音模型不可用。",
  "error.voice.transcriptionTimedOut": "语音转写超时。",
  "error.voice.prepareRequired": "本地语音转写不可用。请运行 `bun run voice:prepare` 并重启 OpenBot。",
  "error.voice.transcriptionFailed": "OpenBot 无法转写这段录音。",
  "error.voice.cloud.keyRequired": "请在“设置 → 语音”中添加 {provider} API 密钥。",
  "error.voice.cloud.keyRejected": "{provider} 未接受该 API 密钥，请在“设置 → 语音”中检查。",
  "error.voice.cloud.quotaExceeded": "你的 {provider} 配额已用完。",
  "error.voice.cloud.rateLimited": "{provider} 正忙，请稍后重试。",
  "error.voice.cloud.termsRequired": "请先在你的 ElevenLabs 账号中接受条款，然后重试。",
  "error.voice.cloud.streamEnded": "听写流已结束，请重新录制。",
  "error.voice.cloud.tooLong": "录音过长。",
  "error.voice.cloud.keySaveFailed": "无法保存 {provider} API 密钥。",
  "error.voice.speech.runtimeUnavailable": "该平台不支持本地语音。",
  "error.voice.speech.modelRequired": "请在“设置 → 语音”中下载语音模型。",
  "error.voice.speech.timedOut": "朗读回复超时。",
  "error.voice.speech.failed": "OpenBot 无法朗读该回复。",
  "error.voice.recordingNotKept": "OpenBot 无法保留该录音。",
  "error.voice.live.timedOut": "Codex 实时语音未能及时启动。请重试。",
  "error.voice.live.failed": "实时语音已停止：{reason}",
  "error.voice.live.disconnected": "实时语音已断开。",
  "error.voice.live.hostFailed":
    "服务器上的 Codex 无法启动实时语音。请让所有者更新那台电脑上的 Codex 并使用 ChatGPT 登录，然后重试。",
  "error.voice.live.signIn": "请用 ChatGPT 账号登录 Codex 以使用实时语音。",
  "error.voice.live.unavailable": "OpenAI 无法启动实时语音。问题出在 OpenAI 一方。请稍后重试。",
  "error.voice.live.refused": "OpenAI 拒绝启动实时语音。请稍后重试，或在 设置 中关闭实时语音以用语音对话。",
  "error.voice.live.off": "Codex 实时语音已关闭。请在 设置 → 语音 中打开。",
} as const satisfies PartialTranslation<typeof source>;
