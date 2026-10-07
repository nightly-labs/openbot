import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "ファイルを開く",
  "attachment.preview": "{name} をプレビュー",
  "attachment.notFound": "ファイルが見つかりません",
  "attachment.download": "{name} をダウンロード",
  "attachment.open": "{name} を開く",
  "attachment.previewUnavailable": "プレビューを利用できません。",
  "attachment.error.preview": "{name} をプレビューできませんでした。もう一度お試しください。",
  "attachment.error.download": "添付ファイルをダウンロードできませんでした。もう一度お試しください。",
  "attachment.error.open": "この添付ファイルを開くか保存できませんでした。もう一度お試しください。",
  "attachment.error.openFile": "このファイルを開けませんでした。もう一度お試しください。",
  "attachment.error.fileFallback": "ファイル",
  "attachment.error.fileNotFound": "「{name}」はこの場所に見つかりません。移動または削除された可能性があります。",
  "attachment.error.previewFile": "「{name}」をプレビューできませんでした。もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
