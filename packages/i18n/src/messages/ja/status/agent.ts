import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "{path} に書き込みます。これはエージェントのワークスペース、共有フォルダー、一時フォルダーの外です。",
  "status.agent.contextCleared": "コンテキストを消去しました。ここから新しいチャットが始まります。",
  "status.agent.instructionsChanged": "指示を更新しました",
  "status.agent.modelSwitchedForLimit": "使用量の上限に達しました。{model} に切り替えました。",
  "status.agent.modelReturnedAfterLimit": "使用量の上限が解除されました。{model} に戻しました。",
  "status.agent.routineSkippedRunOpen": "スキップ: 前回の実行がまだ終わっていませんでした",
  "status.agent.routineSkippedUsageLimit": "スキップ: 使用量の上限に達しました",
  "status.agent.modelSwitchedForError": "プロバイダーのエラーが発生しました。{model} に切り替えました。",
  "status.agent.modelSwitchedForSpentBalance":
    "{previous} のクレジットがなくなりました。{model} に切り替えました。再び使うには、クレジットを追加してから選択してください。",
  "status.agent.modelReturnedAfterError": "プロバイダーのエラーの後、{model} に戻しました。",
  "status.agent.marketplaceSuggested": "マーケットプレイスのアプリを提案しました: {app}。",
  "status.agent.channelMemberAdded": "{agent} が {member} をチャンネルに追加しました。{person} の依頼です。",
  "status.agent.channelMemberRemoved": "{agent} が {member} をチャンネルから外しました。{person} の依頼です。",
  "status.agent.channelInstructionsChanged": "{agent} がチャンネルの指示を変更しました。{person} の依頼です。",
  "status.agent.channelRoutineCreated": "{agent} がルーティン {routine} を作成しました。{person} の依頼です。",
  "status.agent.channelRoutineUpdated": "{agent} がルーティン {routine} を変更しました。{person} の依頼です。",
  "status.agent.channelRoutineDeleted": "{agent} がルーティン {routine} を削除しました。{person} の依頼です。",
  "status.agent.channelTaskCancelled":
    "{agent} がタスク「{task}」とそのサブタスクをキャンセルしました。{person} の依頼です。",
  "status.agent.screenCaptureScreen": "メイン画面をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureChannel":
    "画像はチャンネル {channel} に表示され、このサーバーでチャンネルを読むメンバー全員が見ることができます。",
  "status.agent.screenCaptureDisplay":
    "ディスプレイ {name} をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureWindow": "ウィンドウ {name} をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureRegion":
    "画面の {x}, {y}, {width} × {height} ポイントの領域をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.reportProblem":
    "アプリのバージョンとシステム情報付きで、公開の GitHub issue になります。あなたの名前は表示されません。",
  "status.agent.sendIdea": "公開の GitHub issue になります。あなたの名前は表示されません。",
  "status.agent.feedbackRecentErrors": "チャットの最近のエラー:",
  "status.agent.feedbackSameAs": "issue #{issue} に追加します",
  "status.agent.feedbackSent": "OpenBot チームに送信しました: {title}",
  "status.agent.serverInstallCommand":
    "別のコンピューターに OpenBot をサーバー {name} としてインストールし、あなたのアカウントにサインインさせる 1 回限りのコマンドを作成します。エージェントがそこで実行します。",
  "status.agent.serverInstallCard": "サーバー {name} のインストールコマンド",
  "status.agent.browserProfileNamed":
    "{agents} をブラウザープロファイル {profile} に移動します。そのログイン情報と Cookie を使えるようになります。開いているタブは閉じます。",
  "status.agent.browserProfileNew":
    "新しいブラウザープロファイル {profile} を作成し、{agents} を移動します。ログイン情報はありません。開いているタブは閉じます。",
  "status.agent.browserProfileShared":
    "{agents} を共有のブラウザープロファイルに移動します。そのログイン情報と Cookie を使えるようになります。開いているタブは閉じます。",
  "status.agent.browserProfileOwn":
    "{agents} にそれぞれ専用のブラウザープロファイルを与えます。開いているタブは閉じます。",
  "status.agent.feedbackSending": "フィードバックを OpenBot チームに送信しています…",
  "status.agent.workflowDelete":
    "ワークフロー {title} を実行履歴とバージョンごと削除します。実行中のステップは停止します。",
  "status.agent.screenCaptureProgress": "画面のキャプチャを要求しています…",
  "status.agent.screenCaptureReviewing": "画面のキャプチャを確認しています…",
  "status.agent.browserOpening": "Web ページを開いています…",
  "status.agent.browserReading": "Web ページを読み取っています…",
  "status.agent.browserClicking": "Web ページをクリックしています…",
  "status.agent.browserTyping": "Web ページに入力しています…",
  "status.agent.browserActing": "Web ページを操作しています…",
  "status.agent.browserReviewing": "Web ページを確認しています…",
  "status.agent.memoriesSearching": "メモリーを検索しています…",
  "status.agent.memoriesSearched": { other: "メモリーを検索しました: {count} 件見つかりました" },
  "status.agent.memoriesUpdating": "メモリーを更新しています…",
  "status.agent.skillUsing": "スキル {name} を使用しています…",
  "status.agent.skillReading": "スキルを読み込んでいます…",
  "status.agent.toolStepFailed": "ツールのステップが失敗しました。結果を確認し、次に試すことを判断しています…",
  "status.agent.toolResultReviewing": "最新のツール結果を確認しています…",
  "status.agent.sourcesSearching": "最新の情報を検索しています…",
  "status.agent.sourcesReviewing": "見つけた情報源と情報を確認しています…",
  "status.agent.informationGathering": "関連する情報を集めています…",
  "status.agent.informationReviewing": "集めた情報を確認しています…",
  "status.agent.workChecking": "作業を確認しています…",
  "status.agent.workReviewing": "検証結果を確認しています…",
  "status.agent.changesMaking": "要求された変更を行っています…",
  "status.agent.changesReviewing": "行った変更を確認しています…",
  "status.agent.agentCoordinating": "別のエージェントと調整しています…",
  "status.agent.agentResponseReviewing": "別のエージェントの応答を確認しています…",
  "status.agent.commandRunningUnnamed": "コマンドを実行しています…",
  "status.agent.toolStepWorking": "次のツールステップを処理しています…",
  "status.agent.webSearching": "Web で「{query}」を検索しています…",
  "status.agent.urlFetching": "{host} を開いています…",
  "status.agent.fileReading": "{name} を読んでいます…",
  "status.agent.filesReading": "ファイルを読んでいます…",
  "status.agent.filesListing": "{path} を確認しています…",
  "status.agent.filesLooking": "ファイルを確認しています…",
  "status.agent.textSearching": "「{query}」を検索しています…",
  "status.agent.filesSearchingText": "ファイル内を検索しています…",
  "status.agent.folderSizesMeasuring": "フォルダーのサイズを測っています…",
  "status.agent.diskSpaceChecking": "ディスクの空き容量を確認しています…",
  "status.agent.processesChecking": "実行中のプロセスを確認しています…",
  "status.agent.gitChecking": "Git リポジトリを確認しています…",
  "status.agent.commandRunning": "{program} を実行しています…",
  "status.agent.memoryChanges": "メモリー: {saved} 件保存、{updated} 件更新、{forgotten} 件忘却。",
  "status.agent.memoryChangesWithConflicts":
    "メモリー: {saved} 件保存、{updated} 件更新、{forgotten} 件忘却、{notChanged} 件は別のスレッドが先に変更したため未変更。",
  "status.agent.nextStepContinues": "エージェントが次のステップの前で止まりました。続けます（{current}/{limit}）。",
  "status.agent.planContinues": "プランに未完了のステップがあります。エージェントが続けます（{current}/{limit}）。",
  "status.agent.compactionContinues":
    "エージェントがコンテキストを圧縮している間に接続が切れました。エージェントは続行します。",
  "status.agent.branchTitle": "分岐したチャット",
} as const satisfies PartialTranslation<typeof source>;
