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
  "marketplace.kinds": "マーケットプレイスのコンテンツの種類",
  "marketplace.tab.agents": "エージェント",
  "marketplace.tab.skills": "スキル",
  "marketplace.description.apps": "エージェントが使うツールやサービスに接続します。",
  "marketplace.description.agents": "独自の指示とスキルを持つ、すぐに使えるエージェント。",
  "marketplace.description.skills": "エージェントにタスクやツールの使い方を教える指示。",

  "marketplace.plugins.missing": "このプラグインは OpenBot のカタログにありません。",

  "marketplace.agents.loadingDetail": "エージェントの詳細を読み込んでいます…",
  "marketplace.agents.skills": "スキル",
  "marketplace.agents.routines": "ルーティン",
  "marketplace.agents.routineActive": "有効",
  "marketplace.agents.routineInactive": "無効",

  "marketplace.skill.loading": "スキルを読み込んでいます",
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
  "marketplace.filter.on": "フィルター: {filters}",
  "marketplace.filter.all": "すべて",
  "marketplace.filter.status": "状態",
  "marketplace.filter.category": "カテゴリー",
  "marketplace.filter.added": "追加済み",
  "marketplace.filter.notAdded": "未追加",
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
  "marketplace.app.partialTitle": "{name} は完了していません",
  "marketplace.app.partialDescription":
    "一部のアプリまたはスキルがインストールされていません。再接続するとインストールされます。",
  "marketplace.app.notConnected": "未接続",
  "marketplace.app.custom": "MCP サーバー",
  "marketplace.app.githubTagline": "リポジトリ、Issue、プルリクエスト",
  "marketplace.app.onePasswordTagline": "共有したログイン情報でサイトにサインイン",
  "marketplace.app.slackTagline": "Slack のメンションとダイレクトメッセージ",
  "marketplace.app.discordTagline": "Discord のメンションとダイレクトメッセージ",
  "marketplace.app.telegramTagline": "Telegram のグループとダイレクトチャット",
  "marketplace.app.bitwardenTagline": "共有フォルダーのログイン情報でサイトにサインイン",
  "marketplace.app.onePasswordCategory": "ログインと認証情報の管理",
  "marketplace.app.yourApps": "あなたのアプリ",
  "marketplace.app.addCustom": "カスタムを追加",
  "marketplace.app.server": "サーバー",
  "marketplace.app.command": "コマンド",
  "marketplace.app.address": "アドレス",
  "marketplace.app.disconnect.title": "{name} を切断",
  "marketplace.app.disconnect.description":
    "{name} とそのスキルをこのコンピューターから削除します。あとでもう一度接続できます。",
  "marketplace.app.disconnect.action": "切断",
  "marketplace.app.remove.title": "サーバーを削除",
  "marketplace.app.remove.description": "エージェントはこのサーバーを使えなくなります。設定は削除されます。",
  "marketplace.app.remove.action": "削除",
  "marketplace.app.remove.confirmTitle": "{name} を削除しますか？",
  "marketplace.app.remove.keep": "残す",
  "marketplace.app.connection": "接続",
  "marketplace.app.setup.account": "ブラウザーで {name} アカウントにサインインします。",
  "marketplace.app.setup.key": "{name} アカウントの API キーが必要です。",
  "marketplace.app.setup.keySaved": "{field} は {host} に保存されています。",
  "marketplace.app.setup.desktop": "{name} デスクトップアプリの {address} で動作します。",
  "marketplace.app.setup.desktopConnected": "{address} に接続済みです。",
  "marketplace.app.setup.open": "サインインもキーも不要です。",
  "marketplace.app.connectAgain": "もう一度接続",
  "marketplace.app.automation.askOnInstall": "インストール時に macOS にアクセスを求める",
  "marketplace.app.automation.title": "Apple アプリへのアクセス",
  "marketplace.app.automation.description":
    "macOS はアプリごとに確認を表示します。閉じているアプリは一時的に開き、その後終了します。",
  "marketplace.app.automation.request": "アクセスを求める",
  "marketplace.app.automation.allowed": "OpenBot はすべての Apple アプリを操作できるようになりました。",
  "marketplace.app.automation.refused":
    "macOS は {apps} へのアクセスを許可しませんでした。システム設定 › プライバシーとセキュリティ › オートメーション で OpenBot を許可してください。",
  "marketplace.app.automation.failed":
    "OpenBot は {apps} について macOS に確認できませんでした。もう一度お試しください。",
  "marketplace.app.automation.app.calendar": "カレンダー",
  "marketplace.app.automation.app.contacts": "連絡先",
  "marketplace.app.automation.app.mail": "メール",
  "marketplace.app.automation.app.notes": "メモ",
  "marketplace.app.automation.app.reminders": "リマインダー",
  "marketplace.app.automation.app.messages": "メッセージ",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "{name} にもう一度サインインしてください",
  "marketplace.app.signInDescription":
    "{name} が保存済みのサインインを拒否しました。もう一度サインインするまで、エージェントはこのアプリを使用できません。",

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
    "Linear を使うと、エージェントはサインイン中のアカウントが属するワークスペースで、担当の Issue を一覧表示し、バックログをトリアージし、ステータスを更新し、新しい Issue の下書きを作成できます。各ユーザーはブラウザーで自分の Linear アカウントにサインインします。",
  "marketplace.plugin.linear.app":
    "Issue の検索、トリアージ、ステータスの更新、Issue の作成を、ブラウザーでサインインする Linear の MCP サーバーで提供します。",
  "marketplace.plugin.linear.prompt.myWeek": "今週、自分に割り当てられているものは何ですか？",
  "marketplace.plugin.linear.prompt.backlog":
    "バックログをトリアージしてください。古いもの、ブロックされているもの、担当者がいないものはどれですか？",
  "marketplace.plugin.linear.prompt.newIssue":
    "同期キューのクラッシュについて、再現手順を付けて Issue を作成してください。",
  "marketplace.plugin.notion.tagline": "ドキュメントとナレッジベース",
  "marketplace.plugin.notion.description":
    "Notion を使うと、エージェントはページを読み書きし、ワークスペースを検索し、チームがすでに使っている場所に議事録や仕様書を残せます。各ユーザーはブラウザーで自分の Notion アカウントにサインインします。",
  "marketplace.plugin.notion.app":
    "ページの検索、読み取り、書き込み、ワークスペースの移動を、ブラウザーでサインインする Notion の MCP サーバーで提供します。",
  "marketplace.plugin.notion.prompt.findSpec": "現在のローンチ仕様書を探して、未解決の質問をまとめてください。",
  "marketplace.plugin.notion.prompt.meetingNotes": "この箇条書きを、チームスペースの構造化された議事録にしてください。",
  "marketplace.plugin.notion.prompt.updateDoc":
    "オンボーディングのドキュメントを新しいリリースチェックリストで更新してください。",
  "marketplace.plugin.cobrain.tagline": "AI エージェントの共有メモリー",
  "marketplace.plugin.cobrain.description":
    "Cobrain は、接続したすべての AI が読み書きできる Markdown のメモリーです。エージェントは作業の前にクライアントやプロジェクトのコンテキストを読み込み、過去のメモや決定事項を検索し、学んだことを保存します。そのため、次の会話は前回の続きから始まります。各ユーザーは自分の Cobrain アカウントにサインインします。",
  "marketplace.plugin.cobrain.app": "1 つの MCP サーバーで、Cobrain のメモを読み取り、検索し、書き込みます。",
  "marketplace.plugin.cobrain.prompt.startSession":
    "始める前に、このプロジェクトの Cobrain コンテキストを読み込んでください。",
  "marketplace.plugin.cobrain.prompt.searchDecision": "価格について決めたことを Cobrain のメモから探してください。",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "今日やったことと残っていることを Cobrain にメモとして保存してください。",
  "marketplace.plugin.figma.tagline": "デザインとプロトタイプ",
  "marketplace.plugin.figma.description":
    "Figma を使うと、エージェントはデザインファイルを読み取り、コンポーネント、スタイル、変数を調べ、本番用の仕様をエンジニアに渡せます。このコンピューターの Figma デスクトップアプリにある MCP サーバーに接続します。サーバーはデザインの読み取りのみ可能で、書き込みには現在対応中です。",
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
  "marketplace.plugin.appleApps.tagline": "Mac のメール、カレンダーなど",
  "marketplace.plugin.appleApps.description":
    "Apple apps を使うと、エージェントはこの Mac のメール、カレンダー、連絡先、リマインダー、メモ、メッセージ、Safari を使えます。macOS でのみ動作します。OpenBot は mcp-icloud を起動します。これは Apple や OpenBot が作ったものではない、コミュニティのサーバーです。サーバーはこのコンピューター上で AppleScript を使ってアプリを操作し、アカウントもキーも不要です。インストール時に、OpenBot はこれらすべてのアプリへのアクセスを macOS にまとめて求めることができます。確認はアプリごとに 1 回表示されます。求めない場合は、エージェントが初めてアプリを使うときに macOS が確認します。後で変更するには、システム設定 › プライバシーとセキュリティ › オートメーション を開いてください。エージェントはメールや iMessage を送信し、イベント、連絡先、リマインダーを変更・削除できるので、承認する前に各書き込みを確認してください。ツールが読んだ内容（メールの本文など）は、エージェントのモデルプロバイダーに送られます。",
  "marketplace.plugin.appleApps.app":
    "メール、カレンダー、連絡先、リマインダー、メモ、メッセージ、Safari を、ローカルの mcp-icloud サーバーで操作します。macOS とオートメーションの許可が必要です。",
  "marketplace.plugin.appleApps.prompt.unread": "Apple のメールで、今日の未読メールを要約してください。",
  "marketplace.plugin.appleApps.prompt.today": "今日と明日の Apple カレンダーの予定を教えてください。",
  "marketplace.plugin.appleApps.prompt.schedule":
    "プロジェクト会議に関する最新のメールを探して、その会議をカレンダーに追加してください。",
  "marketplace.plugin.sentry.tagline": "エラーとクラッシュのトリアージ",
  "marketplace.plugin.sentry.description":
    "Sentry を使うと、エージェントは最近のエラーを検索し、スタックトレースと影響を受けたリリースを調べ、デプロイ後に何が壊れたかをまとめられます。各ユーザーはブラウザーで自分の Sentry アカウントにサインインします。",
  "marketplace.plugin.sentry.app":
    "エラーの検索、Issue の調査、リリースの健全性を、ブラウザーでサインインする Sentry の MCP サーバーで提供します。",
  "marketplace.plugin.sentry.prompt.newErrors": "昨日のデプロイ以降に新しく発生したエラーは何ですか？",
  "marketplace.plugin.sentry.prompt.topCrash":
    "モバイルプロジェクトで最も多いクラッシュと、その原因として考えられるものを説明してください。",
  "marketplace.plugin.sentry.prompt.releaseHealth": "現在のリリースは前回と比べてどのくらい健全ですか？",
  "marketplace.plugin.vercel.tagline": "デプロイ、ビルドログ、プロジェクト",
  "marketplace.plugin.vercel.description":
    "Vercel を使うと、エージェントはプロジェクトと最近のデプロイを一覧表示し、ビルドログとランタイムログを読み、ビルドが失敗した理由を調べられます。各ユーザーはブラウザーで自分の Vercel アカウントにサインインし、エージェントが使えるチームを選びます。それらのチームでは、エージェントはユーザーのアカウントと同じ権限を持ちます。環境変数、ドメイン、DNS レコード、デプロイの変更や、ドメインの購入もできます。",
  "marketplace.plugin.vercel.app":
    "プロジェクト、デプロイ、ビルドログ、ランタイムログを、ブラウザーでサインインする Vercel の MCP サーバーで提供します。",
  "marketplace.plugin.vercel.prompt.failedBuild": "直近の本番デプロイが失敗したのはなぜですか？",
  "marketplace.plugin.vercel.prompt.recentDeployments": "今日のデプロイとそのステータスを一覧にしてください。",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "過去 1 時間にランタイムエラーが発生したルートはどれですか？",
  "marketplace.plugin.cloudflare.tagline": "Workers、DNS、ストレージ、ログ",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare を使うと、エージェントは Cloudflare API を通じて Workers、DNS レコード、R2、D1、KV を一覧表示して管理し、Workers のログを照会し、Cloudflare のドキュメントを検索できます。各ユーザーはブラウザーで自分の Cloudflare アカウントにサインインします。Cloudflare の同意ページでは Read only を選んでください。既定の Minimal では、エージェントは Workers、ログ、DNS レコードを参照できません。書き込み権限があると、エージェントは Workers のデプロイと削除、DNS レコードの変更、その他のアカウント設定の変更ができます。",
  "marketplace.plugin.cloudflare.app":
    "Workers、DNS、ストレージ、ログを、ブラウザーでサインインする Cloudflare の API MCP サーバーで提供します。",
  "marketplace.plugin.cloudflare.prompt.workers":
    "自分の Cloudflare アカウントにはどの Workers がデプロイされていますか？",
  "marketplace.plugin.cloudflare.prompt.errors": "過去 1 時間にエラーを記録した Cloudflare Workers はどれですか？",
  "marketplace.plugin.cloudflare.prompt.dns":
    "自分の Cloudflare アカウントの各ゾーンの DNS レコードを一覧表示してください。",
  "marketplace.plugin.supabase.tagline": "データベース、ログ、Edge Functions",
  "marketplace.plugin.supabase.description":
    "Supabase を使うと、エージェントはプロジェクトを一覧表示し、SQL を実行し、テーブルのスキーマとログを読み、advisors のセキュリティとパフォーマンスの指摘を確認し、Edge Functions とブランチを管理し、Supabase のドキュメントを検索できます。各ユーザーはブラウザーで自分の Supabase アカウントにサインインし、組織を選びます。エージェントにはフルアクセスが与えられます。データを変更または削除する SQL の実行、マイグレーションの適用、Edge Functions のデプロイ、プロジェクトの作成と一時停止ができます。",
  "marketplace.plugin.supabase.app":
    "データベース、ログ、Edge Functions を、ブラウザーでサインインする Supabase の MCP サーバーで提供します。",
  "marketplace.plugin.supabase.prompt.projects": "自分の Supabase 組織にはどのプロジェクトがありますか？",
  "marketplace.plugin.supabase.prompt.tables": "自分の Supabase データベースのテーブルと列を一覧表示してください。",
  "marketplace.plugin.supabase.prompt.errors": "自分の Supabase プロジェクトが過去 1 時間に記録したエラーは何ですか？",
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
    "Stripe を使うと、エージェントはサインイン中のユーザーがアクセスできるアカウントで、決済、顧客、請求書を調べ、支払いリンクの下書きを作成できます。各ユーザーはブラウザーで自分の Stripe アカウントにサインインします。",
  "marketplace.plugin.stripe.app":
    "決済、顧客、請求書の検索を、ブラウザーでサインインする Stripe の MCP サーバーで提供します。",
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
  "marketplace.plugin.obsidian.tagline": "保管庫のノート",
  "marketplace.plugin.obsidian.description":
    "Obsidian を使うと、エージェントが保管庫のノートを検索、閲覧、作成できるため、保管庫をエージェントの記憶として使えます。ローカルサーバーは、このコンピューターの Obsidian アプリにある Local REST API プラグインに接続します。プラグインの API キーは、1 つの環境変数としてローカルサーバーに渡されます。エージェントが使う間は Obsidian を開いたままにしてください。",
  "marketplace.plugin.obsidian.app":
    "ノートの検索、閲覧、編集。Local REST API プラグインのキーを使うローカル MCP サーバー経由です。",
  "marketplace.plugin.obsidian.prompt.recall":
    "このプロジェクトの決定事項について、私のノートには何が書かれていますか？",
  "marketplace.plugin.obsidian.prompt.save": "この決定を保管庫に新しいノートとして保存してください。",
  "marketplace.plugin.obsidian.prompt.log": "今日の作業のまとめを「作業ログ」ノートに追加してください。",
  "marketplace.plugin.obsidian.hint.apiKey":
    'Obsidian で Settings > Local REST API を開きます。API キーをコピーし、"Enable non-encrypted (HTTP) server" をオンにしてください。',
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
    "Composio は、1 つの MCP サーバーでエージェントを Gmail、Slack、GitHub など数百のアプリに接続します。Composio アカウントで使いたいアプリを接続し、その MCP URL と API キーをここに貼り付けてください。",
  "marketplace.plugin.composio.app":
    "Composio MCP サーバーに追加したアプリを、Composio アカウントのリンクで提供します。",
  "marketplace.plugin.composio.prompt.inbox": "未読メールをまとめて、急ぎのものに返信の下書きを作成してください。",
  "marketplace.plugin.composio.prompt.handoff": "このプルリクエストの概要をチームのチャンネルに投稿してください。",
  "marketplace.plugin.composio.prompt.apps": "Composio で使えるアプリと操作はどれですか？",
  "marketplace.plugin.composio.hint.url": "Composio アカウントにある MCP サーバーの URL",
  "marketplace.plugin.composio.hint.apiKey": "Composio アカウントの Settings > Sessions & API Key で確認できます。",
  "marketplace.plugin.neon.tagline": "Postgres のプロジェクト、ブランチ、マイグレーション",
  "marketplace.plugin.neon.description":
    "Neon を使うと、エージェントはプロジェクトとブランチを一覧表示し、SQL を実行し、テーブルスキーマを読み、一時ブランチでスキーマ変更をテストし、遅いクエリを見つけ、Neon のドキュメントを検索できます。各ユーザーはブラウザーで自分の Neon アカウントにサインインし、認可時に読み取り専用アクセスを選べます。フルアクセスの場合、エージェントはデータを変更または削除する SQL を実行でき、ブランチ、データベース、プロジェクトの作成、リセット、削除もできます。Neon は MCP サーバーを開発とテスト向けに推奨しており、本番データベースでの使用は推奨していません。",
  "marketplace.plugin.neon.app":
    "Postgres のプロジェクト、ブランチ、SQL、マイグレーションを、ブラウザーでサインインする Neon の MCP サーバーで提供します。",
  "marketplace.plugin.neon.prompt.projects": "私の Neon アカウントにはどのプロジェクトとブランチがありますか？",
  "marketplace.plugin.neon.prompt.slowQueries":
    "私の Neon データベースで最も遅いクエリはどれですか？その理由も教えてください。",
  "marketplace.plugin.neon.prompt.migration":
    "一時ブランチで orders テーブルにインデックスを追加し、適用する前に結果を見せてください。",
  "marketplace.plugin.prisma.tagline": "Postgres データベース、バックアップ、Compute アプリ",
  "marketplace.plugin.prisma.description":
    "Prisma を使うと、エージェントは Prisma Postgres データベースを一覧表示・作成し、スキーマを読み、SQL を実行し、バックアップを一覧表示して新しいデータベースに復元し、Object Storage のバケットを管理し、Compute のビルドとログを読み、Prisma のドキュメントを検索できます。各ユーザーはブラウザーで自分の Prisma アカウントにサインインし、ワークスペースを選びます。エージェントはフルアクセスを持ちます。データを変更または削除する SQL の実行、スキーマの更新、データベースとバケットの削除、Compute デプロイの停止、ロールバック、削除ができます。",
  "marketplace.plugin.prisma.app":
    "データベース、SQL、バックアップ、Compute アプリを、ブラウザーでサインインする Prisma の MCP サーバーで提供します。",
  "marketplace.plugin.prisma.prompt.databases": "私の Prisma ワークスペースにはどのデータベースがありますか？",
  "marketplace.plugin.prisma.prompt.backups": "私のデータベースで利用できるバックアップをすべて見せてください。",
  "marketplace.plugin.prisma.prompt.logs": "最新の Compute デプロイのランタイムログを見せてください。",
  "marketplace.plugin.netlify.tagline": "プロジェクト、デプロイ、リクエストログ",
  "marketplace.plugin.netlify.description":
    "Netlify を使うと、エージェントはプロジェクトとデプロイを一覧表示し、エッジのリクエストログを読み、プロジェクトを作成し、既存のプロジェクトにコードをデプロイできます。各ユーザーはブラウザーで自分の Netlify アカウントにサインインします。エージェントはユーザーのアカウントと同じアクセス権を持ちます。環境変数、フォーム、訪問者のアクセス設定の変更、拡張機能のインストールや削除、フォームの送信データと環境変数の削除ができます。",
  "marketplace.plugin.netlify.app":
    "プロジェクト、デプロイ、リクエストログ、サイト設定を、ブラウザーでサインインする Netlify の MCP サーバーで提供します。",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "私の各 Netlify プロジェクトの最新デプロイのステータスはどうなっていますか？",
  "marketplace.plugin.netlify.prompt.errors": "過去 1 日にサーバーエラーを返したサイトの URL はどれですか？",
  "marketplace.plugin.netlify.prompt.deploy": "このフォルダーを既存の Netlify プロジェクトにデプロイしてください。",
  "marketplace.plugin.railway.tagline": "プロジェクト、サービス、デプロイ",
  "marketplace.plugin.railway.description":
    "Railway を使うと、エージェントはプロジェクトとサービスを一覧表示し、プロジェクトを作成し、サービスを再デプロイし、フィーチャーフラグを管理できます。複数の手順が必要な作業は Railway Agent に任せることもできます。Railway Agent はログを読み、デプロイが失敗した理由を調べ、サービスを作成し、変数を設定します。各ユーザーはブラウザーで自分の Railway アカウントにサインインし、エージェントが使えるワークスペースとプロジェクトを選びます。それらのプロジェクトでは、エージェントはフルアクセスを持ちます。ステージされた変更のデプロイやフィーチャーフラグの削除ができ、Railway Agent を通じてサービス、変数、データベース、ネットワークも変更できます。",
  "marketplace.plugin.railway.app":
    "プロジェクト、サービス、デプロイを、ブラウザーでサインインする Railway の MCP サーバーで提供します。",
  "marketplace.plugin.railway.prompt.projects":
    "自分の Railway ワークスペースにはどのプロジェクトとサービスがありますか？",
  "marketplace.plugin.railway.prompt.crash":
    "Railway のバックエンドサービスがデプロイ時にクラッシュするのはなぜですか？",
  "marketplace.plugin.railway.prompt.redeploy": "自分の Railway プロジェクトの API サービスを再デプロイしてください。",
  "marketplace.plugin.render.tagline": "サービス、デプロイ、ログ",
  "marketplace.plugin.render.description":
    "Render を使うと、エージェントはワークスペースとサービスを一覧表示し、ログ、イベント、メトリクスを読み、デプロイ履歴を確認し、デプロイを開始し、Render Postgres で読み取り専用の SQL を実行できます。Render の API キーは 1 つの Authorization ヘッダーに入ります。このキーは Render アカウントのすべてのワークスペースに届きます。エージェントは Web サービス、静的サイト、cron ジョブ、Postgres データベース、Key Value インスタンスを作成でき、これには費用がかかる場合があります。また、サービスの環境変数を置き換えることもできます。サーバーはリソースを削除できません。",
  "marketplace.plugin.render.app":
    "サービス、デプロイ、ログ、メトリクスを、API キーを使う Render の MCP サーバーで提供します。",
  "marketplace.plugin.render.prompt.services": "自分の Render ワークスペースにはどのサービスがありますか？",
  "marketplace.plugin.render.prompt.logs": "Render の Web サービスが直近 1 時間に記録したエラーは何ですか？",
  "marketplace.plugin.render.prompt.deploy": "Render サービスの最後のデプロイが失敗したのはなぜですか？",
  "marketplace.plugin.atlassian.tagline": "Jira の作業項目と Confluence のページ",
  "marketplace.plugin.atlassian.description":
    "Atlassian を使うと、エージェントは Jira の作業項目、Confluence のページ、Bitbucket のプルリクエストを検索して読み、作業項目、ページ、コメントを作成または更新できます。各ユーザーはブラウザーで自分の Atlassian アカウントにサインインし、同意画面でアクセスを承認します。エージェントはユーザーと同じ権限を持ちます。作業項目とページの変更、ページの権限の変更、プルリクエストのマージができます。Jira のデータを削除するツールは、組織の管理者がオンにするまでオフのままです。ツールを呼び出すたびに Rovo クレジットを使います。",
  "marketplace.plugin.atlassian.app":
    "Jira、Confluence、Bitbucket を、ブラウザーでサインインする Atlassian の MCP サーバーで提供します。",
  "marketplace.plugin.atlassian.prompt.assigned": "自分に割り当てられている未完了の Jira の作業項目はどれですか？",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "リリース手順についての Confluence のページを探して要約してください。",
  "marketplace.plugin.atlassian.prompt.newItem":
    "ログインのバグについて、再現手順を付けて Jira の作業項目を作成してください。",
  "marketplace.plugin.todoist.tagline": "タスク、プロジェクト、リマインダー",
  "marketplace.plugin.todoist.description":
    "Todoist を使うと、エージェントは日付、テキスト、ラベル、フィルターでタスクを探し、タスクを追加して日程を変更し、プロジェクト、セクション、ラベル、コメント、リマインダーを管理できます。各ユーザーはブラウザーで自分の Todoist アカウントにサインインします。エージェントには読み取りと書き込みの権限があり、タスク、プロジェクト、その他の項目を変更、完了、削除できます。",
  "marketplace.plugin.todoist.app":
    "タスク、プロジェクト、リマインダーを、ブラウザーでサインインする Todoist の MCP サーバーで提供します。",
  "marketplace.plugin.todoist.prompt.today": "今日が期限の Todoist タスクはどれですか？",
  "marketplace.plugin.todoist.prompt.capture": "これらのアクション項目を Todoist のインボックスに追加してください。",
  "marketplace.plugin.todoist.prompt.overdue": "期限切れの Todoist タスクを明日に移してください。",
  "marketplace.plugin.trello.tagline": "ボード、リスト、カード",
  "marketplace.plugin.trello.description":
    "Trello を使うと、エージェントはボード、リスト、カード、チェックリスト、コメントを検索して読み、ボードとカードを作成し、リストとカードを移動し、カードを完了にし、チェックリスト、コメント、ラベルを追加できます。また、ユーザーの Trello インボックスのカードを読んで追加し、Planner の予定を読むこともできます。予定は、接続された Google または Outlook のカレンダーから来ることがあります。各ユーザーはブラウザーで自分の Trello アカウントにサインインし、同意画面でワークスペースを選びます。エージェントには、それらのワークスペースでユーザーと同じ権限があります。カードとリストをアーカイブできますが、サーバーは何も完全には削除できません。",
  "marketplace.plugin.trello.app":
    "ボード、リスト、カードを、ブラウザーでサインインする Trello の MCP サーバーで提供します。",
  "marketplace.plugin.trello.prompt.myCards": "自分に割り当てられた Trello カードはどれですか？",
  "marketplace.plugin.trello.prompt.board": "Trello ボードで進行中の作業をまとめてください。",
  "marketplace.plugin.trello.prompt.newCards": "これらのアクション項目をカードとして Trello ボードに追加してください。",
  "marketplace.plugin.huggingface.tagline": "Hub のモデル、データセット、論文",
  "marketplace.plugin.huggingface.description":
    "Hugging Face を使うと、エージェントは Hugging Face Hub のモデル、データセット、Spaces、コレクション、論文を検索し、モデルカードやリポジトリのファイルを読み、データセットをプレビューし、Hugging Face のドキュメントを検索できます。公開されている Hub のデータを使うので、アカウントもキーも不要です。ツールは読み取り専用で、エージェントはリポジトリの作成やジョブの実行はできません。",
  "marketplace.plugin.huggingface.app":
    "モデル、データセット、Spaces、論文、ドキュメントの検索を、サインイン不要の Hugging Face MCP サーバーで提供します。",
  "marketplace.plugin.huggingface.prompt.models": "Hugging Face で音声認識用の小さなオープンモデルを探してください。",
  "marketplace.plugin.huggingface.prompt.papers": "今日 Hugging Face で話題の論文はどれですか？",
  "marketplace.plugin.huggingface.prompt.dataset": "気象の時系列データセットを探して、その列を見せてください。",
  "marketplace.auth.apiKey": "API キー",
  "marketplace.auth.personalApiKey": "個人用 API キー",
  "marketplace.auth.mcpUrl": "MCP URL",
  "marketplace.auth.createKey": "キーを作成",

  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "{name} で試す",
  "marketplace.skills.yours": "あなたのスキル",
  "marketplace.skills.seeAll": "すべて表示",
  "marketplace.skills.seeAllName": "すべて表示: {name}",
  "marketplace.skills.none": "スキルを持つエージェントはまだいません。",
  "marketplace.skills.noneHint":
    "スキルはエージェントに 1 つのタスクを教えます。下から追加するか、自分で作成してください。",
  "marketplace.skills.sourceLabel": "提供元",
  "marketplace.skills.source.all": "すべて",
  "marketplace.skills.source.verified": "検証済み",
  "marketplace.skills.source.public": "公開",
  "marketplace.skills.source.verifiedLong": "OpenBot が検証済み",
  "marketplace.skills.source.publicLong": "公開: OpenBot は確認していません",
  "marketplace.skills.sortLabel": "並べ替え",
  "marketplace.skills.sortName": "並べ替え: {name}",
  "marketplace.skills.sort.installs": "利用数順",
  "marketplace.skills.sort.updated": "最近の更新",
  "marketplace.skills.sort.name": "名前",
  "marketplace.skills.featured": "おすすめ",
  "marketplace.skills.all": "すべてのスキル",
  "marketplace.skills.count": { other: "{count} 件のスキル" },
  "marketplace.skills.searchIn": "{name} を検索",
  "marketplace.skills.state.off": "オフ",
  "marketplace.skills.state.repair": "修復が必要",
  "marketplace.skills.state.update": "アップデートあり",
  "marketplace.skills.state.modified": "自分で変更済み",
  "marketplace.skills.stateOn": "{agents}: {state}",
  "marketplace.skills.version": "バージョン {version}",
  "marketplace.skills.origin.local": "このコンピューターで作成",
  "marketplace.skills.origin.workspace": "このエージェントのフォルダー内",
  "marketplace.skills.origin.marketplace": "マーケットプレイスから · バージョン {version}",
  "marketplace.skills.status.notAdded": "未追加",
  "marketplace.skills.status.on": "{agents} でオン",
  "marketplace.skills.agentCount": { other: "エージェント {count} 件" },
  "marketplace.skills.allAgents": "すべてのエージェント",
  "marketplace.skills.agentsTitle": "エージェント · {total}",
  "marketplace.skills.agents.search": "エージェントを検索",
  "marketplace.skills.agents.searchName": "{name} を持つエージェントを検索",
  "marketplace.skills.agents.noMatch": "「{query}」に一致するエージェントはありません。",
  "marketplace.skills.agents.removeAll": "すべて削除",
  "marketplace.skills.agents.removeAllName": { other: "エージェント {count} 件から {name} を削除" },
  "marketplace.skills.agent.toggle": "{agent} の {name}",
  "marketplace.skills.agent.remove": "削除",
  "marketplace.skills.agent.removeName": "{agent} から {name} を削除",
  "marketplace.skills.add": "追加",
  "marketplace.skills.addName": "{name} をエージェントに追加",
  "marketplace.skills.addToAgents": "エージェントに追加",
  "marketplace.skills.onOf": "{total} 件中 {have} 件でオン",
  "marketplace.skills.chooseAgents": "{name} は {agents} にあります。エージェントを選択",
  "marketplace.skills.dialog.list": "{name} を持つエージェント",
  "marketplace.skills.dialog.search": { other: "エージェント {count} 件を検索" },
  "marketplace.skills.dialog.all": { other: "すべてのエージェント ({count} 件)" },
  "marketplace.skills.dialog.allMatches": { other: "一致した {count} 件すべて" },
  "marketplace.skills.dialog.checked": "{checked} / {total}",
  "marketplace.skills.dialog.save": "保存",
  "marketplace.skills.dialog.saveBoth": "保存: {added} 件追加、{removed} 件削除",
  "marketplace.skills.dialog.addTo": "{agents} に追加",
  "marketplace.skills.dialog.removeFrom": "{agents} から削除",
  "marketplace.skills.dialog.full": "スキルの上限に達しました",
  "marketplace.skills.dialog.unread": "スキルを読み込めていません",
  "marketplace.skills.local.gone": "このスキルを持つエージェントは現在いません。",

  "marketplace.notice.agentAdded": "{name} を追加しました。",
  "marketplace.notice.agentUpdated": "{name} をアップデートしました。",
  "marketplace.notice.appConnected": "{name} を接続しました。",
  "marketplace.notice.appDisconnected": "{name} を切断しました。",
  "marketplace.notice.serverRemoved": "{name} を削除しました。",
  "marketplace.notice.skillInstalled": { other: "{name} をエージェント {count} 件にインストールしました。" },
  "marketplace.notice.skillRemoved": { other: "{name} をエージェント {count} 件から削除しました。" },
  "marketplace.error.skillPartial": "次のエージェントでは {name} が変更されませんでした: {agents}。{reason}",

  "marketplace.error.openLink": "リンクを開けませんでした。",
  "marketplace.error.copyLink": "リンクをコピーできませんでした。",
  "marketplace.error.connectNoServer": "このアプリを接続するローカルサーバーを選択してください。",
  "marketplace.error.installNoServer": "プラグインをインストールするローカルサーバーを選択してください。",
  "marketplace.error.installNoAgent": "このプラグインのスキルをインストールするエージェントを選んでください。",
  "marketplace.error.installLocalOnHost":
    "{name} は、これらのエージェントを実行するコンピューターにインストールしてください。そのアプリはそのコンピューター上でサーバーを実行します。",
  "marketplace.error.installOnHost":
    "{name} は、これらのエージェントを実行するコンピューターにインストールしてください。そのアプリはブラウザーでのサインインが必要です。",
  "marketplace.error.appInvalid": "{name} を追加できません: {reason}",
  "marketplace.error.uninstallNoServer": "プラグインをアンインストールするローカルサーバーを選択してください。",
  "marketplace.error.uninstallPartial": "{name} の一部を削除できませんでした。{failures}",
  "marketplace.error.actionFailed": "マーケットプレイスの操作を完了できませんでした。もう一度お試しください。",
  "marketplace.thisAgent": "このエージェント",
} as const satisfies PartialTranslation<typeof source>;
