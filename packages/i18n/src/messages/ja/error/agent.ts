import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "このリクエストでは履歴を利用できません。最近の履歴をもう一度読み取るか、チャンネルの作業には channel_history を使用してください。",
  "error.agent.toolRequestInvalid":
    "ツール検出の引数が無効です。宣言されたスキーマと、元の修飾されたツール名を使用してください。",
  "error.agent.approvalWhileDeleting": "エージェントの削除中は承認できません。",
  "error.agent.accessLocalOnly":
    "エージェントへのアクセスは、そのエージェントを実行しているコンピューターでのみ変更できます。",
  "error.agent.duplicateCleanupFailed": "エージェントの複製に失敗し、不完全なコピーを削除できませんでした。",
  "error.agent.commitEffectsFailed": "トランザクションはコミットされましたが、保存された効果の適用に失敗しました。",
  "error.agent.settingsLocalOnly":
    "エージェントの設定は、そのエージェントを実行しているコンピューターでのみ変更できます。",
  "error.agent.skillsLocalOnly": "スキルは、エージェントを実行しているコンピューターでのみ変更できます。",
  "error.agent.addLocalOnly": "エージェントは、それを実行するコンピューターでのみ追加できます。",
  "error.agent.joinedServerUpdate": "参加中のサーバーのエージェントはここから更新できません。",
  "error.agent.searchQueryRequired": "検索語句が必要です。",
  "error.agent.messageTooLong": "メッセージが長すぎます。",
  "error.agent.messageOrAttachmentRequired": "メッセージまたは添付ファイルが必要です。",
  "error.agent.promptAnswersTooLong": "回答が長すぎます。",
  "error.agent.gone": "このエージェントはもう存在しません。",
  "error.agent.profileGenerationBusy": "プロフィールの生成中です。しばらくしてからもう一度お試しください。",
  "error.agent.initialMessageRequired": "最初のメッセージが必要です。",
  "error.agent.initialMessageTooLong": "最初のメッセージが長すぎます。",
  "error.agent.setupCleanupFailed": "エージェントのセットアップに失敗し、不完全なエージェントを削除できませんでした。",
  "error.agent.modelUnavailable": "選択したエージェントのモデルを使用できません。",
  "error.agent.modelProviderNotConnected":
    "選択したエージェントのモデル「{model}」を使用できません: {provider} が接続されていません。",
  "error.agent.modelListEmpty":
    "選択したエージェントのモデル「{model}」を使用できません: {provider} はモデルを 1 つも返しませんでした。最後のエラー: {detail}",
  "error.agent.modelListEmptyNoError":
    "選択したエージェントのモデル「{model}」を使用できません: {provider} はモデルを 1 つも返しませんでした。",
  "error.agent.modelNotInProviderList":
    "選択したエージェントのモデル「{model}」を使用できません: {provider} のモデル一覧にありません。",
  "error.agent.modelProviderMismatch": "選択したモデルはそのプロバイダーのものではありません。",
  "error.agent.modelNotListed": "モデル「{model}」は使用できません。使用できるモデル: {models}。",
  "error.agent.providerNotListed":
    "現在 {provider} のモデルを使用できません。list_models を呼び出して、使用できるモデルを確認してください。",
  "error.agent.reasoningEffortUnsupported":
    "モデル「{model}」は推論レベル「{effort}」に対応していません。対応している推論レベル: {efforts}。",
  "error.agent.noStartingModelInSettings":
    "{provider} に利用可能なモデルがなく、ログイン済みの他のプロバイダーにもありません。プロバイダーにログインするか、サーバー設定 → プロバイダーでデフォルトのプロバイダーを変更してください。",
  "error.agent.noStartingModel":
    "{provider} に使用できるモデルがなく、サインイン済みのほかのプロバイダーにもありません。プロバイダーにサインインするか、「プロバイダーと権限」でデフォルトのプロバイダーを変更してください。",
  "error.agent.waitBeforeProviderChange":
    "プロバイダーを変更する前に、実行中のターンとキューが終わるまでお待ちください。",
  "error.agent.waitBeforeClearContext":
    "新しいチャットを始める前に、実行中のターンとキューが終わるまでお待ちください。",
  "error.agent.unknown": "不明なエージェントです: {id}",
  "error.agent.onlyUserWidensSettings":
    "エージェントにフルアクセスを与える、または Computer Use をオンにできるのはユーザーだけです。エージェントの設定で変更するようユーザーに依頼してください。",
  "error.agent.queuedMessageCreateFailed": "キューに入れるメッセージを作成できません。",
  "error.agent.messageUnavailable": "このメッセージはもう使用できません。",
  "error.agent.hostLimit": "1 つのホストに置けるエージェントは {limit} 個までです。",
  "error.agent.changedWhileDuplicating": "複製中にエージェントが変更されました。もう一度お試しください。",
  "error.agent.duplicatedAgentGone": "複製したエージェントはもう存在しません。",
  "error.agent.stateCorrupt":
    "エージェントの状態が破損しているか、新しいバージョンの OpenBot のものです。上書きしません。",
  "error.agent.oldRoleField":
    "保存されたエージェントのプロフィールは古い role フィールドを使用しています。OpenBot を起動する前にデータを更新してください。",
  "error.agent.duplicateIds": "エージェントの状態に重複したエージェント ID があります。上書きしません。",
  "error.agent.copyNameFailed": "OpenBot はエージェントのコピーに固有の名前を作成できませんでした。",
  "error.agent.endpointRemoved":
    "このエージェントが使用していたエンドポイントは削除されました。別のモデルを選択してください。",
  "error.agent.selectedGone": "選択したエージェントはもう存在しません。",
  "error.agent.profileEndpointsChanged": "生成中にカスタムエンドポイントが変更されました。もう一度お試しください。",
  "error.agent.profileInvalid": "プロバイダーが無効なプロフィールを返しました。指示を修正してみてください。",
  "error.agent.profileSectionUnavailable":
    "生成されたセクションを使用できません。もう一度試すか、セクションを手動で選択してください。",
  "error.agent.profileTimedOut": "プロフィールの生成がタイムアウトしました。もう一度お試しください。",
  "error.agent.profileDisconnected": "プロフィールの生成中にプロバイダーの接続が切れました。",
  "error.agent.profileToolUse": "プロバイダーがツールを使用しようとしました。指示を修正してみてください。",
  "error.agent.profileFailed": "プロバイダーはプロフィールを生成できませんでした。もう一度お試しください。",
  "error.agent.profileTooLarge": "生成されたプロフィールが大きすぎます。短い指示でお試しください。",
  "error.agent.profileNotStarted": "プロバイダーはプロフィールの生成を開始できませんでした。",
  "error.agent.deletionBusy": "エージェントの削除はすでに実行中です。",
  "error.agent.stopBeforeDelete": "削除する前に、エージェントを停止し、キュー内のメッセージをキャンセルしてください。",
  "error.agent.deleteIncomplete":
    "エージェントのデータを完全には削除できませんでした。エージェントの削除を再試行してください。",
  "error.agent.duplicationBusy": "このエージェントはすでに複製中です。",
  "error.agent.waitBeforeDuplicate": "複製する前に、エージェントが終わるまで待ち、キューを空にしてください。",
  "error.agent.saveOtherAgent": "この保存は別のエージェントのものです。",
  "error.agent.savedGone": "保存したエージェントはもう存在しません。",
  "error.agent.storedProfileUnreadable":
    "保存されたエージェントのプロフィールに読み取れない「{field}」の値があります。OpenBot を起動する前にデータを更新してください。",
  "error.agent.storedProfileUnreadableId":
    "保存されたエージェントのプロフィール {id} に読み取れない「{field}」の値があります。OpenBot を起動する前にデータを更新してください。",
  "error.agent.queueEditRejected": "キューの編集が拒否されました: {reason}",
  "error.agent.computerUseLocalOnly": "Computer Use は、エージェントを実行しているコンピューターでのみ変更できます。",
  "error.agent.automationLocalOnly": "ローカルスクリプトは、エージェントを実行しているコンピュータでのみ許可できます。",
  "error.agent.busyMessageModeLocalOnly":
    "エージェントの作業中のメッセージの扱いは、エージェントを実行しているコンピュータでのみ設定できます。",
  "error.agent.localScriptsOff": "このエージェントはローカルスクリプトを許可していません。",
  "error.agent.localScriptsRateLimited":
    "過去 1 時間に、ローカルスクリプトがこのエージェントに {limit} 件のメッセージまたはルーティンのリクエストを送信しました。後でもう一度お試しください。",
  "error.agent.automationOff": "このエージェントは、ローカルスクリプトによるルーティンの実行を許可していません。",
  "error.agent.automationPayloadTooLong": "ペイロードが {limit} 文字を超えています。",
  "error.agent.automationRateLimited":
    "過去 1 時間に、ローカルスクリプトがこのエージェントのルーティンを {limit} 回実行しました。後でもう一度お試しください。",
  "error.agent.workspaceOnlyMacOnly":
    "このプロバイダーの「ワークスペースのみ」は macOS でのみ利用できます。エージェントの設定で「フルアクセス」を選んでください。",
  "error.agent.lowMemory":
    "このサーバーはメモリが不足しています。メッセージはキューで待機し、メモリが空くと開始します。より大きいプランにすると、サーバーのメモリが増えます。",
  "error.agent.workspaceOnlyToolMissing":
    "「ワークスペースのみ」には {tool} が必要ですが、OpenBot は見つけられませんでした。インストールするか、エージェントの設定で「フルアクセス」を選んでください。",
} as const satisfies PartialTranslation<typeof source>;
