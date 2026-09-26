import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.downloadAll.pending": "ZIP をダウンロードしています…",
  "attachment.downloadAll.label": "すべて ZIP でダウンロード",
  "attachment.downloadAll.count": { other: "添付ファイル {count} 件" },
  "attachment.downloadAll.zipping": "圧縮中",
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
  "attachment.error.fileNotFound":
    "「{name}」が見つかりません。エージェントにファイルの作成または復元を依頼してから、もう一度リンクをクリックしてください。",
  "attachment.error.previewFile": "「{name}」をプレビューできませんでした。もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
