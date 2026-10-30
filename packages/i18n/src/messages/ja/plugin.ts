import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "ウェブサイト",
  "plugin.link.privacyPolicy": "プライバシーポリシー",
  "plugin.link.terms": "利用規約",
  "plugin.copyLink": "リンクをコピー",
  "plugin.askPrompt": "{name} に質問: {prompt}",
  "plugin.section.skills": "スキル",
  "plugin.section.information": "情報",
  "plugin.info.developer": "開発者",
  "plugin.info.category": "カテゴリー",
  "plugin.info.version": "バージョン",

  "plugin.uninstallDialog.title": "{name} の接続を解除しますか？",
  "plugin.uninstallDialog.description":
    "{name} がこのコンピューターにインストールしたものを削除します。このホストとこのエージェントのほかの部分は変わりません。",
  "plugin.uninstallDialog.confirm": "接続を解除",
  "plugin.uninstallDialog.appsLabel": "削除するアプリ: {number} 件",
  "plugin.uninstallDialog.appsTitle": "このホストから削除するアプリ",
  "plugin.uninstallDialog.appsNote":
    "それらのツールは使えなくなり、OpenBot が保存していたサインイン情報も削除されます。",
  "plugin.uninstallDialog.skillsLabel": "削除するスキル: {number} 件",
  "plugin.uninstallDialog.skillsTitle": "{agentName} から削除するスキル",
} as const satisfies PartialTranslation<typeof source>;
