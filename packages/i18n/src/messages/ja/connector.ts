import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Marketplace > Apps > GitHub: the built-in GitHub connection.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "このコンピューターのすべてのエージェントが、GitHub のリポジトリ、Issue、プルリクエスト、gh と git を使えます。",
  "connector.github.connect": "GitHub を接続",
  "connector.github.pendingTitle": "このコードを GitHub に入力してください",
  "connector.github.pendingDescription":
    "ブラウザーで GitHub が開きました。接続するには、そこにコードを入力してください。",
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
    other: "リポジトリ {count} 件 · このコンピューターのすべてのエージェント",
  },
  "connector.github.done": "完了",
  "connector.github.later": "後で",
  "connector.github.disconnectConfirmTitle": "GitHub を切断しますか？",
  "connector.github.disconnectConfirmDescription":
    "切断すると、@{login} のサインイン情報がこのコンピューターから削除されます。",
  "connector.github.disconnectEffectTools": "すべてのエージェントが GitHub のツール、gh、git を使えなくなります。",
  "connector.github.disconnectEffectRevoke": "その後 GitHub が開き、OpenBot のアクセスを取り消せます。",
  "connector.github.disconnectEffectKept": "チャット、ファイル、エージェントのメモリーはこのコンピューターに残ります。",
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "{host} のすべてのエージェントが、GitHub のリポジトリ、Issue、プルリクエスト、gh と git を使えます。",
  "connector.github.connectedSummaryHost": {
    other: "リポジトリ {count} 件 · {host} のすべてのエージェント",
  },
  "connector.github.disconnectConfirmDescriptionHost":
    "切断すると、@{login} のサインイン情報が {host} から削除されます。",
  "connector.github.disconnectEffectKeptHost": "チャット、ファイル、エージェントのメモリーは {host} に残ります。",
  "connector.github.keepConnected": "接続を維持",
  "connector.github.close": "閉じる",
  "connector.dangerZone": "危険な操作",
  "connector.statusUnknown": "不明",
  "connector.readFailed": "OpenBot はこの接続の状態を読み取れませんでした。",

  // Marketplace > Apps > Slack.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Slack で @OpenBot をメンションするか、ダイレクトメッセージを送ります。Slack Orchestrator が適切なエージェントに依頼して回答します。",
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
  "connector.slack.disconnectAllTitle": "Slack を切断",
  "connector.slack.disconnectAllSummary":
    "すべてのワークスペースが切断されます。@OpenBot からエージェントに連絡できなくなります。",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "すべてのワークスペースが切断されます。Slack Orchestrator とその会話は OpenBot から削除されます。",
  "connector.slack.missingScopes":
    "OpenBot には Slack で次の権限がありません: {scopes}。ワークスペースを切断してから、もう一度接続してください。",
  "connector.slack.retryAt": "Slack から待機するよう求められました。{time} に再試行します。",
  "connector.slack.reconnect": "再接続",
  "connector.slack.pause": "一時停止",
  "connector.slack.resume": "再開",
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Slack Orchestrator",
  "connector.slack.orchestratorDescription":
    "このエージェントは Slack からのすべてのリクエストを受け取ります。短いものには自分で回答し、その他の作業は適切なエージェントに任せて、回答をスレッドに投稿します。",
  "connector.slack.orchestratorNone": "回答するエージェントはまだいません",
  "connector.slack.orchestratorNoneDescription":
    "Slack Orchestrator を追加してください。追加しないと、Slack に回答が届きません。",
  "connector.slack.inviteNote":
    "OpenBot はすべての公開チャンネルと新しいチャンネルに自動で参加します。非公開チャンネルには招待してください: /invite @OpenBot",
  "connector.slack.stepWorkspace": "ワークスペース",
  "connector.slack.stepAgent": "エージェント",
  "connector.slack.connectTitle": "Slack ワークスペースを接続",
  "connector.slack.connectDescription":
    "OpenBot はワークスペースに OpenBot という名前のアプリを 1 つインストールし、そのアプリはすべての公開チャンネルに参加します。",
  "connector.slack.connectStepBrowser": "ブラウザーで Slack が開きます",
  "connector.slack.connectStepAllow": "右上でワークスペースを選び、「許可する」を押します",
  "connector.slack.connectStepReturn": "Slack での操作が終わると、このダイアログが続行します",
  "connector.slack.connectInSlack": "Slack で接続",
  "connector.slack.connectWaiting": "Slack を待っています。ブラウザーでインストールを完了してください。",
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
    "OpenBot は {workspace} での回答を停止し、Slack のトークンをこのコンピューターから削除します。",
  "connector.slack.disconnectDescriptionHost":
    "OpenBot は {workspace} での回答を停止し、Slack のトークンを {host} から削除します。",
  "connector.slack.disconnectEffect":
    "{workspace} のメンバーは、@OpenBot からあなたのエージェントに連絡できなくなります。",
  "connector.slack.removeEffectKept": "会話と Slack Orchestrator は OpenBot に残ります。",
  "connector.slack.removeEffectDeleted": "Slack Orchestrator とその会話は OpenBot から削除されます。",
  "connector.slack.keep": "接続を維持",
  "connector.slack.close": "閉じる",
  "connector.slack.addWorkspace": "ワークスペースを追加",
  "connector.slack.limitReached": {
    other: "接続できるワークスペースは最大 {count} 件です。",
  },
  "connector.slack.summaryMany": {
    other: "ワークスペース {count} 件 · Slack Orchestrator が回答します",
  },

  // Marketplace > Apps > Discord. Always write "Discord server": "server" alone is an
  // OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Discord サーバーのチャンネルで @OpenBot をメンションします。Discord Orchestrator が適切なエージェントに依頼して回答します。",
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
  "connector.discord.disconnectAllTitle": "Discord を切断",
  "connector.discord.disconnectAllSummary":
    "すべてのサーバーが切断されます。@OpenBot からエージェントに連絡できなくなります。",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "すべてのサーバーが切断されます。Discord Orchestrator とその会話は OpenBot から削除されます。",
  "connector.discord.missingScopes":
    "OpenBot には Discord で次の権限がありません: {scopes}。Discord サーバーを切断してから、もう一度接続してください。",
  "connector.discord.retryAt": "Discord から待機するよう求められました。{time} に再試行します。",
  "connector.discord.reconnect": "再接続",
  "connector.discord.pause": "一時停止",
  "connector.discord.resume": "再開",
  "connector.discord.rowAction": "{action}: {name}",
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
  "connector.discord.connectStepBrowser": "ブラウザーで Discord が開きます",
  "connector.discord.connectStepAllow": "サーバーを選び、「認証」を押します",
  "connector.discord.connectStepReturn": "Discord での操作が終わると、このダイアログが続行します",
  "connector.discord.connectInDiscord": "Discord で接続",
  "connector.discord.connectWaiting": "Discord を待っています。ブラウザーで認証を完了してください。",
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
    "OpenBot は {workspace} での回答を停止し、Discord の接続をこのコンピューターから削除します。",
  "connector.discord.disconnectDescriptionHost":
    "OpenBot は {workspace} での回答を停止し、Discord の接続を {host} から削除します。",
  "connector.discord.disconnectEffect":
    "{workspace} のメンバーは、@OpenBot からあなたのエージェントに連絡できなくなります。",
  "connector.discord.removeEffectKept": "会話と Discord Orchestrator は OpenBot に残ります。",
  "connector.discord.removeEffectDeleted": "Discord Orchestrator とその会話は OpenBot から削除されます。",
  "connector.discord.keep": "接続を維持",
  "connector.discord.close": "閉じる",
  "connector.discord.addWorkspace": "Discord サーバーを追加",
  "connector.discord.limitReached": {
    other: "接続できる Discord サーバーは最大 {count} 件です。",
  },
  "connector.discord.summaryMany": {
    other: "Discord サーバー {count} 件 · Discord Orchestrator が回答します",
  },
  "connector.discord.accessTitle": "OpenBot を使える人",
  "connector.discord.accessDescription": "OpenBot はこれらの人にだけ回答します。ほかの人からのメンションは無視します。",
  "connector.discord.accessEveryone": "サーバーの全員",
  "connector.discord.accessEveryoneDescription":
    "OpenBot が見えるチャンネルに投稿できる人なら、誰でもメンションできます。",
  "connector.discord.accessRoles": "{roles} を持つメンバー",
  "connector.discord.accessChoose": "ロールを選択",
  "connector.discord.accessDialogTitle": "{workspace} で OpenBot を使えるのは誰ですか？",
  "connector.discord.accessDialogDescription": "ロールを選択しない場合は、全員が OpenBot をメンションできます。",
  "connector.discord.accessLoading": "ロールを読み込んでいます…",
  "connector.discord.accessLoadFailed": "Discord のロールを読み込めませんでした",
  "connector.discord.accessNoRoles": "このサーバーには選択できるロールがありません。",
  "connector.discord.accessRoleDeleted": "{role}（削除済み）",
  "connector.discord.accessSave": "保存",
  "connector.discord.accessHostUpdate": "ロールを選択するには、{host} の OpenBot を更新してください。",

  // Marketplace > Apps > Telegram.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "OpenBot ボットを Telegram グループに追加するか、ボットとのダイレクトチャットを開きます。Telegram Orchestrator が適切なエージェントに依頼して回答します。",
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
    "このコンピューターでは OpenBot が Telegram のメッセージを受信できません。サインインし、サーバー設定でこのコンピューターに名前を付けて、OpenBot を開いたままにしてください。",
  "connector.telegram.helpRelayUnavailableHost":
    "{host} の OpenBot は Telegram のメッセージを受信できません。{host} でサインインし、サーバー設定でサーバーに名前を付けて、OpenBot を開いたままにしてください。",
  "connector.telegram.helpError": "OpenBot はこのチャットに接続できません。再接続するか、チャットを切断してください。",
  "connector.telegram.retryAt": "Telegram から待機するよう求められました。{time} に再試行します。",
  "connector.telegram.pause": "一時停止",
  "connector.telegram.resume": "再開",
  "connector.telegram.reconnect": "再接続",
  "connector.telegram.disconnectChat": "切断",
  "connector.telegram.disconnectAllTitle": "Telegram を切断",
  "connector.telegram.disconnectAllSummary":
    "すべてのチャットが切断されます。OpenBot ボットからエージェントに連絡できなくなります。",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "すべてのチャットが切断されます。Telegram Orchestrator とその会話は OpenBot から削除されます。",
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkChat": "チャットをリンク",
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
  "connector.telegram.connectStepBrowser": "ブラウザーで Telegram が開きます",
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
  "connector.telegram.leaveDescription": "OpenBot ボットは {chat} から退出し、OpenBot はそこでの回答を停止します。",
  "connector.telegram.disconnectEffect":
    "{chat} のメンバーは、OpenBot ボットからあなたのエージェントに連絡できなくなります。",
  "connector.telegram.removeEffectKept": "会話と Telegram Orchestrator は OpenBot に残ります。",
  "connector.telegram.removeEffectDeleted":
    "これが最後のチャットのため、Telegram Orchestrator とその会話は OpenBot から削除されます。",
  "connector.telegram.keep": "接続を維持",
  "connector.telegram.close": "閉じる",
  // Marketplace > 1Password: a vault that the user shares with OpenBot through a service account.
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "専用の 1Password 保管庫をサービスアカウント経由で OpenBot と共有すると、エージェントが OpenBot のブラウザーでサイトにサインインできます。",
  "connector.onePassword.howItWorks":
    "接続すると、1Password アカウントに「Shared with OpenBot」保管庫と、その保管庫だけを読み取れるサービスアカウントが設定されます。OpenBot はこのコンピューターの自分のブラウザーで保存済みのログイン情報を入力するので、共有されるのはその保管庫に移動した項目だけです。エージェントがパスワードを見ることはありません。",
  "connector.onePassword.connect": "1Password を接続",
  "connector.onePassword.setupTitle": "設定",
  "connector.onePassword.stepCliTitle": "1Password CLI をインストール",
  "connector.onePassword.stepCliChecking": "このコンピューターで 1Password CLI を探しています",
  "connector.onePassword.stepCliInstalling": "1Password から 1Password CLI をダウンロードしています",
  "connector.onePassword.stepCliReady": "バージョン {version} がインストールされています。",
  "connector.onePassword.stepCliMissing":
    "OpenBot は 1Password から専用のフォルダーにダウンロードします。管理者パスワードは不要です。",
  "connector.onePassword.stepCliManual":
    "OpenBot はこのコンピューターにインストールできません。1Password からインストールしてから、このページに戻ってください。",
  "connector.onePassword.installCli": "インストール",
  "connector.onePassword.stepAppTitle": "CLI 連携をオンにする",
  "connector.onePassword.stepAppDescription":
    "1Password アプリで「設定」>「開発者」を開き、「1Password CLI と連携」をオンにしてください。",
  "connector.onePassword.stepAppReady": "1Password アプリで、CLI が共有保管庫を作成できるようになっています。",
  "connector.onePassword.openApp": "1Password を開く",
  "connector.onePassword.openAppFailed": "OpenBot は 1Password を開けませんでした。",
  "connector.onePassword.checkAgain": "再確認",
  "connector.onePassword.stepVaultTitle": "共有保管庫を作成",
  "connector.onePassword.stepVaultDescription":
    "OpenBot は「Shared with OpenBot」保管庫と、それを読み取ることだけができるサービスアカウントを作成します。1Password から承認を求められます。",
  "connector.onePassword.useTokenDescription":
    "これらの手順の代わりに、1Password.com のサービスアカウントのトークンを貼り付けます。",
  "connector.onePassword.useTokenAction": "トークンを使う",
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
  "connector.onePassword.descriptionHost":
    "サービスアカウントを通じて専用の 1Password 保管庫を {host} 上の OpenBot と共有すると、{host} のエージェントがそのブラウザーでサイトにサインインできます。",
  "connector.onePassword.howItWorksHost":
    "{host} はサービスアカウントのトークンで接続します。1Password.com で、OpenBot と共有する保管庫だけを読み取れるサービスアカウントを作成し、そのトークンをここに貼り付けてください。{host} がトークンを確認して保存します。このコンピューターには保存されません。エージェントがパスワードを見ることはありません。",
  "connector.onePassword.disconnectSummaryHost":
    "{host} はトークンを削除します。保管庫とサービスアカウントは 1Password に残ります。不要になった場合は 1Password で削除してください。",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Bitwarden のログイン情報をブラウザーに入力します。",
  "connector.bitwarden.setup":
    "Bitwarden CLI をインストールし、bw login でサインインしてください。Shared with OpenBot という名前のフォルダーを作成し、エージェントに使わせてよいログイン情報だけを入れてください。bw unlock --raw を実行し、表示されたセッションキーを下に貼り付けてください。マスターパスワードは貼り付けないでください。",
  "connector.bitwarden.scope":
    "このコンピューターのすべてのエージェントが、Shared with OpenBot 内の一致するログイン情報を使えます。OpenBot は HTTPS のオリジンが完全に一致する場合にのみ使います。マスターパスワードの再入力が必要な項目や、カスタムの URI 一致ルールがある項目は使いません。",
  "connector.bitwarden.session":
    "セッションキーはメモリーにのみ保持されます。保管庫を 8 時間使わなかった場合や OpenBot を終了した場合は、もう一度接続してください。切断すると OpenBot のアクセスは停止しますが、他の Bitwarden クライアントはロックされません。",
  "connector.bitwarden.sessionKey": "Bitwarden のセッションキー",
  "connector.bitwarden.connect": "Bitwarden を接続",
  "connector.bitwarden.disconnect": "Bitwarden を切断",
  "connector.bitwarden.disconnectAction": "切断",
  "connector.bitwarden.disconnectSummary":
    "OpenBot はセッションキーを破棄します。エージェントは Bitwarden からログインを入力できなくなります。他の Bitwarden クライアントはロック解除されたままです。",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} は API キーとマスターパスワードを削除します。{host} のエージェントは Bitwarden からログインを入力できなくなります。",
  "connector.bitwarden.connected": "接続済み",
  "connector.bitwarden.actionFailed": "OpenBot は Bitwarden の接続を変更できませんでした。",
  "connector.bitwarden.descriptionHost":
    "{host} のブラウザーのログインを Bitwarden または Vaultwarden から入力します。",
  "connector.bitwarden.setupHost":
    "{host} は自分の Bitwarden CLI でサインインします。保管庫に Shared with OpenBot という名前のフォルダーを作成し、エージェントが使ってよいログインだけを入れてください。ウェブ保管庫で 設定 › セキュリティ › キー を開き、API キーを表示します。下にサーバーのアドレス、client_id、client_secret、マスターパスワードを入力してください。",
  "connector.bitwarden.scopeHost":
    "{host} のすべてのエージェントが Shared with OpenBot の一致するログインを使えます。OpenBot は完全に一致する HTTPS オリジンを使います。マスターパスワードの再入力が必要なアイテムや、カスタムの URI 一致ルールを持つアイテムは使いません。",
  "connector.bitwarden.sessionHost":
    "{host} は API キーとマスターパスワードを暗号化して保存し、再起動の後にもう一度ロックを解除できます。このコンピューターには保存しません。切断すると {host} から削除されます。{host} は HTTPS でサーバーのアドレスに接続できる必要があります。",
  "connector.bitwarden.serverUrl": "サーバーのアドレス",
  "connector.bitwarden.folderTitle": "共有フォルダ",
  "connector.bitwarden.folderDescription":
    "エージェントにログイン情報でサインインさせるには、Bitwarden でそのログイン情報をこのフォルダに移動してください。やめるには削除してください。",
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Bitwarden のフォルダー",
  "connector.bitwarden.clientId": "API キーの client_id",
  "connector.bitwarden.clientSecret": "API キーの client_secret",
  "connector.bitwarden.masterPassword": "マスターパスワード",
  "connector.bitwarden.connecting": "接続中",
  "connector.telegramAccount.title": "Telegram アカウント",
  "connector.telegramAccount.description":
    "エージェントがあなたの Telegram のチャットを読み、許可すればあなたとしてメッセージを送信できます。",
  "connector.telegramAccount.descriptionHost":
    "{host} のエージェントがあなたの Telegram のチャットを読み、許可すればあなたとしてメッセージを送信できます。",
  "connector.telegramAccount.statusConnecting": "サインイン中",
  "connector.telegramAccount.statusConnected": "接続済み",
  "connector.telegramAccount.actionFailed": "OpenBot は Telegram アカウントの接続を変更できませんでした。",
  "connector.telegramAccount.disconnectTitle": "Telegram アカウントの接続を解除",
  "connector.telegramAccount.disconnectSummary":
    "OpenBot はこのセッションからサインアウトします。エージェントはメッセージを読むことも送ることもできなくなり、送信はオフになります。",
  "connector.telegramAccount.disconnectSummaryHost":
    "{host} はこのセッションからサインアウトします。{host} のエージェントはメッセージを読むことも送ることもできなくなり、送信はオフになります。",
  "connector.telegramAccount.disconnect": "接続解除",
  "connector.telegramAccount.signInTitle": "サインイン",
  "connector.telegramAccount.howItWorks":
    "OpenBot は Telegram Desktop と同じように、あなた自身の Telegram アカウントにサインインします。セッションはこのコンピューターに暗号化して保存されます。Telegram の「設定 › デバイス」に OpenBot として表示されます。",
  "connector.telegramAccount.howItWorksHost":
    "{host} は Telegram Desktop と同じように、あなた自身の Telegram アカウントにサインインします。セッションは {host} に暗号化して保存されます。Telegram の「設定 › デバイス」に OpenBot として表示されます。",
  "connector.telegramAccount.signInProgress":
    "サインインするには、下の手順を行ってください。キャンセルするとサインインを中止します。",
  "connector.telegramAccount.methodTitle": "サインイン方法",
  "connector.telegramAccount.methodQrDescription": "スマートフォンの Telegram でコードをスキャンします。",
  "connector.telegramAccount.methodPhoneDescription": "電話番号と、Telegram から届くコードを入力します。",
  "connector.telegramAccount.methodQr": "QR コード",
  "connector.telegramAccount.methodPhone": "電話番号",
  "connector.telegramAccount.credentialsTitle": "api_id と api_hash",
  "connector.telegramAccount.credentialsStored":
    "OpenBot は my.telegram.org で作成したあなた自身の Telegram アプリを使います。最初のサインイン後は、このコンピューターがその api_id と api_hash を保持します。",
  "connector.telegramAccount.credentialsStoredHost":
    "OpenBot は my.telegram.org で作成したあなた自身の Telegram アプリを使います。最初のサインイン後は、{host} がその api_id と api_hash を保持します。",
  "connector.telegramAccount.credentialsOpen": "入力",
  "connector.telegramAccount.credentialsHelp":
    "my.telegram.org にサインインし、API development tools を開いてアプリを作成します。その api_id と api_hash をここにコピーしてください。",
  "connector.telegramAccount.apiId": "api_id",
  "connector.telegramAccount.apiHash": "api_hash",
  "connector.telegramAccount.openApps": "my.telegram.org を開く",
  "connector.telegramAccount.openAppsFailed": "OpenBot は my.telegram.org を開けませんでした。",
  "connector.telegramAccount.connect": "接続",
  "connector.telegramAccount.sendingOffNote": "送信をオンにするまで、エージェントはチャットを読むことしかできません。",
  "connector.telegramAccount.devicesNote":
    "Telegram の「設定 › デバイス」に、このセッションが OpenBot として表示されます。そこで終了すると、OpenBot の接続は解除されます。",
  "connector.telegramAccount.devicesNoteHost":
    "Telegram の「設定 › デバイス」に、このセッションが OpenBot として表示されます。そこで終了すると、{host} の接続は解除されます。",
  "connector.telegramAccount.connecting": "Telegram に接続中",
  "connector.telegramAccount.connectingDescription":
    "このコンピューターが Telegram と通信しています。数秒かかることがあります。",
  "connector.telegramAccount.connectingHost": "{host} が Telegram と通信しています。数秒かかることがあります。",
  "connector.telegramAccount.qrLabel": "Telegram にサインインする QR コード",
  "connector.telegramAccount.qrTitle": "スマートフォンの Telegram でこのコードをスキャン",
  "connector.telegramAccount.qrStepOpen": "スマートフォンで Telegram を開きます。",
  "connector.telegramAccount.qrStepDevices": "「設定 › デバイス › デスクトップ端末をリンク」を開きます。",
  "connector.telegramAccount.qrStepScan": "スマートフォンをこのコードに向けます。",
  "connector.telegramAccount.qrRefresh": "コードは約 30 秒ごとに変わります。最新のコードをスキャンしてください。",
  "connector.telegramAccount.usePhone": "電話番号を使う",
  "connector.telegramAccount.phoneDescription": "Telegram アカウントの電話番号を国番号付きで入力してください。",
  "connector.telegramAccount.phoneLabel": "電話番号",
  "connector.telegramAccount.sendCode": "コードを送信",
  "connector.telegramAccount.phonePlaceholder": "+48 600 100 200",
  "connector.telegramAccount.useQr": "QR コードを使う",
  "connector.telegramAccount.codeViaApp": "Telegram が、ほかのデバイスの Telegram アプリにコードを送信しました。",
  "connector.telegramAccount.codeViaSms": "Telegram が SMS でコードを送信しました。",
  "connector.telegramAccount.codeDescription": "Telegram から届いたコードを入力してください。",
  "connector.telegramAccount.codeLabel": "コード",
  "connector.telegramAccount.signIn": "サインイン",
  "connector.telegramAccount.passwordDescription":
    "このアカウントには 2 段階認証が設定されています。そのパスワードを入力してください。",
  "connector.telegramAccount.passwordHint": "ヒント: {hint}",
  "connector.telegramAccount.passwordLabel": "2 段階認証のパスワード",
  "connector.telegramAccount.accountTitle": "アカウント",
  "connector.telegramAccount.accountDescription":
    "このコンピューターのエージェントは、この Telegram アカウントを使います。",
  "connector.telegramAccount.accountDescriptionHost": "{host} のエージェントは、この Telegram アカウントを使います。",
  "connector.telegramAccount.sendingLabel": "エージェントにメッセージの送信とチャットの既読化を許可",
  "connector.telegramAccount.sendingDescription": "オフの場合、エージェントはチャットを読むことしかできません。",
} as const satisfies PartialTranslation<typeof source>;
