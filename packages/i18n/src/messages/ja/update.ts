import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/update";

export const messages = {
  "update.action.check": "アップデートを確認",
  "update.action.checking": "アップデートを確認しています…",
  "update.action.download": "アップデートをダウンロード",
  "update.action.downloading": "アップデートをダウンロードしています…",
  "update.action.restart": "再起動してアップデート",
  "update.action.restarting": "再起動しています…",
  "update.action.retryDownload": "ダウンロードを再試行",
  "update.managedByHost": "ホストが管理しています",
  "update.upToDate": "最新です",

  "update.provider.update": "アップデート",
  "update.provider.upToDate": "{name} は最新です",
  "update.provider.checking": "{name} のアップデートを確認しています",
  "update.provider.available": "{name} のアップデートがあります",
  "update.provider.updating": "{name} をアップデートしています",
  "update.provider.failed": "{name} のアップデートに失敗しました",
  "update.provider.settingUp": "準備中",
  "update.provider.interrupted": "アップデートが中断されました。もう一度お試しください。",
  "update.provider.unknownVersion": "不明なバージョン",
  "update.provider.remoteHost": "プロバイダー CLI のアップデートは、それをホストするコンピュータで実行されます。",
  "update.provider.unavailable": "プロバイダーのアップデートは利用できません。",
  "update.provider.downloadsUnavailable": "プロバイダーのダウンロードは利用できません。",
  "update.provider.startFailed": "アップデートを開始できませんでした。もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
