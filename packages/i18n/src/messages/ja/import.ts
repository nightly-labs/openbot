import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/import";

export const messages = {
  "import.count.agent": { other: "{count} 個のエージェント" },
  "import.count.channel": { other: "{count} 個のチャンネル" },
  "import.count.skill": { other: "{count} 個のスキル" },
  "import.count.routine": { other: "{count} 個のルーティン" },
  "import.count.memory": { other: "{count} 件のメモリー" },
  "import.count.file": { other: "{count} 個のファイル" },
  "import.guide.title": "Grok Bot からエージェントを移行",
  "import.guide.lede":
    "Grok Bot のエクスポート用エージェントが、名前、指示、アバター、スキル、ルーティン、メモリー、含めるファイルを 1 つの .zip ファイルにまとめます。",
  "import.guide.openFailed": "エクスポートを開けませんでした",
  "import.guide.step1": "エクスポート用エージェントを Grok Bot に追加します",
  "import.guide.setupLabel": "エクスポート用エージェントの追加方法",
  "import.guide.setupAgent": "エージェントをインストール",
  "import.guide.setupSkill": "自分で設定",
  "import.guide.agentMeta": "Grok Bot のエージェント · エクスポート用スキルあり",
  "import.guide.openAgent": "エクスポート用エージェントを開く",
  "import.guide.agentNote":
    "Grok Bot のページから用意済みのエージェントをインストールします。エクスポートには含まれません。",
  "import.guide.skillCopied": "スキルをコピーしました",
  "import.guide.saveFile": "ファイルを保存…",
  "import.guide.skillNote":
    "このスキルを、Grok Bot でエクスポート専用に作った新しいエージェントに追加します。エクスポートには含まれません。",
  "import.guide.step2": "このメッセージを送信します",
  "import.guide.copyMessage": "メッセージをコピー",
  "import.guide.messageCopied": "メッセージをコピーしました",
  "import.guide.messageNote":
    "ワークスペースのファイルを含めるか確認したあと、.zip ファイルを「ダウンロード」に保存します。",
  "import.guide.step3": ".zip ファイルを選択します",
  "import.guide.reading": "読み込み中…",
  "import.guide.choose": "エクスポートファイルを選択",
  "import.guide.chooseNote": "変更の前に、含まれるエージェントを確認できます。",
  "import.guide.hermesLedeServer":
    "Hermes の各プロファイルが 1 つのエージェントになります。サーバー上のプロファイルを読み込むか、Hermes のエクスポート用スキルで 1 つの .zip ファイルにまとめます。",
  "import.guide.hermesLedeExport":
    "Hermes の各プロファイルが 1 つのエージェントになります。Hermes のエクスポート用スキルが、それらを 1 つの .zip ファイルにまとめます。",
  "import.guide.setupServer": "サーバーから読み込む",
  "import.review.title": "{source} のエクスポート",
  "import.review.exported": "{date} にエクスポート",
  "import.review.fileSize": "ファイル {size}",
  "import.review.noFiles": "ワークスペースのファイルはありません",
  "import.review.importAgents": "{agents}をインポート",
  "import.review.importBoth": "{agents}と{channels}をインポート",
  "import.review.reading": "読み込み中…",
  "import.review.chooseAnother": "別のファイルを選択",
  "import.review.startFailed": "インポートを開始できませんでした",
  "import.review.warnings": "移行されない項目があります",
  "import.review.agents": "エージェント",
  "import.review.channels": "チャンネル",
  "import.review.selected": "{total} 件中 {selected} 件を選択",
  "import.review.importItem": "{name} をインポート",
  "import.review.importing": "インポート中…",
  "import.review.channelNeedsMember": "インポートするには、このチャンネルのエージェントを 1 つ以上選択してください。",
  "import.review.channelWithout": "{names} を除いてインポートします。",
  "import.review.nameExists":
    "{name} という名前のエージェントはすでにあります。インポートすると、もう 1 つ追加されます。",
  "import.review.duplicatesTitle": "重複するエージェントをインポートしますか？",
  "import.review.duplicatesDescription":
    "次のエージェントはこのサーバーにすでにあります: {names}。インポートすると、それぞれ 2 つ目のコピーが追加されます。各コピーは別のエージェントで、チャット、ファイル、メモリーはそれぞれ独立しています。",
  "import.review.duplicatesConfirm": "重複をインポート",
  "import.result.title": "インポートが完了しました",
  "import.result.importedAgents": "{agents}をインポートしました",
  "import.result.importedBoth": "{agents}と{channels}をインポートしました",
  "import.result.notImported": "{items}はインポートされませんでした。",
  "import.result.notImportedBoth": "{agents}と{channels}はインポートされませんでした。",
  "import.result.imported": "インポート済み",
  "import.result.open": "{name} を開く",
  "import.result.channel": "チャンネル",
  "import.result.notImportedTitle": "インポートされなかった項目",
  "import.result.warnings": "移行されなかった項目があります",
  "import.source.ledeServer":
    "OpenBot はこれらをサーバーにコピーします。何かが変わる前に、すべての項目を確認できます。",
  "import.source.hermesNoteServer":
    "サーバー上の Hermes フォルダーを読み込むか、Hermes から .zip ファイルをエクスポートします。",
  "import.source.hermesNoteExport": "Hermes から .zip ファイルをエクスポートします。",
  "import.hermes.notFoundServer": "このサーバーに Hermes のプロファイルがありません",
  "import.hermes.notFoundServerNote":
    "OpenBot はサーバーの Hermes フォルダーを読み込みます。このコンピューターの Hermes を取り込むには、Hermes から .zip ファイルを書き出してください。",
} as const satisfies PartialTranslation<typeof source>;
