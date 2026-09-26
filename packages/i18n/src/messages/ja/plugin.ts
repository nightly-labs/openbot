import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "ウェブサイト",
  "plugin.link.privacyPolicy": "プライバシーポリシー",
  "plugin.link.terms": "利用規約",
  "plugin.copyLink": "リンクをコピー",
  "plugin.install": "プラグインをインストール",
  "plugin.uninstall": "プラグインをアンインストール",
  "plugin.askPrompt": "{name} に質問：{prompt}",
  "plugin.section.apps": "アプリ",
  "plugin.section.skills": "スキル",
  "plugin.section.information": "情報",
  "plugin.info.developer": "開発者",
  "plugin.info.category": "カテゴリ",
  "plugin.info.version": "バージョン",

  "plugin.uninstallDialog.title": "{name} をアンインストールしますか？",
  "plugin.uninstallDialog.description":
    "{name} がこのコンピュータにインストールしたものを削除します。このホストとこのエージェントのほかの部分は変わりません。",
  "plugin.uninstallDialog.confirm": "アンインストール",
  "plugin.uninstallDialog.appsLabel": "削除するアプリ：{number} 件",
  "plugin.uninstallDialog.appsTitle": "このホストから削除するアプリ",
  "plugin.uninstallDialog.appsNote":
    "それらのツールは使えなくなり、OpenBot が保存していたサインイン情報も削除されます。",
  "plugin.uninstallDialog.skillsLabel": "削除するスキル：{number} 件",
  "plugin.uninstallDialog.skillsTitle": "{agentName} から削除するスキル",
} as const satisfies PartialTranslation<typeof source>;
