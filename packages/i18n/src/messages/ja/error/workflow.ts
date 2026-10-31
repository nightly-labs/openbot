import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "このワークフローはもう存在しません。",
  "error.workflow.versionMissing": "このバージョンのワークフローはもう存在しません。",
  "error.workflow.annotation": "テキスト、メモ、図形には接続を付けられません。",
  "error.workflow.port": "このステップはこの種類の入力を受け取れません。",
  "error.workflow.branch": "「はい」と「いいえ」の接続を持てるのは条件だけです。",
  "error.workflow.conditionBranch": "条件からの接続は、それぞれ「はい」か「いいえ」である必要があります。",
  "error.workflow.duplicateEdge": "この 2 つのステップにはすでにこの接続があります。",
  "error.workflow.serverTooOld":
    "このサーバーはワークフローに対応していません。サーバーを実行しているコンピューターの OpenBot を更新してください。",
  "error.workflow.nodeUnsupported":
    "このバージョンの OpenBot では、画像、ファイル、メッセージのステップはまだ実行できません。",
  "error.workflow.interrupted": "このステップの実行中に OpenBot が停止しました。もう一度実行してください。",
  "error.workflow.agentMissing": "このステップのエージェントを選択してください。",
  "error.workflow.handoffFailed": "OpenBot はこのステップをエージェントに送信できませんでした。",
  "error.workflow.agentStepEnded": "エージェントが回答する前に、このステップのメッセージが削除されました。",
  "error.workflow.conditionUnclear": "モデルが「はい」か「いいえ」で回答しませんでした。",
  "error.workflow.modelFailed": "モデルが回答できませんでした。ステップをもう一度実行してください。",
  "error.workflow.modelBusy": "別のモデルリクエストが実行中です。しばらくしてからステップを再実行してください。",
  "error.workflow.stepMissing": "このステップはもう存在しません。",
  "error.workflow.nodeMissing": "この手順はワークフローにありません。",
  "error.workflow.runMissing": "この実行はもう存在しません。",
  "error.workflow.notRetryable": "再実行できるのは、失敗または停止したステップだけです。",
  "error.workflow.noDecision": "このステップは判断を待っていません。",
  "error.workflow.outputPlaceMissing": "この出力のメッセージングの投稿先を選んでください。",
  "error.workflow.outputConnectionOff":
    "この出力のメッセージング接続はオフか、削除されています。投稿先をもう一度選んでください。",
  "error.workflow.outputNotRunning":
    "メッセージング接続は現在動作していません。動作しているときにもう一度試してください。",
  "error.workflow.outputRefused": "投稿先が投稿を拒否しました。OpenBot がそこに投稿できることを確認してください。",
  "error.workflow.outputUncertain":
    "投稿が途中で止まりました。一部がすでに投稿先にある可能性があります。もう一度試す前に確認してください。",
  "error.workflow.tooLarge":
    "このワークフローは大きすぎるため保存できません。描画や長いテキストを一部削除してから、もう一度お試しください。",
  "error.workflow.tooLargeToSend":
    "このワークフローは大きすぎるため、別のコンピューターに送信できません。サーバーを実行しているコンピューターで開いてください。",
  "error.workflow.webhookMissing":
    "このステップは Webhook トリガーではありません。ワークフローを保存してから、もう一度お試しください。",
  "error.workflow.githubActionMissing": "この出力が GitHub で行う操作を選択してください。",
  "error.workflow.githubRepositoryMissing": "この出力のリポジトリを選択してください。",
  "error.workflow.githubItemMissing":
    "この出力には Issue もプルリクエストもありません。GitHub イベントから実行を開始するか、入力に番号を入れてください。",
  "error.workflow.githubPullRequestOnly": "この操作はプルリクエストでのみ使えます。",
  "error.workflow.githubTextMissing":
    "この出力には送信するテキストがありません。テキストを書くステップを接続してください。",
  "error.workflow.githubChoiceMissing": "この出力のラベルまたはユーザーを選択してください。",
  "error.workflow.githubChoseNothing": "モデルはこのリポジトリのラベルもユーザーも選択しませんでした。",
  "error.workflow.githubNotConnected": "このワークフローを実行するコンピューターで GitHub に接続してください。",
  "error.workflow.githubNoAccess":
    "OpenBot GitHub App はこのリポジトリまたは項目を参照できません。GitHub を開いてアクセスを許可してください。",
  "error.workflow.githubNoWrite":
    "OpenBot GitHub App はこのリポジトリを変更できません。GitHub を開いてアクセスを許可してください。",
  "error.workflow.githubLocked": "この会話は GitHub でロックされています。",
  "error.workflow.githubRefused": "GitHub が変更を拒否しました: {detail}",
  "error.workflow.githubUnreachable": "OpenBot は GitHub に接続できませんでした。ステップをもう一度実行してください。",
  "error.workflow.githubUncertain":
    "変更が途中で止まりました。GitHub にすでに反映されている可能性があります。ステップを再実行する前に GitHub を確認してください。",
  "error.workflow.githubNoEvent": "このトリガーが開始する Issue またはプルリクエストが GitHub にありません。",
} as const satisfies PartialTranslation<typeof source>;
