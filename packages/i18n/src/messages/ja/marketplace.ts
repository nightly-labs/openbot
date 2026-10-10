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

  "marketplace.open": "{name} を開く",
  "marketplace.tab.apps": "アプリ",
  "marketplace.crumbs.label": "現在の場所",
  "marketplace.search.label": "マーケットプレイスを検索",
  "marketplace.search.placeholder": "検索",
  "marketplace.installs": { other: "{installs} 回インストール" },
  "marketplace.filter": "フィルター",
  "marketplace.filter.on": "フィルター：{filters}",
  "marketplace.filter.all": "すべて",
  "marketplace.filter.status": "状態",
  "marketplace.filter.category": "カテゴリー",
  "marketplace.filter.added": "追加済み",
  "marketplace.filter.notAdded": "未追加",
  "marketplace.filter.installed": "インストール済み",
  "marketplace.filter.notInstalled": "未インストール",
  "marketplace.filter.clear": "フィルターをクリア",
  "marketplace.noMatch.apps": "この検索に一致するアプリはありません。",
  "marketplace.noMatch.filters": "フィルターに一致する項目はありません。",
  "marketplace.noMatch.showAgents": { other: "エージェント {count} 件を表示" },
  "marketplace.noMatch.showApps": { other: "アプリ {count} 件を表示" },
  "marketplace.noMatch.showSkills": { other: "スキル {count} 件を表示" },
  "marketplace.empty.agents": "マーケットプレイスにはまだエージェントがありません。",
  "marketplace.empty.apps": "マーケットプレイスにはまだアプリがありません。",
  "marketplace.empty.skills": "マーケットプレイスにはまだスキルがありません。",
  "marketplace.properties.agent": "このエージェントについて",
  "marketplace.properties.skill": "このスキルについて",
  "marketplace.properties.creator": "作成者",
  "marketplace.properties.category": "カテゴリー",
  "marketplace.properties.version": "バージョン",
  "marketplace.properties.updated": "更新日",
  "marketplace.properties.installs": "インストール数",

  "marketplace.agent.add": "追加",
  "marketplace.agent.addNamed": "{name} を追加",
  "marketplace.agent.addAgent": "エージェントを追加",
  "marketplace.agent.added": "追加済み",
  "marketplace.agent.updateAvailable": "アップデートがあります",
  "marketplace.agent.update": "アップデート",
  "marketplace.agent.openChat": "チャットを開く",

  "marketplace.app.connect": "接続",
  "marketplace.app.reconnect": "再接続",
  "marketplace.app.connectNamed": "{name} を接続",
  "marketplace.app.reconnectNamed": "{name} を再接続",
  "marketplace.app.connected": "接続済み",
  "marketplace.app.attention": "対応が必要",
  "marketplace.app.notConnected": "未接続",
  "marketplace.app.custom": "MCP サーバー",
  "marketplace.app.githubTagline": "リポジトリ、Issue、プルリクエスト",
  "marketplace.app.onePasswordTagline": "共有したログイン情報でサイトにサインイン",
  "marketplace.app.onePasswordCategory": "ログインと認証情報の管理",
  "marketplace.app.yourApps": "あなたのアプリ",
  "marketplace.app.moreApps": "その他のアプリ",
  "marketplace.app.server": "サーバー",
  "marketplace.app.command": "コマンド",
  "marketplace.app.address": "アドレス",
  "marketplace.app.disconnect.title": "切断",
  "marketplace.app.disconnect.description":
    "{name} とそのスキルをこのコンピュータから削除します。あとでもう一度接続できます。",
  "marketplace.app.disconnect.action": "切断",
  "marketplace.app.remove.title": "サーバーを削除",
  "marketplace.app.remove.description": "エージェントはこのサーバーを使えなくなります。設定は削除されます。",
  "marketplace.app.remove.action": "削除",
  "marketplace.app.remove.confirmTitle": "{name} を削除しますか？",
  "marketplace.app.remove.keep": "残す",

  "marketplace.plugin.aave.tagline": "Aave のデータとトランザクション",
  "marketplace.plugin.aave.description":
    "Aave を使うと、Aave V3 と V4 のライブマーケットを調べ、ウォレットのポジションと DAO ガバナンスを確認し、レンディング操作をシミュレーションし、ノンカストディアルのトランザクションを準備できます。トランザクションはすべて未署名で返されます。プラグインはマーケットを読み取って呼び出しを作成し、ウォレットはユーザーの手元に残ります。",
  "marketplace.plugin.aave.app":
    "V3 と V4 のライブマーケット、ウォレットのポジション、DAO ガバナンス、準備済みのトランザクションを、1 つの MCP サーバーで提供します。",
  "marketplace.plugin.aave.prompt.stablecoinYield": "今、Aave 全体でステーブルコインの利回りが最も高いのはどこですか？",
  "marketplace.plugin.aave.prompt.usdcRates": "今、Ethereum 上の USDC の利率が高いのは Aave V3 と V4 のどちらですか？",
  "marketplace.plugin.aave.prompt.healthFactor":
    "0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c のヘルスファクターはいくつですか？清算まであとどのくらいですか？",
  "marketplace.plugin.canva.tagline": "デザイン、素材、エクスポート",
  "marketplace.plugin.canva.description":
    "Canva を使うと、言葉でデザインを作成・編集し、自分のデザインライブラリを検索し、素材をアップロードして整理し、チャネルに合った形式でエクスポートし、作業中の場所にコメントを残せます。各ユーザーは自分の Canva アカウントにサインインし、エージェントはそのアカウントでできる操作を実行できます。",
  "marketplace.plugin.canva.app":
    "デザインの作成と編集、ライブラリの検索、素材とブランドの管理、エクスポート、コメントを、1 つの MCP サーバーで提供します。",
  "marketplace.plugin.canva.prompt.recentDesign": "最近編集した Canva のデザインを見せてください。",
  "marketplace.plugin.canva.prompt.socialResize":
    "ローンチ用のポスターを Instagram 用にリサイズして、両方を PNG でエクスポートしてください。",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "このリリースノートを 6 枚の Canva プレゼンテーションにしてください。",
  "marketplace.plugin.linear.tagline": "Issue とプロジェクトのトリアージ",
  "marketplace.plugin.linear.description":
    "Linear を使うと、エージェントはサインイン中のアカウントが属するワークスペースで、担当の Issue を一覧表示し、バックログをトリアージし、ステータスを更新し、新しい Issue の下書きを作成できます。各ユーザーはブラウザで自分の Linear アカウントにサインインします。",
  "marketplace.plugin.linear.app":
    "Issue の検索、トリアージ、ステータスの更新、Issue の作成を、ブラウザでサインインする Linear の MCP サーバーで提供します。",
  "marketplace.plugin.linear.prompt.myWeek": "今週、自分に割り当てられているものは何ですか？",
  "marketplace.plugin.linear.prompt.backlog":
    "バックログをトリアージしてください。古いもの、ブロックされているもの、担当者がいないものはどれですか？",
  "marketplace.plugin.linear.prompt.newIssue":
    "同期キューのクラッシュについて、再現手順を付けて Issue を作成してください。",
  "marketplace.plugin.notion.tagline": "ドキュメントとナレッジベース",
  "marketplace.plugin.notion.description":
    "Notion を使うと、エージェントはページを読み書きし、ワークスペースを検索し、チームがすでに使っている場所に議事録や仕様書を残せます。各ユーザーはブラウザで自分の Notion アカウントにサインインします。",
  "marketplace.plugin.notion.app":
    "ページの検索、読み取り、書き込み、ワークスペースの移動を、ブラウザでサインインする Notion の MCP サーバーで提供します。",
  "marketplace.plugin.notion.prompt.findSpec": "現在のローンチ仕様書を探して、未解決の質問をまとめてください。",
  "marketplace.plugin.notion.prompt.meetingNotes": "この箇条書きを、チームスペースの構造化された議事録にしてください。",
  "marketplace.plugin.notion.prompt.updateDoc":
    "オンボーディングのドキュメントを新しいリリースチェックリストで更新してください。",
  "marketplace.plugin.figma.tagline": "デザインとプロトタイプ",
  "marketplace.plugin.figma.description":
    "Figma を使うと、エージェントはデザインファイルを読み取り、コンポーネント、スタイル、変数を調べ、本番用の仕様をエンジニアに渡せます。このコンピュータの Figma デスクトップアプリにある MCP サーバーに接続します。サーバーはデザインの読み取りのみ可能で、書き込みには現在対応中です。",
  "marketplace.plugin.figma.app":
    "デザインのコンテキスト、メタデータ、変数、スクリーンショットを、Figma デスクトップアプリの MCP サーバーで提供します。現在は読み取り専用です。",
  "marketplace.plugin.figma.prompt.handoff":
    "チェックアウトのファイルを引き渡してください。画面、コンポーネント、スタイルを一覧にしてください。",
  "marketplace.plugin.figma.prompt.audit": "このファイルで余白と色の使い方に不統一がないか監査してください。",
  "marketplace.plugin.figma.prompt.assets": "アプリバンドル用に、マーケティングアイコンを 2x で書き出してください。",
  "marketplace.plugin.paper.tagline": "HTML と CSS で作られたデザインキャンバス",
  "marketplace.plugin.paper.description":
    "Paper を使うと、エージェントは Paper Desktop で開いているデザインファイルを読み書きできます。アートボード、選択範囲、計算済みのスタイル、JSX、トークンを調べ、フレーム、テキスト、スタイルを作成・変更できます。Paper Desktop をインストールして一度開き、始める前にファイルを開いてください。OpenBot は Paper Desktop がインストールする Paper CLI を起動します。Paper にキーは不要です。書き込みツールは開いているファイルを変更するので、承認する前に各書き込みを確認してください。",
  "marketplace.plugin.paper.app":
    "開いている Paper Desktop のファイルを、Paper CLI が中継するローカルの MCP サーバーで読み書きします。ファイルを開いた Paper Desktop が必要です。",
  "marketplace.plugin.paper.prompt.implement":
    "選択した Paper のフレームを、このコードベースのコード規約に沿って実装してください。",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "このリポジトリのスタイルを使って、Paper で設定ページをデザインしてください。",
  "marketplace.plugin.paper.prompt.tokens":
    "開いている Paper のファイルにあるデザイントークンを一覧にして、私たちのテーマと比較してください。",
  "marketplace.plugin.sentry.tagline": "エラーとクラッシュのトリアージ",
  "marketplace.plugin.sentry.description":
    "Sentry を使うと、エージェントは最近のエラーを検索し、スタックトレースと影響を受けたリリースを調べ、デプロイ後に何が壊れたかをまとめられます。各ユーザーはブラウザで自分の Sentry アカウントにサインインします。",
  "marketplace.plugin.sentry.app":
    "エラーの検索、Issue の調査、リリースの健全性を、ブラウザでサインインする Sentry の MCP サーバーで提供します。",
  "marketplace.plugin.sentry.prompt.newErrors": "昨日のデプロイ以降に新しく発生したエラーは何ですか？",
  "marketplace.plugin.sentry.prompt.topCrash":
    "モバイルプロジェクトで最も多いクラッシュと、その原因として考えられるものを説明してください。",
  "marketplace.plugin.sentry.prompt.releaseHealth": "現在のリリースは前回と比べてどのくらい健全ですか？",
  "marketplace.plugin.context7.tagline": "最新のライブラリドキュメント",
  "marketplace.plugin.context7.description":
    "Context7 はライブラリとフレームワークの最新のドキュメントと API リファレンスを取得するので、回答はプロジェクトが実際に使っているバージョンに基づきます。アカウントもキーも不要です。",
  "marketplace.plugin.context7.app":
    "最新のライブラリドキュメントの検索を、サインイン不要の Context7 MCP サーバーで提供します。",
  "marketplace.plugin.context7.prompt.apiCheck": "このフレームワークで仮想化リストを扱う現在の API は何ですか？",
  "marketplace.plugin.context7.prompt.migrate": "このルーターの v2 と v3 の間で何が変わりましたか？",
  "marketplace.plugin.context7.prompt.example": "認証付きファイルアップロードの最新の例を見せてください。",
  "marketplace.plugin.stripe.tagline": "決済と請求の確認",
  "marketplace.plugin.stripe.description":
    "Stripe を使うと、エージェントはサインイン中のユーザーがアクセスできるアカウントで、決済、顧客、請求書を調べ、支払いリンクの下書きを作成できます。各ユーザーはブラウザで自分の Stripe アカウントにサインインします。",
  "marketplace.plugin.stripe.app":
    "決済、顧客、請求書の検索を、ブラウザでサインインする Stripe の MCP サーバーで提供します。",
  "marketplace.plugin.stripe.prompt.payment": "この決済を調べて、失敗した理由を説明してください。",
  "marketplace.plugin.stripe.prompt.customer": "この顧客の請求書と未払い残高をまとめてください。",
  "marketplace.plugin.stripe.prompt.link": "Pro プランの月額 49 の支払いリンクの下書きを作成してください。",
  "marketplace.plugin.posthog.tagline": "プロダクト分析とフラグ",
  "marketplace.plugin.posthog.description":
    "PostHog を使うと、エージェントはイベントとファネルを照会し、フィーチャーフラグを調べ、リリース後に何が変わったかをまとめられます。プロジェクト設定の個人用 API キーを 1 つの Authorization ヘッダーに入れます。",
  "marketplace.plugin.posthog.app":
    "イベント、ファネル、フィーチャーフラグへのアクセスを、個人用 API キーを使う PostHog の MCP サーバーで提供します。",
  "marketplace.plugin.posthog.prompt.funnel": "過去 14 日間のサインアップファネルはどうなっていますか？",
  "marketplace.plugin.posthog.prompt.flag": "このユーザーに有効になっているフィーチャーフラグはどれですか？",
  "marketplace.plugin.posthog.prompt.release": "先週のリリース後にアクティベーションは変わりましたか？",
  "marketplace.plugin.airtable.tagline": "ベースとレコード",
  "marketplace.plugin.airtable.description":
    "Airtable を使うと、エージェントはベースを一覧表示し、レコードを読み取って更新し、テーブルの内容をまとめられます。アカウントページの API キーは、1 つの環境変数としてローカルサーバーに渡されます。",
  "marketplace.plugin.airtable.app":
    "ベースの一覧とレコードへのアクセスを、Airtable API キーを使うローカルの MCP サーバーで提供します。",
  "marketplace.plugin.airtable.prompt.bases": "私がアクセスできるベースはどれですか？",
  "marketplace.plugin.airtable.prompt.records": "ローンチトラッカーのテーブルをまとめてください。",
  "marketplace.plugin.airtable.prompt.update": "ロードマップのベースで、リリース済みの機能を完了にしてください。",
  "marketplace.plugin.firecrawl.tagline": "Web の抽出と検索",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl を使うと、エージェントは 1 つの API でページをスクレイピングし、構造化データを抽出し、Web を検索できます。Firecrawl ダッシュボードの API キーは、1 つの環境変数としてローカルサーバーに渡されます。",
  "marketplace.plugin.firecrawl.app":
    "ページのスクレイピング、抽出、Web 検索を、Firecrawl API キーを使うローカルの MCP サーバーで提供します。",
  "marketplace.plugin.firecrawl.prompt.scrape": "このページの料金表を構造化データとして抽出してください。",
  "marketplace.plugin.firecrawl.prompt.research": "競合の料金を調べて、各情報源のページを引用してください。",
  "marketplace.plugin.firecrawl.prompt.monitor": "今月、私たちの変更履歴ページで何が変わりましたか？",
  "marketplace.plugin.braveSearch.tagline": "プライベートな Web 検索",
  "marketplace.plugin.braveSearch.description":
    "Brave Search を使うと、エージェントはトラッキングなしで Web とローカルの結果を検索できます。Brave Search API ダッシュボードの API キーは、1 つの環境変数としてローカルサーバーに渡されます。",
  "marketplace.plugin.braveSearch.app":
    "Web とローカルの検索を、Brave API キーを使うローカルの MCP サーバーで提供します。",
  "marketplace.plugin.braveSearch.prompt.search":
    "このフレームワークのバージョンについて、レビュアーは何と言っていますか？",
  "marketplace.plugin.braveSearch.prompt.news": "この製品分野の今日の発表を探してください。",
  "marketplace.plugin.braveSearch.prompt.compare": "この 2 つのベンダーを、情報源を引用して比較してください。",
  "marketplace.plugin.resend.tagline": "トランザクションメール",
  "marketplace.plugin.resend.description":
    "Resend を使うと、エージェントは 1 つの API でトランザクションメールを送信し、配信を確認できます。Resend ダッシュボードの API キーは、1 つの環境変数としてローカルサーバーに渡されます。",
  "marketplace.plugin.resend.app":
    "メールの送信と配信の確認を、Resend API キーを使うローカルの MCP サーバーで提供します。",
  "marketplace.plugin.resend.prompt.send": "ローンチのお知らせの下書きをベータリストに送信してください。",
  "marketplace.plugin.resend.prompt.status": "請求書のメールは顧客に届きましたか？",
  "marketplace.plugin.resend.prompt.template": "新しいフロー用のパスワードリセットメールの下書きを作成してください。",
  "marketplace.plugin.composio.tagline": "自分の Composio リンクで多数のアプリを利用",
  "marketplace.plugin.composio.description":
    "Composio は、1 つの MCP サーバーでエージェントを Gmail、Slack、GitHub など数百のアプリに接続します。Composio アカウントでサーバーを作成し、使いたいアプリを追加して、そのリンクをここに貼り付けてください。API キーは、サーバーが必要とする場合にのみ追加してください。",
  "marketplace.plugin.composio.app":
    "Composio MCP サーバーに追加したアプリを、Composio アカウントのリンクで提供します。",
  "marketplace.plugin.composio.prompt.inbox": "未読メールをまとめて、急ぎのものに返信の下書きを作成してください。",
  "marketplace.plugin.composio.prompt.handoff": "このプルリクエストの概要をチームのチャンネルに投稿してください。",
  "marketplace.plugin.composio.prompt.apps": "Composio で使えるアプリと操作はどれですか？",

  "marketplace.skill.installMenu.install": "インストール",
  "marketplace.skill.installMenu.installNamed": "{name} をインストール",
  "marketplace.skill.installMenu.allAgents": "すべてのエージェント",
  "marketplace.skill.installMenu.agents": { other: "エージェント {count} 件" },
  "marketplace.skill.installMenu.here": "現在地",
  "marketplace.skill.installMenu.change": { other: "{label} には {name} があります。変更" },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "{name} で試す",

  "marketplace.notice.agentAdded": "{name} を追加しました。",
  "marketplace.notice.agentUpdated": "{name} をアップデートしました。",
  "marketplace.notice.appConnected": "{name} を接続しました。",
  "marketplace.notice.appDisconnected": "{name} を切断しました。",
  "marketplace.notice.serverRemoved": "{name} を削除しました。",
  "marketplace.notice.skillInstalled": { other: "{name} をエージェント {count} 件にインストールしました。" },
  "marketplace.notice.skillRemoved": { other: "{name} をエージェント {count} 件から削除しました。" },
  "marketplace.error.skillPartial": "次のエージェントでは {name} が変更されませんでした：{agents}。{reason}",

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
