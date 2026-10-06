import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "コーディング",
  "marketplace.category.design": "デザイン",
  "marketplace.category.dataAnalytics": "データと分析",
  "marketplace.category.documents": "ドキュメント",
  "marketplace.category.productivity": "生産性",
  "marketplace.category.research": "リサーチ",
  "marketplace.category.automation": "自動化",
  "marketplace.category.other": "その他",
  "marketplace.loadFailed": "マーケットプレイスを読み込めませんでした。",
  "marketplace.loading.skills": "スキルを読み込んでいます",
  "marketplace.loading.agents": "エージェントを読み込んでいます",
  "marketplace.noMatch.skills": "この検索に一致するスキルはありません。",
  "marketplace.noMatch.agents": "この検索に一致するエージェントはありません。",
  "marketplace.loadMore": "さらに読み込む",
  "marketplace.version": "バージョン {version}",

  "marketplace.title": "マーケットプレイス",
  "marketplace.close": "マーケットプレイスを閉じる",
  "marketplace.kinds": "マーケットプレイスのコンテンツの種類",
  "marketplace.tab.agents": "エージェント",
  "marketplace.tab.skills": "スキル",

  "marketplace.plugins.missing": "このプラグインは OpenBot のカタログにありません。",

  "marketplace.agents.loadingDetail": "エージェントの詳細を読み込んでいます…",
  "marketplace.agents.skills": "スキル",
  "marketplace.agents.routines": "ルーティン",
  "marketplace.agents.routineActive": "有効",
  "marketplace.agents.routineInactive": "無効",

  "marketplace.skill.loading": "スキルを読み込んでいます",
  "marketplace.skill.update": "スキルをアップデート",
  "marketplace.try.readFailed": "OpenBot はこのエージェントのスキルを読み取れませんでした。もう一度お試しください。",
  "marketplace.try.enable": "試すには、エージェントの設定でこのスキルを有効にしてください。",
  "marketplace.try.repair": "試すには、エージェントの設定でこのスキルを修復してください。",
  "marketplace.try.update": "このバージョンを試すには、スキルをアップデートしてください。",
  "marketplace.try.composerUnavailable": "エージェントの入力欄は利用できません。",

  "marketplace.error.openLink": "リンクを開けませんでした。",
  "marketplace.error.copyLink": "リンクをコピーできませんでした。",
  "marketplace.error.connectNoServer": "このアプリを接続するローカルサーバーを選択してください。",
  "marketplace.error.installNoServer": "プラグインをインストールするローカルサーバーを選択してください。",
  "marketplace.error.installNoAgent": "このプラグインのスキルをインストールするエージェントを選んでください。",
  "marketplace.error.installLocalOnHost":
    "{name} は、これらのエージェントを実行するコンピュータにインストールしてください。そのアプリはそのコンピュータ上でサーバーを実行します。",
  "marketplace.error.installOnHost":
    "{name} は、これらのエージェントを実行するコンピュータにインストールしてください。そのアプリはブラウザでのサインインが必要です。",
  "marketplace.error.appInvalid": "{name} を追加できません：{reason}",
  "marketplace.error.uninstallNoServer": "プラグインをアンインストールするローカルサーバーを選択してください。",
  "marketplace.error.uninstallPartial": "{name} の一部を削除できませんでした。{failures}",
  "marketplace.error.actionFailed": "マーケットプレイスの操作を完了できませんでした。もう一度お試しください。",
  "marketplace.thisAgent": "このエージェント",
} as const satisfies PartialTranslation<typeof source>;
