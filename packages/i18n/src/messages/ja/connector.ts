import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Server settings > Connectors: the built-in GitHub connection of this computer.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "このコンピュータのすべてのエージェントが、GitHub のリポジトリ、Issue、プルリクエスト、gh と git を使えます。",
  "connector.github.connect": "GitHub を接続",
  "connector.github.pendingTitle": "このコードを GitHub に入力してください",
  "connector.github.pendingDescription":
    "ブラウザで GitHub が開きました。接続するには、そこにコードを入力してください。",
  "connector.github.waiting": "GitHub を待っています",
  "connector.github.copyCode": "コードをコピー",
  "connector.github.codeCopied": "コピーしました",
  "connector.github.openGitHub": "GitHub を開く",
  "connector.github.cancel": "キャンセル",
  "connector.github.connectedAs": "@{login} として接続済み",
  "connector.github.repositoriesTitle": "リポジトリ",
  "connector.github.repositoriesDescription":
    "エージェントが使えるのは、OpenBot GitHub App がインストールされたリポジトリだけです。",
  "connector.github.chooseRepositories": "リポジトリを選ぶ",
  "connector.github.repositoriesLoading": "GitHub からリポジトリを読み込んでいます",
  "connector.github.repositoriesFailed": "OpenBot は GitHub からリポジトリを読み込めませんでした。",
  "connector.github.noRepositories": "OpenBot GitHub App はまだどのリポジトリにもインストールされていません。",
  "connector.github.moreRepositories": { other: "ほか {count} 件のリポジトリ" },
  "connector.github.private": "非公開",
  "connector.github.disconnect": "切断",
  "connector.github.disconnectTitle": "GitHub を切断",
  "connector.github.disconnectSummary":
    "すべてのエージェントが GitHub を使えなくなります。チャットとファイルは残ります。",
  "connector.github.expiredTitle": "GitHub の接続の有効期限が切れました",
  "connector.github.expiredDescription":
    "エージェントが再び GitHub を使えるように、@{login} としてもう一度接続してください。",
  "connector.github.reconnect": "再接続",
  "connector.github.actionFailed": "OpenBot は GitHub の接続を変更できませんでした。",
  "connector.github.statusConnected": "接続済み",
  "connector.github.statusConnecting": "接続中",
  "connector.github.statusExpired": "期限切れ",
  "connector.github.statusNotSetUp": "未設定",
  "connector.github.accountTitle": "アカウント",
  "connector.github.filterPlaceholder": { other: "{count} 件のリポジトリを絞り込む" },
  "connector.github.filterLabel": "リポジトリを絞り込む",
  "connector.github.noMatch": "「{query}」に一致するリポジトリはありません。",
  "connector.github.stepSignIn": "サインイン",
  "connector.github.stepConnected": "接続済み",
  "connector.github.requestingCode": "OpenBot が GitHub にコードを要求しています。",
  "connector.github.codeLabel": "コード {code}",
  "connector.github.failedTitle": "GitHub に接続できませんでした",
  "connector.github.cancelConnecting": "GitHub の接続をキャンセル",
  "connector.github.connectedSummary": {
    other: "リポジトリ {count} 件 · このコンピュータのすべてのエージェント",
  },
  "connector.github.done": "完了",
  "connector.github.later": "後で",
  "connector.github.disconnectConfirmTitle": "GitHub を切断しますか？",
  "connector.github.disconnectConfirmDescription":
    "切断すると、@{login} のサインイン情報がこのコンピュータから削除されます。",
  "connector.github.disconnectEffectTools": "すべてのエージェントが GitHub のツール、gh、git を使えなくなります。",
  "connector.github.disconnectEffectRevoke": "その後 GitHub が開き、OpenBot のアクセスを取り消せます。",
  "connector.github.disconnectEffectKept": "チャット、ファイル、エージェントのメモリーはこのコンピュータに残ります。",
  "connector.github.keepConnected": "接続したままにする",
  "connector.github.close": "閉じる",
  "connector.dangerZone": "危険な操作",

  // Server settings > Connectors: the list of integrations. Each row opens its page.
  "connector.hub.onThisComputer": "このコンピュータ上",
  "connector.hub.notSetUp": "未設定",
  "connector.hub.available": "利用可能",
  "connector.hub.open": "{name} を開く",
  "connector.hub.setUp": "設定",
  "connector.hub.back": "すべてのコネクター",
  "connector.hub.usedBy": "{names} が使用中",

  // Server settings > Connectors > Slack.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Slack で @OpenBot をメンションするか、ダイレクトメッセージを送ります。Slack Orchestrator が適切なエージェントに依頼して回答します。",
  "connector.slack.statusNotSetUp": "未設定",
  "connector.slack.statusConnected": "接続済み",
  "connector.slack.statusAttention": "対応が必要",
  "connector.slack.summaryConnected": "{workspace} · Slack Orchestrator が回答します",
  "connector.slack.summaryNoAgent": "{workspace} · 回答するエージェントはまだいません",
  "connector.slack.attentionTitle": {
    other: "{count} 件のワークスペースに対応が必要です",
  },
  "connector.slack.attentionDescription": "下の状態に、必要な対応が表示されます。",
  "connector.slack.connect": "Slack を接続",
  "connector.slack.addAgent": "エージェントを追加",
  "connector.slack.actionFailed": "Slack は変更を受け付けませんでした",
  "connector.slack.workspaceTitle": "ワークスペース",
  "connector.slack.workspaceDescription": "@OpenBot をメンションするか、ダイレクトメッセージを送ります。",
  "connector.slack.disconnectWorkspace": "切断",
  "connector.slack.missingScopes":
    "OpenBot には Slack で次の権限がありません：{scopes}。ワークスペースを切断してから、もう一度接続してください。",
  "connector.slack.retryAt": "Slack から待機するよう求められました。{time} に再試行します。",
  "connector.slack.reconnect": "再接続",
  "connector.slack.resume": "再開",
  "connector.slack.rowAction": "{action}：{name}",
  "connector.slack.orchestratorTitle": "Slack Orchestrator",
  "connector.slack.orchestratorDescription":
    "このエージェントは Slack からのすべてのリクエストを受け取ります。短いものには自分で回答し、その他の作業は適切なエージェントに任せて、回答をスレッドに投稿します。",
  "connector.slack.orchestratorNone": "回答するエージェントはまだいません",
  "connector.slack.orchestratorNoneDescription":
    "Slack Orchestrator を追加してください。追加しないと、Slack に回答が届きません。",
  "connector.slack.inviteNote":
    "OpenBot はすべての公開チャンネルと新しいチャンネルに自動で参加します。非公開チャンネルには招待してください：/invite @OpenBot",
  "connector.slack.stepWorkspace": "ワークスペース",
  "connector.slack.stepAgent": "エージェント",
  "connector.slack.connectTitle": "Slack ワークスペースを接続",
  "connector.slack.connectDescription":
    "OpenBot はワークスペースに OpenBot という名前のアプリを 1 つインストールし、そのアプリはすべての公開チャンネルに参加します。",
  "connector.slack.connectStepBrowser": "ブラウザで Slack が開きます",
  "connector.slack.connectStepAllow": "右上でワークスペースを選び、「許可する」を押します",
  "connector.slack.connectStepReturn": "Slack での操作が終わると、このダイアログが続行します",
  "connector.slack.connectInSlack": "Slack で接続",
  "connector.slack.connectWaiting": "Slack を待っています。ブラウザでインストールを完了してください。",
  "connector.slack.agentStepTitle": "Slack Orchestrator を追加",
  "connector.slack.agentStepDescription":
    "この新しいエージェントは、{workspace} で @OpenBot に送られたすべてのメッセージに回答します。",
  "connector.slack.orchestratorName": "Slack Orchestrator",
  "connector.slack.orchestratorRole": "Slack で回答し、チームに依頼します",
  "connector.slack.orchestratorDoesReceive": "Slack のすべてのリクエストを最初に受け取ります",
  "connector.slack.orchestratorDoesDelegate": "各タスクを最も適したエージェントに任せます",
  "connector.slack.orchestratorDoesAnswer": "回答を Slack のスレッドに投稿します",
  "connector.slack.orchestratorModel": "モデル",
  "connector.slack.doneTitle": "OpenBot が {workspace} に参加しました",
  "connector.slack.doneDescription":
    "公開チャンネルで @OpenBot をメンションするか、ダイレクトメッセージを送ってください。",
  "connector.slack.done": "完了",
  "connector.slack.disconnectTitle": "{workspace} を切断しますか？",
  "connector.slack.disconnectDescription":
    "OpenBot は {workspace} での回答を停止し、Slack のトークンをこのコンピュータから削除します。",
  "connector.slack.disconnectEffect":
    "{workspace} のメンバーは、@OpenBot からあなたのエージェントに連絡できなくなります。",
  "connector.slack.removeEffectKept": "会話と Slack Orchestrator は OpenBot に残ります。",
  "connector.slack.keep": "接続したままにする",
  "connector.slack.close": "閉じる",

  // Server settings > Connectors > Discord. Always write "Discord server": "server" alone is an
  // OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Discord サーバーのチャンネルで @OpenBot をメンションします。Discord Orchestrator が適切なエージェントに依頼して回答します。",
  "connector.discord.statusNotSetUp": "未設定",
  "connector.discord.statusConnected": "接続済み",
  "connector.discord.statusAttention": "対応が必要",
  "connector.discord.summaryConnected": "{workspace} · Discord Orchestrator が回答します",
  "connector.discord.summaryNoAgent": "{workspace} · 回答するエージェントはまだいません",
  "connector.discord.attentionTitle": {
    other: "{count} 件の Discord サーバーに対応が必要です",
  },
  "connector.discord.attentionDescription": "下の状態に、必要な対応が表示されます。",
  "connector.discord.connect": "Discord を接続",
  "connector.discord.addAgent": "エージェントを追加",
  "connector.discord.actionFailed": "Discord は変更を受け付けませんでした",
  "connector.discord.workspaceTitle": "Discord サーバー",
  "connector.discord.workspaceDescription":
    "チャンネルで @OpenBot をメンションします。続けるには OpenBot に返信します。",
  "connector.discord.disconnectWorkspace": "切断",
  "connector.discord.missingScopes":
    "OpenBot には Discord で次の権限がありません：{scopes}。Discord サーバーを切断してから、もう一度接続してください。",
  "connector.discord.retryAt": "Discord から待機するよう求められました。{time} に再試行します。",
  "connector.discord.reconnect": "再接続",
  "connector.discord.resume": "再開",
  "connector.discord.rowAction": "{action}：{name}",
  "connector.discord.orchestratorTitle": "Discord Orchestrator",
  "connector.discord.orchestratorDescription":
    "このエージェントは Discord からのすべてのリクエストを受け取ります。短いものには自分で回答し、その他の作業は適切なエージェントに任せて、チャンネルで回答を返信します。",
  "connector.discord.orchestratorNone": "回答するエージェントはまだいません",
  "connector.discord.orchestratorNoneDescription":
    "Discord Orchestrator を追加してください。追加しないと、Discord に回答が届きません。",
  "connector.discord.channelsNote": "OpenBot には、そのロールが閲覧できるチャンネルが見えます。",
  "connector.discord.stepWorkspace": "Discord サーバー",
  "connector.discord.stepAgent": "エージェント",
  "connector.discord.connectTitle": "Discord サーバーを接続",
  "connector.discord.connectDescription": "OpenBot は Discord サーバーに OpenBot という名前のボットを 1 つ追加します。",
  "connector.discord.connectStepBrowser": "ブラウザで Discord が開きます",
  "connector.discord.connectStepAllow": "サーバーを選び、「認証」を押します",
  "connector.discord.connectStepReturn": "Discord での操作が終わると、このダイアログが続行します",
  "connector.discord.connectInDiscord": "Discord で接続",
  "connector.discord.connectWaiting": "Discord を待っています。ブラウザで認証を完了してください。",
  "connector.discord.agentStepTitle": "Discord Orchestrator を追加",
  "connector.discord.agentStepDescription":
    "この新しいエージェントは、{workspace} で @OpenBot に送られたすべてのメッセージに回答します。",
  "connector.discord.orchestratorName": "Discord Orchestrator",
  "connector.discord.orchestratorRole": "Discord で回答し、チームに依頼します",
  "connector.discord.orchestratorDoesReceive": "Discord のすべてのリクエストを最初に受け取ります",
  "connector.discord.orchestratorDoesDelegate": "各タスクを最も適したエージェントに任せます",
  "connector.discord.orchestratorDoesAnswer": "Discord のチャンネルで回答を返信します",
  "connector.discord.orchestratorModel": "モデル",
  "connector.discord.doneTitle": "OpenBot が {workspace} に参加しました",
  "connector.discord.doneDescription":
    "チャンネルで @OpenBot をメンションしてください。続けるには OpenBot に返信してください。",
  "connector.discord.done": "完了",
  "connector.discord.disconnectTitle": "{workspace} を切断しますか？",
  "connector.discord.disconnectDescription":
    "OpenBot は {workspace} での回答を停止し、Discord の接続をこのコンピュータから削除します。",
  "connector.discord.disconnectEffect":
    "{workspace} のメンバーは、@OpenBot からあなたのエージェントに連絡できなくなります。",
  "connector.discord.removeEffectKept": "会話と Discord Orchestrator は OpenBot に残ります。",
  "connector.discord.keep": "接続したままにする",
  "connector.discord.close": "閉じる",

  // Server settings > Connectors > Telegram.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "OpenBot ボットを Telegram グループに追加するか、ボットとのダイレクトチャットを開きます。Telegram Orchestrator が適切なエージェントに依頼して回答します。",
  "connector.telegram.statusNotSetUp": "未設定",
  "connector.telegram.statusConnected": "接続済み",
  "connector.telegram.statusAttention": "対応が必要",
  "connector.telegram.summaryConnected": {
    other: "チャット {count} 件 · Telegram Orchestrator が回答します",
  },
  "connector.telegram.summaryNoAgent": {
    other: "チャット {count} 件 · 回答するエージェントはまだいません",
  },
  "connector.telegram.attentionTitle": {
    other: "{count} 件のチャットに対応が必要です",
  },
  "connector.telegram.attentionDescription": "下の状態に、必要な対応が表示されます。",
  "connector.telegram.connect": "Telegram を接続",
  "connector.telegram.addAgent": "エージェントを追加",
  "connector.telegram.actionFailed": "Telegram は変更を受け付けませんでした",
  "connector.telegram.chatsTitle": "チャット",
  "connector.telegram.groupDescription": "ボットをメンションするか、ボットのメッセージに返信します。",
  "connector.telegram.directDescription": "このチャットのすべてのメッセージが Telegram Orchestrator に届きます。",
  "connector.telegram.helpRemoved":
    "OpenBot ボットはこのチャットにいません。チャットを切断してから、ボットをもう一度追加してください。",
  "connector.telegram.helpRelayUnavailable":
    "このコンピュータでは OpenBot が Telegram のメッセージを受信できません。サインインし、サーバー設定でこのコンピュータに名前を付けて、OpenBot を開いたままにしてください。",
  "connector.telegram.helpError": "OpenBot はこのチャットに接続できません。再接続するか、チャットを切断してください。",
  "connector.telegram.retryAt": "Telegram から待機するよう求められました。{time} に再試行します。",
  "connector.telegram.pause": "一時停止",
  "connector.telegram.resume": "再開",
  "connector.telegram.reconnect": "再接続",
  "connector.telegram.disconnectChat": "切断",
  "connector.telegram.rowAction": "{action}：{name}",
  "connector.telegram.linkTitle": "別のチャットをリンク",
  "connector.telegram.linkDescription":
    "ブラウザで Telegram が開きます。リンクされると、チャットがここに表示されます。",
  "connector.telegram.linkWaiting": "Telegram を待っています。Telegram でチャットを選んでください。",
  "connector.telegram.addToGroup": "グループに追加",
  "connector.telegram.openDirectChat": "ダイレクトチャットを開く",
  "connector.telegram.orchestratorTitle": "Telegram Orchestrator",
  "connector.telegram.orchestratorDescription":
    "このエージェントは、すべての Telegram チャットから OpenBot 宛てのメッセージを受け取ります。短いものには自分で回答し、その他の作業は適切なエージェントに任せて、回答をチャットに投稿します。",
  "connector.telegram.orchestratorNone": "回答するエージェントはまだいません",
  "connector.telegram.orchestratorNoneDescription":
    "Telegram Orchestrator を追加してください。追加しないと、Telegram に回答が届きません。",
  "connector.telegram.mentionNote":
    "グループでは、ボットをメンションするか、ボットのメッセージに返信します。ダイレクトチャットでは、すべてのメッセージがボットに届きます。",
  "connector.telegram.stepChat": "チャット",
  "connector.telegram.stepAgent": "エージェント",
  "connector.telegram.connectTitle": "Telegram チャットをリンク",
  "connector.telegram.connectDescription":
    "OpenBot ボットをグループに追加するか、ボットとのダイレクトチャットを開きます。1 つのボットがすべてのチャットに対応します。",
  "connector.telegram.connectStepBrowser": "ブラウザで Telegram が開きます",
  "connector.telegram.connectStepPick": "グループを選ぶか、ダイレクトチャットで「開始」を押します",
  "connector.telegram.connectStepReturn": "チャットがリンクされると、このダイアログが続行します",
  "connector.telegram.connectWaiting": "Telegram を待っています。Telegram でチャットを選んでください。",
  "connector.telegram.agentStepTitle": "Telegram Orchestrator を追加",
  "connector.telegram.agentStepDescription":
    "この新しいエージェントは、{chat} と、あとでリンクする各チャットで、OpenBot 宛てのメッセージに回答します。",
  "connector.telegram.orchestratorName": "Telegram Orchestrator",
  "connector.telegram.orchestratorRole": "Telegram で回答し、チームに依頼します",
  "connector.telegram.orchestratorDoesReceive": "OpenBot 宛ての Telegram のメッセージをすべて最初に受け取ります",
  "connector.telegram.orchestratorDoesDelegate": "各タスクを最も適したエージェントに任せます",
  "connector.telegram.orchestratorDoesAnswer": "回答を Telegram のチャットに投稿します",
  "connector.telegram.orchestratorModel": "モデル",
  "connector.telegram.doneTitle": "OpenBot が {chat} に参加しました",
  "connector.telegram.done": "完了",
  "connector.telegram.disconnectTitle": "{chat} を切断しますか？",
  "connector.telegram.disconnectDescription":
    "OpenBot ボットは {chat} から退出し、OpenBot はそこでの回答を停止します。会話は OpenBot に残ります。",
  "connector.telegram.disconnectEffect":
    "{chat} のメンバーは、OpenBot ボットからあなたのエージェントに連絡できなくなります。",
  "connector.telegram.removeEffectKept": "会話と Telegram Orchestrator は OpenBot に残ります。",
  "connector.telegram.keep": "接続したままにする",
  "connector.telegram.close": "閉じる",
  // Marketplace > 1Password: a vault that the user shares with OpenBot through a service account.
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "専用の 1Password 保管庫をサービスアカウント経由で OpenBot と共有すると、エージェントが OpenBot のブラウザでサイトにサインインできます。",
  "connector.onePassword.howItWorks":
    "接続すると、1Password アカウントに「Shared with OpenBot」保管庫と、その保管庫だけを読み取れるサービスアカウントが設定されます。OpenBot はこのコンピュータの自分のブラウザで保存済みのログイン情報を入力するので、共有されるのはその保管庫に移動した項目だけです。エージェントがパスワードを見ることはありません。",
  "connector.onePassword.connect": "1Password を接続",
  "connector.onePassword.setupTitle": "設定",
  "connector.onePassword.stepCliTitle": "1Password CLI をインストール",
  "connector.onePassword.stepCliChecking": "このコンピュータで 1Password CLI を探しています",
  "connector.onePassword.stepCliInstalling": "1Password から 1Password CLI をダウンロードしています",
  "connector.onePassword.stepCliReady": "バージョン {version} がインストールされています。",
  "connector.onePassword.stepCliMissing":
    "OpenBot は 1Password から専用のフォルダーにダウンロードします。管理者パスワードは不要です。",
  "connector.onePassword.stepCliManual":
    "OpenBot はこのコンピュータにインストールできません。1Password からインストールしてから、このページに戻ってください。",
  "connector.onePassword.installCli": "インストール",
  "connector.onePassword.stepAppTitle": "CLI 連携をオンにする",
  "connector.onePassword.stepAppDescription":
    "1Password アプリで「設定」>「開発者」を開き、「1Password CLI と連携」をオンにしてください。",
  "connector.onePassword.stepAppReady": "1Password アプリで、CLI が共有保管庫を作成できるようになっています。",
  "connector.onePassword.openApp": "1Password を開く",
  "connector.onePassword.checkAgain": "再確認",
  "connector.onePassword.stepVaultTitle": "共有保管庫を作成",
  "connector.onePassword.stepVaultDescription":
    "OpenBot は「Shared with OpenBot」保管庫と、それを読み取ることだけができるサービスアカウントを作成します。1Password から承認を求められます。",
  "connector.onePassword.useToken": "代わりにサービスアカウントのトークンを使う",
  "connector.onePassword.tokenLabel": "サービスアカウントのトークン",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "接続",
  "connector.onePassword.approveInApp": "1Password アプリでリクエストを承認してください",
  "connector.onePassword.cancel": "キャンセル",
  "connector.onePassword.chooseAccountTitle": "アカウントを選ぶ",
  "connector.onePassword.chooseAccountDescription": "OpenBot は選んだアカウントに共有保管庫を作成します。",
  "connector.onePassword.useAccount": "このアカウントを使う",
  "connector.onePassword.vaultTitle": "共有保管庫",
  "connector.onePassword.vaultDescription":
    "エージェントにログイン情報でサインインさせるには、1Password でそのログイン情報をこの保管庫に移動してください。やめるには削除してください。",
  "connector.onePassword.loginsLoading": "1Password からログイン情報を読み込んでいます",
  "connector.onePassword.loginCount": { other: "ログイン情報 {count} 件" },
  "connector.onePassword.disconnect": "切断",
  "connector.onePassword.disconnectTitle": "1Password を切断",
  "connector.onePassword.disconnectSummary":
    "OpenBot はトークンを破棄します。保管庫とサービスアカウントは 1Password に残ります。不要になったら 1Password で削除してください。",
  "connector.onePassword.actionFailed": "OpenBot は 1Password の接続を変更できませんでした。",
  "connector.onePassword.statusConnected": "接続済み",
  "connector.onePassword.statusConnecting": "接続中",
  "connector.onePassword.statusNotSetUp": "未設定",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Bitwarden のログイン情報をブラウザに入力します。",
  "connector.bitwarden.setup":
    "Bitwarden CLI をインストールし、bw login でサインインしてください。Shared with OpenBot という名前のフォルダーを作成し、エージェントに使わせてよいログイン情報だけを入れてください。bw unlock --raw を実行し、表示されたセッションキーを下に貼り付けてください。マスターパスワードは貼り付けないでください。",
  "connector.bitwarden.scope":
    "このコンピュータのすべてのエージェントが、Shared with OpenBot 内の一致するログイン情報を使えます。OpenBot は HTTPS のオリジンが完全に一致する場合にのみ使います。マスターパスワードの再入力が必要な項目や、カスタムの URI 一致ルールがある項目は使いません。",
  "connector.bitwarden.session":
    "セッションキーはメモリーにのみ保持されます。保管庫を 8 時間使わなかった場合や OpenBot を終了した場合は、もう一度接続してください。切断すると OpenBot のアクセスは停止しますが、他の Bitwarden クライアントはロックされません。",
  "connector.bitwarden.sessionKey": "Bitwarden のセッションキー",
  "connector.bitwarden.connect": "Bitwarden を接続",
  "connector.bitwarden.disconnect": "Bitwarden を切断",
  "connector.bitwarden.connected": "接続済み",
  "connector.bitwarden.disconnected": "未接続",
  "connector.bitwarden.failed": "Bitwarden に接続できませんでした。",
} as const satisfies PartialTranslation<typeof source>;
