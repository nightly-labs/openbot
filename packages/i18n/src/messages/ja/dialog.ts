import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "静的サイトのフォルダーを選択",
  "dialog.chooseAgentFolder": "{agent} のフォルダーを選択",
  "dialog.chooseAgentExclusion": "{agent} に変更させないフォルダを選択",
  "dialog.chooseSkill": "スキルのフォルダーまたは ZIP を選択",
  "dialog.filter.skillPackages": "スキルパッケージ",
  "dialog.filter.images": "画像",
  "dialog.filter.supportedFiles": "対応ファイル",
  "dialog.filter.attachment": "添付ファイル",
  "dialog.filter.zipArchive": "ZIP アーカイブ",
  "dialog.filter.jsonDocument": "JSON ドキュメント",
  "dialog.chooseAgentExport": "エージェントのエクスポートを選択",
  "dialog.filter.agentExports": "エージェントのエクスポート",
  "dialog.saveExportSkill": "エクスポート用スキルを保存",
  "dialog.saveTransfer": "移行ファイルを保存",
  "dialog.chooseTransfer": "移行ファイルを選択",
  "dialog.filter.transfer": "OpenBot 移行ファイル",
  "dialog.chooseExternalLinkApp": "ブラウザーを選択",
  "dialog.filter.applications": "アプリケーション",
} as const satisfies PartialTranslation<typeof source>;
