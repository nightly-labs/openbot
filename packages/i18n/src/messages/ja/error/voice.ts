import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.assetsUnavailable":
    "ローカル音声文字起こしのアセットを使用できません。`bun run voice:prepare` を実行し、OpenBot を再起動してください。",
  "error.voice.downloadFailed": "音声モデルをダウンロードできませんでした。もう一度お試しください。",
  "error.voice.downloadStopped": "音声モデルのダウンロードを停止しました。",
  "error.voice.runtimeUnavailable": "このプラットフォームではローカル音声文字起こしを使用できません。",
  "error.voice.busy": "音声文字起こしはすでに実行中です。",
  "error.voice.modelUnavailable": "音声モデルを使用できません。",
  "error.voice.transcriptionTimedOut": "音声文字起こしがタイムアウトしました。",
  "error.voice.prepareRequired":
    "ローカル音声文字起こしを使用できません。`bun run voice:prepare` を実行し、OpenBot を再起動してください。",
  "error.voice.transcriptionFailed": "OpenBot はこの録音を文字起こしできませんでした。",
} as const satisfies PartialTranslation<typeof source>;
