import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot は接続できませんでした。もう一度お試しください。",
  "mobile.link.invite.signInTitle": "サインインしてこのサーバーに参加",
  "mobile.link.invite.signInDescription":
    "コンピューターの OpenBot に表示される QR コードをスキャンしてください。その後、招待を確認できます。",
  "mobile.link.invite.cancel": "招待をキャンセル",
  "mobile.link.pairing.title": "このスマートフォンを接続",
  "mobile.link.pairing.alreadySignedIn":
    "すでにサインインしています。別のアカウントを接続する前に、設定でサインアウトしてください。",
  "mobile.link.pairing.description": "この Mobile Connect リンクをデスクトップから要求した場合にのみ続行してください。",
  "mobile.link.pairing.connect": "接続",
  "mobile.link.plugin.title": "プラグインのページを開く",
  "mobile.link.plugin.description": "このプラグインを OpenBot の Web サイトで表示します。",
  "mobile.link.plugin.openFailed": "プラグインのページを開けませんでした。",
  "mobile.link.plugin.view": "プラグインを表示",
  "mobile.link.unavailable.title": "リンクを使用できません",
  "mobile.link.unavailable.description": "このリンクは無効か、利用できなくなったか、モバイルでサポートされていません。",
  "mobile.link.template.signInTitle": "サインインしてこのエージェントを追加",
  "mobile.link.template.signInDescription":
    "コンピューターの OpenBot に表示される QR コードをスキャンしてください。その後、追加する前にエージェントを確認できます。",
  "mobile.link.template.loading": "エージェントを読み込み中…",
  "mobile.link.template.creator": "作成者: {name}",
  "mobile.link.template.section.instructions": "指示",
  "mobile.link.template.section.skills": "スキル",
  "mobile.link.template.section.noSkills": "スキルはありません。",
  "mobile.link.template.section.routines": "ルーティン",
  "mobile.link.template.section.noRoutines": "ルーティンはありません。",
  "mobile.link.template.skill.local": "ローカルスキル (SKILL.md のみ)",
  "mobile.link.template.skill.marketplace": "Marketplace のスキル、バージョン {version}",
  "mobile.link.template.server.title": "追加先のサーバー",
  "mobile.link.template.server.footer": "オーナーまたは管理者であるサーバーのみが表示されます。",
  "mobile.link.template.server.updateRequired":
    "共有エージェントを追加するには、このサーバーの OpenBot を更新してください。",
  "mobile.link.template.server.none":
    "共有エージェントを追加するには、サーバーのオーナーまたは管理者である必要があります。",
  "mobile.link.template.install.action": "エージェントを追加",
  "mobile.link.template.install.pending": "追加中…",
  "mobile.link.template.install.failed": "エージェントを追加できませんでした。",
  "mobile.link.template.notFound.title": "エージェントが見つかりません",
  "mobile.link.template.notFound.description": "この共有エージェントは存在しないか、作成者が公開を取り消しました。",
  "mobile.link.template.error.title": "エージェントを読み込めませんでした",
  "mobile.link.template.error.loadFailed": "共有エージェントを読み込めませんでした。もう一度お試しください。",
  "mobile.link.template.error.unsupported":
    "このサーバーは共有エージェントを追加できません。サーバーを実行しているコンピューターの OpenBot を更新してください。",
} as const satisfies PartialTranslation<typeof source>;
