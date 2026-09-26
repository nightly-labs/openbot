import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/skill";

export const messages = {
  "skill.title": "スキル",
  "skill.close": "スキルを閉じる",
  "skill.detailsDescription": "{name} の詳細",
  "skill.assignedDescription": "{name} に割り当てられたスキル",
  "skill.addFromMarketplace": "マーケットプレイスから追加",
  "skill.limitReached":
    "このエージェントはスキルの上限（{limit} 個）に達しました。別のスキルを追加する前に、スキルを 1 つ削除してください。",
  "skill.managedOnHost": "このエージェントのスキルはホストで管理されています。",
  "skill.loading": "スキルを読み込んでいます…",
  "skill.loadingDetails": "詳細を読み込んでいます…",
  "skill.emptyEnabled": "このエージェントには有効なスキルがありません。",
  "skill.emptyAssigned": "このエージェントにはまだスキルが割り当てられていません。",
  "skill.folderSkill":
    "このスキルは OpenBot がインストールしたものではありません。{location} で編集または削除してください。",
  "skill.localOnHost": "このローカルスキルはホストに保存されています。詳細はそのコンピューターで開いてください。",
  "skill.moreFor": "{name} のその他の操作",
  "skill.update": "更新",
  "skill.updateName": "{name} を更新",
  "skill.enableName": "{name} を有効にする",
  "skill.repair": "修復",
  "skill.uninstall": "アンインストール",
  "skill.version": "v{version}",
  "skill.versionUpdate": "v{installed} · v{available} が利用可能",

  "skill.loadFailed": "スキルを読み込めませんでした。",
  "skill.loadDetailsFailed": "スキルの詳細を読み込めませんでした。",
  "skill.enableFailed": "スキルを有効にできませんでした。",
  "skill.disableFailed": "スキルを無効にできませんでした。",
  "skill.removeFailed": "スキルを削除できませんでした。",
  "skill.updateFailed": "スキルを更新できませんでした。",

  "skill.confirm.replaceTitle": "ローカルの変更を置き換えますか？",
  "skill.confirm.removeTitle": "このスキルを削除しますか？",
  "skill.confirm.replaceBody":
    "このスキルを更新すると、ローカルのファイルが最新のスキルパッケージに置き換えられます。このスキルフォルダーでの編集は失われます。",
  "skill.confirm.removeModifiedBody":
    "このスキルにはエージェントのワークスペースにローカルの変更があります。削除するとそれらのファイルも削除されます。元のチャットメッセージは残ります。",
  "skill.confirm.removeBody": "OpenBot はこのスキルをエージェントから削除します。チャット履歴は残ります。",
  "skill.confirm.replace": "スキルを置き換える",
  "skill.confirm.remove": "スキルを削除",

  "skill.unavailable.readOnly": "リモートのスキルは読み取り専用です。",
  "skill.unavailable.add": "試すには、このスキルを追加してください。",
  "skill.unavailable.repair": "試すには、このスキルを修復してください。",
  "skill.unavailable.updateVersion": "このバージョンを試すには、スキルを更新してください。",
  "skill.unavailable.updateRevision": "このリビジョンを試すには、スキルを更新してください。",
  "skill.unavailable.saving": "このスキルの保存が終わるまで待ってから試してください。",
  "skill.unavailable.composer": "エージェントの入力欄を使用できません。",

  "skill.toolbar.source": "スキルの提供元",
  "skill.toolbar.all": "すべて",
  "skill.toolbar.local": "ローカル",
  "skill.toolbar.enabled": "有効",
  "skill.toolbar.create": "スキルを作成",

  "skill.local.loadFailed": "ローカルスキルを読み込めませんでした。",
  "skill.local.toggleFailed": "スキルの状態を変更できませんでした。",
  "skill.local.addFailed": "ローカルスキルを追加できませんでした。",
  "skill.local.back": "ローカルスキルに戻る",
  "skill.local.added": "追加済み",
  "skill.local.add": "スキルを追加",
  "skill.local.loading": "ローカルスキルを読み込んでいます…",
  "skill.local.empty": "まだローカルスキルはありません。",

  "skill.preview.label": "{name} のプレビュー",
  "skill.preview.creator": "作成者: {name}",
  "skill.preview.examplePrompt": "このスキルの使い方を手伝ってください。",
  "skill.preview.try": "スキルを試す",
  "skill.preview.linkFailed": "リンクを開けませんでした。",
} as const satisfies PartialTranslation<typeof source>;
