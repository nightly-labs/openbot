import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "ファイルのプレビュー",
  "preview.panel.resize": "ファイルのプレビューのサイズを変更",
  "preview.panel.copy": "ファイルのテキストをコピー",
  "preview.panel.openExternally": "ファイルを外部アプリで開く",
  "preview.panel.download": "ファイルをダウンロード",
  "preview.panel.reveal": "ファイルを Finder で表示",
  "preview.panel.close": "ファイルのプレビューを閉じる",
  "preview.panel.back": "戻る",
  "preview.panel.rawMarkdown": "Markdown のソースを表示",
  "preview.panel.rawHtml": "HTML のソースを表示",
  "preview.folder.empty": "このフォルダは空です。",
  "preview.folder.truncated": "最初の {limit} 件だけを表示しています。",
  "preview.truncated": "プレビューは {limit} 文字までです。",
  "preview.unavailable": "プレビューを表示できません。",
  "preview.unsupported.title": "プレビューを表示できません",
  "preview.unsupported.description": "この種類のファイルは既定のアプリで開けます。",
  "preview.unsupported.openExternally": "外部アプリで開く",
  "preview.spreadsheet.readFailed": "このスプレッドシートを読み込めませんでした。",
  "preview.spreadsheet.truncated": "プレビューは最初の {rows} 行と {columns} 列までです。",
} as const satisfies PartialTranslation<typeof source>;
