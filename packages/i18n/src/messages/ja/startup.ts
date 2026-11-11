import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot を起動できませんでした",
  "startup.failedBody":
    "{message}\n\nお使いのデータは初期化も上書きもされていません。復旧の手順はトラブルシューティングガイドをご覧ください。",
  "startup.archiveChangedTitle": "OpenBot のファイルが変更されました",
  "startup.archiveChangedBody":
    "別のプログラムが OpenBot のファイル app.asar を変更しました。OpenBot は今は動作していますが、終了すると次は起動しません。\n\n修復するには、OpenBot をもう一度インストールしてください。ローカルのデータはそのまま残ります。",
  "startup.archiveChangedDownload": "OpenBot をダウンロード",
  "startup.newerDataUpdatingTitle": "OpenBot を更新しています",
  "startup.newerDataUpdatingBody":
    "新しいバージョンの OpenBot がデータを保存しました。OpenBot は最新バージョンをインストールしてから、もう一度開きます。\n\nローカルデータはリセットも上書きもされていません。",
  "startup.newerDataTitle": "最新の OpenBot をインストールしてください",
  "startup.newerDataBody":
    "新しいバージョンの OpenBot がデータを保存したため、このバージョン ({version}) では開けません。データを開くには最新バージョンをインストールしてください。\n\nローカルデータはリセットも上書きもされていません。",
  "startup.newerDataDownload": "OpenBot をダウンロード",
  "startup.newerDataGuide": "ガイドを開く",
  "startup.newerDataQuit": "終了",
  "startup.recoveryWindowTitle": "OpenBot の復旧",
  "startup.recoveryTitle": "OpenBot を開けませんでした",
  "startup.recoveryBody": {
    other:
      "OpenBot {version} は開く前に {count} 回続けて停止しました。ローカルデータはリセットも上書きもされていません。",
  },
  "startup.recoveryHint":
    "もう一度試すか、最後に開けたバージョンをインストールしてください。サポートが必要な場合は、診断情報を書き出し、そのファイルをレポートと一緒に送ってください。",
  "startup.recoveryRetry": "再試行",
  "startup.recoveryPreviousVersion": "前のバージョンをダウンロード",
  "startup.recoveryExportDiagnostics": "診断情報を書き出す",
  "startup.recoveryOpenDataFolder": "データフォルダを開く",
  "startup.recoveryQuit": "終了",
  "startup.recoveryDiagnosticsSaved": "診断ファイルを保存しました。",
  "startup.recoveryActionFailed": "OpenBot はこの操作を実行できませんでした。",
} as const satisfies PartialTranslation<typeof source>;
