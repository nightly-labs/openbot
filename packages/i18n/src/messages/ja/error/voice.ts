import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "音声モデルをダウンロードできませんでした。もう一度お試しください。",
  "error.voice.downloadStopped": "音声モデルのダウンロードを停止しました。",
  "error.voice.removeBusy": "音声文字起こしが終わってから、モデルを削除してください。",
  "error.voice.removeFailed": "音声モデルを削除できませんでした。もう一度お試しください。",
  "error.voice.runtimeUnavailable": "このプラットフォームではローカル音声文字起こしを使用できません。",
  "error.voice.busy": "音声文字起こしはすでに実行中です。",
  "error.voice.modelUnavailable": "音声モデルを使用できません。",
  "error.voice.transcriptionTimedOut": "音声文字起こしがタイムアウトしました。",
  "error.voice.prepareRequired":
    "ローカル音声文字起こしを使用できません。`bun run voice:prepare` を実行し、OpenBot を再起動してください。",
  "error.voice.transcriptionFailed": "OpenBot はこの録音を文字起こしできませんでした。",
  "error.voice.cloud.keyRequired": "設定 → 音声 で ElevenLabs の API キーを追加してください。",
  "error.voice.cloud.keyRejected":
    "ElevenLabs が API キーを受け付けませんでした。設定 → 音声 でキーを確認してください。",
  "error.voice.cloud.quotaExceeded": "ElevenLabs の利用枠を使い切りました。",
  "error.voice.cloud.rateLimited": "ElevenLabs が混み合っています。しばらくしてからもう一度お試しください。",
  "error.voice.cloud.termsRequired": "ElevenLabs のアカウントで利用規約に同意してから、もう一度お試しください。",
  "error.voice.cloud.streamEnded": "音声入力の送信が終了しました。もう一度録音してください。",
  "error.voice.cloud.tooLong": "録音が長すぎます。",
  "error.voice.cloud.keySaveFailed": "ElevenLabs の API キーを保存できませんでした。",
  "error.voice.speech.runtimeUnavailable": "このプラットフォームではローカル音声合成を利用できません。",
  "error.voice.speech.modelRequired": "設定 → 音声 で音声合成モデルをダウンロードしてください。",
  "error.voice.speech.timedOut": "返信の読み上げがタイムアウトしました。",
  "error.voice.speech.failed": "OpenBot は返信を読み上げられませんでした。",
  "error.voice.recordingNotKept": "OpenBot は音声録音を保存できませんでした。",
} as const satisfies PartialTranslation<typeof source>;
