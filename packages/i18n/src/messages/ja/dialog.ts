import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "静的サイトのフォルダを選択",
  "dialog.chooseSkill": "スキルのフォルダまたは ZIP を選択",
  "dialog.filter.skillPackages": "スキルパッケージ",
  "dialog.filter.images": "画像",
  "dialog.filter.supportedFiles": "対応ファイル",
  "dialog.filter.attachment": "添付ファイル",
  "dialog.filter.zipArchive": "ZIP アーカイブ",
  "dialog.filter.jsonDocument": "JSON ドキュメント",
} as const satisfies PartialTranslation<typeof source>;
