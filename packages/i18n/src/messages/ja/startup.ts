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
} as const satisfies PartialTranslation<typeof source>;
