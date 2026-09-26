import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/agentSettings";

export const messages = {
  "agentSettings.label": "エージェントの設定",
  "agentSettings.title": "設定",
  "agentSettings.backToDetails": "詳細に戻る",
  "agentSettings.closeDetails": "詳細を閉じる",
  "agentSettings.saveFailed": "エージェントの設定を保存できませんでした。",

  "agentSettings.name": "名前",
  "agentSettings.nameLabel": "エージェント名",
  "agentSettings.agentTitle": "肩書き",
  "agentSettings.agentTitleLabel": "エージェントの肩書き",
  "agentSettings.agentTitlePlaceholder": "エージェントの役割を説明してください",
  "agentSettings.instructions": "指示",
  "agentSettings.instructionsLabel": "エージェントへの指示",
  "agentSettings.instructionsPlaceholder": "このエージェントの用途",

  "agentSettings.avatar.edit": "エージェントのアバターを編集",
  "agentSettings.avatar.editor": "アバターエディター",
  "agentSettings.avatar.attachFiles": "ファイルを添付",
  "agentSettings.avatar.image": "画像",
  "agentSettings.avatar.replaceImage": "画像を置き換える",
  "agentSettings.avatar.uploadImage": "画像をアップロード",
  "agentSettings.avatar.imageHint": "PNG、JPEG、WebP · 正方形に切り抜き",
  "agentSettings.avatar.generatedFace": "生成された顔",
  "agentSettings.avatar.resetToId": "ID に戻す",
  "agentSettings.avatar.newSet": "新しいセット",
  "agentSettings.avatar.faces": "生成されたアバターの顔",
  "agentSettings.avatar.selected": "選択中のアバター",
  "agentSettings.avatar.option": "アバター候補 {number}",
  "agentSettings.avatar.color": "色",
  "agentSettings.avatar.colorLabel": "アバターの色",
  "agentSettings.avatar.autoColor": "アバターの色を自動で設定",
  "agentSettings.avatar.autoInitial": "自",
  "agentSettings.avatar.hueColor": "アバターの色: {hue}",
  "agentSettings.avatar.saveFailed": "エージェントのアバターを保存できませんでした。",
  "agentSettings.avatar.processFailed": "エージェントのアバターを処理できませんでした。",

  "agentSettings.runtime.title": "実行環境",
  "agentSettings.runtime.model": "エージェントのモデル",
  "agentSettings.runtime.modelBusy": "モデルを変更する前に、現在の作業が終わるまで待ってください。",
  "agentSettings.runtime.modelUnavailable": "エージェント CLI が接続されると、モデルを選択できます。",
  "agentSettings.runtime.reasoning": "推論",
  "agentSettings.runtime.reasoningLabel": "エージェントの推論レベル",
  "agentSettings.runtime.selectReasoning": "推論を選択",
  "agentSettings.runtime.access": "アクセス",
  "agentSettings.runtime.accessLabel": "エージェントのアクセス",
  "agentSettings.runtime.workingDirectory": "作業ディレクトリ",
  "agentSettings.runtime.notAvailable": "まだ利用できません",
  "agentSettings.runtime.fullAccessNote":
    "エージェントは、ワークスペースと共有フォルダーからコンピューターへのフルアクセスで実行されます。",
  "agentSettings.runtime.claudeApprovalNote": "Claude は、あなたへの質問を除き、承認を求めずに操作します。",
  "agentSettings.runtime.providerApprovalNote":
    "プロバイダーによっては、重要なコマンドの実行前に承認を求めることがあります。",

  "agentSettings.access.workspace": "ワークスペースのみ",
  "agentSettings.access.full": "フルアクセス",

  "agentSettings.notifications.title": "通知",
  "agentSettings.notifications.description": "このエージェントが完了したときや入力が必要なときに通知を受け取ります",

  "agentSettings.fullAccess.title": "このエージェントにフルアクセスを許可しますか？",
  "agentSettings.fullAccess.description":
    "エージェントは、あなたのユーザーアカウントがアクセスできるすべてのファイルの読み取り、変更、削除、任意のコマンドの実行、ネットワークの使用ができるようになります。指示の誤解や悪意のある Web ページ 1 つで、個人のファイルに影響が及ぶ可能性があります。",
  "agentSettings.fullAccess.cancel": "ワークスペースのみのままにする",
  "agentSettings.fullAccess.confirm": "フルアクセスを許可",

  "agentSettings.links.usage": "使用状況",
  "agentSettings.links.memories": "メモリー",
  "agentSettings.links.memoriesCount": { other: "{count} 件保存済み" },
  "agentSettings.links.skills": "スキル",
  "agentSettings.links.skillsCount": { other: "{count} 個割り当て済み" },
  "agentSettings.links.tables": "テーブル",
  "agentSettings.links.tablesCount": { other: "{count} 個のテーブル" },
  "agentSettings.links.files": "ファイル",
  "agentSettings.links.routines": "ルーティン",
  "agentSettings.links.routinesCount": { other: "{count} 件設定済み" },
  "agentSettings.runtime.workspaceNote":
    "「ワークスペースのみ」は、書き込みをこのエージェントのワークスペース、共有フォルダー、一時フォルダーに制限します。読み取りとネットワークは引き続き使用できます。",
  "agentSettings.runtime.workspaceNotEnforced":
    "{provider} はまだこれを適用しないため、このエージェントは引き続きフルアクセスを持ちます。Codex と Claude エージェントには適用されます。",
  "agentSettings.runtime.workspaceEnforcedCommand":
    "外部に書き込む必要があるコマンドは、自動承認がオンでも先に確認します。",
  "agentSettings.runtime.workspaceEnforcedClaude":
    "外部のファイル編集は、自動承認がオンでも先に確認します。コマンドは外部に書き込めません。",
  "agentSettings.runtime.workspaceUnlimited":
    "Computer Use と OpenBot ブラウザーは制限されません。Computer Use は下でオフにできます。",
  "agentSettings.computerUse.title": "Computer Use",
  "agentSettings.computerUse.description": "このエージェントにこのコンピューターのアプリの操作を許可します",
} as const satisfies PartialTranslation<typeof source>;
