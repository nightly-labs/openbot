import type { Translation } from "../message";
import type { AppMessages } from "./en";

/**
 * Japanese. Written from the English source and not yet reviewed by a native speaker: read it as a
 * first draft that is safe to ship behind an explicit language choice, not as final copy.
 *
 * Notes for a reviewer. The interface uses です・ます throughout, because the English source speaks
 * to the user directly rather than reporting state. Product names stay in Latin script: OpenBot is
 * the application name, and ZIP and JSON are the file formats a picker shows.
 */
export const ja = {
  "menu.stopAllAgents": "すべてのエージェントを停止",
  "menu.checkForUpdates": "アップデートを確認…",

  "notification.needsInput": "入力が必要です。",
  "notification.needsApproval": "承認が必要です。",
  "notification.finished": "作業が完了しました。",

  "dialog.chooseSiteDirectory": "静的サイトのフォルダを選択",
  "dialog.chooseSkill": "スキルのフォルダまたは ZIP を選択",
  "dialog.filter.skillPackages": "スキルパッケージ",
  "dialog.filter.images": "画像",
  "dialog.filter.supportedFiles": "対応ファイル",
  "dialog.filter.attachment": "添付ファイル",
  "dialog.filter.zipArchive": "ZIP アーカイブ",
  "dialog.filter.jsonDocument": "JSON ドキュメント",

  "startup.failedTitle": "OpenBot を起動できませんでした",
  "startup.failedBody":
    "{message}\n\nお使いのデータは初期化も上書きもされていません。復旧の手順はトラブルシューティングガイドをご覧ください。",

  "update.unsupported": "アップデートはインストール済みのデスクトップ版でご利用いただけます。",
  "update.notReady": "インストールできるアップデートがありません。",
  "update.restartFailed": "アップデートをインストールするための再起動ができませんでした。",
  "update.downloadStalled": "アップデートのダウンロードが応答しなくなりました。もう一度お試しください。",
  "update.installFailed":
    "アップデートをインストールできませんでした。OpenBot を終了してから開き直し、もう一度お試しください。",
  "update.downloadFailed": "アップデートをダウンロードできませんでした。もう一度お試しください。",
  "update.checkFailed": "アップデートを確認できませんでした。もう一度お試しください。",

  "settings.language.title": "言語",
  "settings.language.description": "メニュー、ボタン、メッセージをこの言語で表示します。",
  "settings.language.system": "システムに合わせる",
} as const satisfies Translation<AppMessages>;
