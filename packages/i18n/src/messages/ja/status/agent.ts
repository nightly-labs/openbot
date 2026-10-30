import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "{path} に書き込みます。これはエージェントのワークスペース、共有フォルダー、一時フォルダーの外です。",
  "status.agent.contextCleared": "コンテキストを消去しました。ここから新しいチャットが始まります。",
  "status.agent.modelSwitchedForLimit": "使用量の上限に達しました。{model} に切り替えました。",
  "status.agent.modelReturnedAfterLimit": "使用量の上限が解除されました。{model} に戻しました。",
  "status.agent.modelSwitchedForError": "プロバイダーのエラーが発生しました。{model} に切り替えました。",
  "status.agent.modelReturnedAfterError": "プロバイダーのエラーの後、{model} に戻しました。",
  "status.agent.marketplaceSuggested": "マーケットプレイスのアプリを提案しました: {app}。",
  "status.agent.channelMemberAdded": "{agent} が {member} をチャンネルに追加しました。{person} の依頼です。",
  "status.agent.channelMemberRemoved": "{agent} が {member} をチャンネルから外しました。{person} の依頼です。",
  "status.agent.channelInstructionsChanged": "{agent} がチャンネルの指示を変更しました。{person} の依頼です。",
  "status.agent.channelRoutineCreated": "{agent} がルーティン {routine} を作成しました。{person} の依頼です。",
  "status.agent.channelRoutineUpdated": "{agent} がルーティン {routine} を変更しました。{person} の依頼です。",
  "status.agent.channelRoutineDeleted": "{agent} がルーティン {routine} を削除しました。{person} の依頼です。",
  "status.agent.screenCaptureScreen": "メイン画面をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureChannel":
    "画像はチャンネル {channel} に表示され、このサーバーでチャンネルを読むメンバー全員が見ることができます。",
  "status.agent.screenCaptureDisplay":
    "ディスプレイ {name} をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureWindow": "ウィンドウ {name} をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureRegion":
    "画面の {x}, {y}, {width} × {height} ポイントの領域をキャプチャし、その画像をエージェントのモデルに送信します。",
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
  "status.agent.memoryChanges": "メモリー: {saved} 件保存、{updated} 件更新、{forgotten} 件忘却。",
  "status.agent.memoryChangesWithConflicts":
    "メモリー: {saved} 件保存、{updated} 件更新、{forgotten} 件忘却、{notChanged} 件は別のスレッドが先に変更したため未変更。",
  "status.agent.planContinues": "プランに未完了のステップがあります。エージェントが続けます（{current}/{limit}）。",
} as const satisfies PartialTranslation<typeof source>;
