import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot は Codex の設定に MCP サーバーを登録できませんでした。Codex の config.toml が有効で書き込み可能であることを確認してから、OpenBot を再起動してください。",
  "error.provider.computerUseConfig":
    "OpenBot は Codex の設定に Computer Use を登録できませんでした。Codex の config.toml が有効で書き込み可能であることを確認してから、OpenBot を再起動してください。Computer Use なしで続行するには、チームメイトの設定で Computer Use をオフにできます。",
  "error.provider.endpointsReadOnly":
    "保存されたエンドポイントは新しいバージョンの OpenBot で書き込まれたか、ファイルを読み取れません。変更するには OpenBot を更新してください。",
  "error.provider.endpointNoSecureStorage":
    "このコンピューターには安全なストレージがないため、API キーやヘッダーを保存できません。それらを削除するか、認証情報が不要なエンドポイントを使用してください。",
  "error.provider.endpointDuplicate":
    "このプロバイダー ID のエンドポイントはすでに保存されています。先に削除するか、別の ID を使用してください。",
  "error.provider.endpointNotSaved": "このエンドポイントは保存されていません。一覧を更新して、もう一度お試しください。",
  "error.provider.endpointKeyForNewAddress":
    "アドレスのホストまたはポートが変わりました。保存済みの API キーとヘッダーが新しいアドレスに送られないように、もう一度入力してください。",
  "error.provider.endpointSecretUnreadable":
    "このコンピューターは保存済みの API キーとヘッダーを読み取れません。失われないように、API キーとヘッダーをもう一度入力してください。",
  "error.provider.discoveryTimeout": "{host} から時間内に応答がありませんでした。",
  "error.provider.discoveryUnreachable": "OpenBot は {host} に接続できませんでした。",
  "error.provider.discoveryRedirect":
    "{host} がリダイレクトを返しました。サーバーの最終的なアドレスを入力してください。",
  "error.provider.discoveryRefused": "{host} がリクエストを拒否しました。API キーとヘッダーを確認してください。",
  "error.provider.discoveryHttp": "{host} が HTTP {status} で応答しました。",
  "error.provider.discoveryTooLarge": "{host} のモデル一覧が大きすぎます。",
  "error.provider.discoveryInvalid": "{host} は OpenAI 互換のモデル一覧を返しませんでした。",
  "error.provider.detectionSettingsReadOnly":
    "検出の設定は新しいバージョンの OpenBot で書き込まれたか、ファイルを読み取れません。変更するには OpenBot を更新してください。",
  "error.provider.detectionEntryInvalid":
    "アドレスはパスワードを含まない http:// または https:// の URL に、フォルダーは絶対パスにしてください。",
  "error.provider.detectionEntriesTooMany": "アドレスまたはフォルダーが多すぎます。",
  "error.provider.credentialFileUnreadable": "プロバイダーの認証情報ファイルを読み取れません。",
  "error.provider.credentialFileTooLarge": "プロバイダーの認証情報ファイルが大きすぎます。",
  "error.provider.archiveSpecialFile": "ランタイムのアーカイブにリンクまたは特殊ファイルが含まれています。",
  "error.provider.archiveUnsafePath": "ランタイムのアーカイブに安全でないパスが含まれています。",
  "error.provider.runtimeSpecialFile": "ランタイムにリンクまたは特殊ファイルが含まれています。",
  "error.provider.codexArchivePath": "Codex のアーカイブに予期しないパスがあります。",
  "error.provider.codexVersionUnexpected": "Codex ランタイムのバージョンが予期しないものです。",
  "error.provider.claudeArchivePath": "Claude のアーカイブに予期しないパスがあります。",
  "error.provider.claudePackageMismatch": "Claude パッケージがランタイムカタログと一致しません。",
  "error.provider.claudeChecksum": "Claude ランタイムのチェックサムが一致しません。",
  "error.provider.claudeLicenseChecksum": "Claude ライセンスのチェックサムが一致しません。",
  "error.provider.opencodeArchivePath": "OpenCode のアーカイブに予期しないパスがあります。",
  "error.provider.opencodePackageMismatch": "OpenCode パッケージがランタイムカタログと一致しません。",
  "error.provider.opencodeChecksum": "OpenCode ランタイムのチェックサムが一致しません。",
  "error.provider.opencodeLicenseChecksum": "OpenCode ライセンスのチェックサムが一致しません。",
  "error.provider.grokChecksum": "Grok ランタイムのチェックサムが一致しません。",
  "error.provider.grokLicenseChecksum": "Grok ライセンスのチェックサムが一致しません。",
  "error.provider.grokNoticesChecksum": "Grok 通知ファイルのチェックサムが一致しません。",
  "error.provider.bunArchivePath": "Bun のアーカイブに予期しないパスがあります。",
  "error.provider.bunPackageMismatch": "Bun パッケージがランタイムカタログと一致しません。",
  "error.provider.bunChecksum": "Bun ランタイムのチェックサムが一致しません。",
  "error.provider.bunLicenseChecksum": "Bun ライセンスのチェックサムが一致しません。",
  "error.provider.bunxDamaged": "Bun パッケージマネージャーの実行ツールが見つからないか、破損しています。",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot はプロバイダーのリリース元に接続できませんでした。接続を確認して、もう一度お試しください。",
  "error.provider.runtimesUnsupported": "このプラットフォームではプロバイダーのランタイムを使用できません。",
  "error.provider.closing": "OpenBot を終了しています。",
  "error.provider.cliOverride": "OpenBot で更新する前に、明示的な CLI パスの指定を削除してください。",
  "error.provider.runtimeUpdateIncomplete": "ランタイムの更新が完了しませんでした。",
  "error.provider.downloadHttp": "ランタイムのダウンロードが HTTP {status} で失敗しました。",
  "error.provider.downloadNoData": "ランタイムのダウンロードでデータが返されませんでした。",
  "error.provider.downloadSize": "ランタイムのダウンロードのサイズが予期しないものです。",
  "error.provider.downloadIntegrity": "ランタイムのダウンロードが整合性チェックに失敗しました。",
  "error.provider.runtimeReplacing": "別のインスタンスがランタイムを置き換えているため、インストールできませんでした。",
  "error.provider.runtimeFilesInUse":
    "別のプログラムがランタイムのファイルを開いているため、インストールできませんでした。そのプログラムを閉じてから、もう一度お試しください。",
  "error.provider.metadataHttp": "ランタイムのメタデータのダウンロードが HTTP {status} で失敗しました。",
  "error.provider.metadataIntegrity": "ランタイムのメタデータが整合性チェックに失敗しました。",
  "error.provider.diskSpace": "このプロバイダーに必要な空きディスク容量が足りません。",
  "error.provider.unexpectedVersion": "プロバイダーのランタイムが予期しないバージョンを返しました。",
  "error.provider.metadataNoData": "ランタイムのメタデータのダウンロードでデータが返されませんでした。",
  "error.provider.metadataTooLarge": "ランタイムのメタデータが大きすぎます。",
  "error.provider.requestFailed": "OpenBot は {url} をダウンロードできませんでした。{reason}",
  "error.provider.installRecordMismatch": "ランタイムのインストール記録が一致しません。",
  "error.provider.runtimeChecksum": "プロバイダーのランタイムのチェックサムが一致しません。",
  "error.provider.codexReleaseShape": "Codex のリリース情報の形式が予期しないものです。",
  "error.provider.codexReleaseNoDownload":
    "Codex のリリースには、このコンピューター向けの検証可能なダウンロードがありません。",
  "error.provider.claudeReleaseShape": "Claude のリリース情報の形式が予期しないものです。",
  "error.provider.grokReleaseVersion": "Grok のリリースのバージョンが予期しないものです。",
  "error.provider.blockedListShape": "ブロックされたバージョンのリストの形式が予期しないものです。",
  "error.provider.releaseNoDownload": "{name} のリリースには検証可能なダウンロードがありません。",
  "error.provider.releaseSizeUnknown": "リリースのダウンロードのサイズが不明です。",
  "error.provider.releaseMetadataNotObject": "リリースのメタデータが JSON オブジェクトではありません。",
  "error.provider.releaseCheckHttp": "リリースの確認が HTTP {status} で失敗しました。",
  "error.provider.releaseMetadataTooLarge": "リリースのメタデータが大きすぎます。",
  "error.provider.idInvalid": "プロバイダー ID には英小文字、数字、`-`、`_` のみを使用してください。",
  "error.provider.baseUrlInvalid": "ベース URL が URL ではありません。",
  "error.provider.baseUrlProtocol": "ベース URL は http:// または https:// で始める必要があります。",
  "error.provider.baseUrlCredentials":
    "ベース URL にユーザー名やパスワードを含めないでください。認証情報はヘッダーに入れてください。",
  "error.provider.modelsRequired": "モデルが 1 つ以上必要です。",
  "error.provider.modelsTooMany": "モデルが多すぎます。",
  "error.provider.modelIdCharacter": "モデル ID に使用できない文字が含まれています。",
  "error.provider.modelIdDuplicate": "2 つのモデルの ID が同じです。",
  "error.provider.headersTooMany": "ヘッダーが多すぎます。",
  "error.provider.headerNameCharacter": "ヘッダー名に HTTP で使用できない文字が含まれています。",
  "error.provider.headerNameTooLong": "ヘッダー名が長すぎます。",
  "error.provider.headerNameDuplicate": "2 つのヘッダーの名前が同じです。",
  "error.provider.headerValueInvalid": "ヘッダーの値がないか、長すぎます。",
  "error.provider.apiKeyTooLong": "API キーが長すぎます。",
  "error.provider.localOnly": "プロバイダーは、エージェントを実行しているコンピューターでのみ変更できます。",
  "error.provider.keyRequired": "プロバイダーキーが必要です。",
  "error.provider.keyTooLong": "プロバイダーキーが長すぎます。",
  "error.provider.noModel": "選択したプロバイダーに使用できるモデルがありません。",
  "error.provider.noModelNamed": "{provider} に使用できるモデルがありません。",
  "error.provider.acpNoModels": "ACP CLI が ACP モデルを通知しませんでした。OpenBot は代替モデルを推測しません。",
  "error.provider.endpointRemoveBusy":
    "このエンドポイントを削除する前に、実行中のターンとキューが終わるまでお待ちください。",
  "error.provider.codexOutdated": "Codex CLI {version} は古すぎます。OpenBot には 0.156.0 以降が必要です。",
  "error.provider.codexNotStarted": "Codex CLI は見つかりましたが、起動できませんでした。",
  "error.provider.codexNotStartedHint":
    "Codex CLI は見つかりましたが、起動できませんでした。新しいターミナルで `codex --version` を実行してください。",
  "error.provider.codexMissing":
    "ChatGPT はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.codexConfigIgnored": {
    other:
      "Codex は設定ファイルの {count} 件の設定を無視しました: {settings}。設定を修正または削除するか、Codex を更新してください。",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    other:
      "Codex は設定ファイルの {count} 件の設定を無視しました。設定を修正または削除するか、Codex を更新してください。",
  },
  "error.provider.claudeOutdated": "Claude Code {version} は古すぎます。OpenBot には 2.1.232 以降が必要です。",
  "error.provider.claudeNotStarted": "Claude CLI は見つかりましたが、起動できませんでした。",
  "error.provider.claudeNotStartedHint":
    "Claude CLI は見つかりましたが、起動できませんでした。新しいターミナルで `claude --version` を実行してください。",
  "error.provider.claudeMissing":
    "Claude はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.grokOutdated": "Grok CLI {version} は古すぎます。OpenBot には 1.0.5 以降が必要です。",
  "error.provider.grokNotStarted": "Grok CLI は見つかりましたが、起動できませんでした。",
  "error.provider.grokNotStartedHint":
    "Grok CLI は見つかりましたが、起動できませんでした。新しいターミナルで `grok --version` を実行してください。",
  "error.provider.grokMissing": "Grok はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.opencodeNotStarted":
    "OpenCode を起動できませんでした。ターミナルで `opencode --version` を実行してください。",
  "error.provider.opencodeMissing":
    "OpenCode はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.codexVersionUnreadable": "Codex CLI のバージョンを読み取れません。",
  "error.provider.claudeVersionUnreadable": "Claude CLI のバージョンを読み取れません。",
  "error.provider.grokVersionUnreadable": "Grok CLI のバージョンを読み取れません。",
  "error.provider.opencodeVersionUnreadable": "OpenCode CLI のバージョンを読み取れません。",
  "error.provider.bunVersionUnreadable": "Bun ランタイムのバージョンを読み取れません。",
  "error.provider.connectBeforeProfile": "プロフィールを生成する前に、選択したプロバイダーに接続してください。",
  "error.provider.cliNotReady": "{provider} CLI の準備ができていないか、サインインしていません。",
  "error.provider.cliTimedOut":
    "{provider} が時間内に応答しませんでした。コンピューターの負荷が高い可能性があります。OpenBot が再試行します。",
  "error.provider.cliTimedOutRefresh":
    "{provider} が時間内に応答しませんでした。コンピューターの負荷が高い可能性があります。プロバイダーを更新して再試行してください。",
  "error.provider.noCodeSignIn": "{provider} にはコードでサインインできません。",
  "error.provider.codeLoginNoLink": "プロバイダーがサインインのリンクを表示しませんでした。もう一度お試しください。",
  "error.provider.codeLoginNotWaiting": "コードを待っているサインインはありません。サインインをやり直してください。",
  "error.provider.codeLoginBadCode": "サインインページに表示されたコードを貼り付けてください。",
  "error.provider.codeLoginRefused": "プロバイダーがコードを受け付けませんでした。サインインをやり直してください。",
  "error.provider.codeLoginUnsupported":
    "このサーバーでは、貼り付けたコードでサインインできません。サーバーのコンピューターのブラウザーでサインインしてください。",
  "error.provider.cliBusyRetry": "{provider} CLI はターンを処理中です。終わるまで待ってから、もう一度お試しください。",
  "error.provider.cliSigningIn":
    "{provider} CLI はサインイン中です。サインインを完了するかキャンセルしてから更新してください。",
  "error.provider.cliBusyUpdate": "{provider} CLI はターンを処理中です。終わるまで待ってから更新してください。",
  "error.provider.cliSelectFailed": "OpenBot はインストール済みの管理対象 CLI を選択できませんでした。",
  "error.provider.noAuthenticatedAccount": "{provider} は認証済みのアカウントを返しませんでした。",
  "error.provider.cliActivateFailed": "OpenBot は管理対象 CLI を有効にできませんでした。",
  "error.provider.cliBusyReconnect": "{provider} CLI はターンを処理中です。終わるまで待ってから再接続してください。",
  "error.provider.opencodeCredentialsRejected":
    "モデルプロバイダーが API キーを拒否しました。設定で OpenCode のキーを修正するか、`opencode auth login` でプロバイダーのキーを修正してください。その後、もう一度お試しいただくか、別のモデルを選択してください。\n{detail}",
  "error.provider.opencodeServiceFailure":
    "OpenCode のローカルサービスが失敗したため、このターンを完了できませんでした。もう一度お試しください。エラーが続く場合は、設定で OpenCode を再接続してください。",
  "error.provider.opencodeRateLimited":
    "モデルプロバイダーがレート制限のためリクエストを拒否しました。数分待つか別のモデルを選んでから、もう一度お試しください。\n{detail}",
  "error.provider.opencodeBilling":
    "モデルプロバイダーがアカウントの請求の問題のためリクエストを拒否しました。待っても解決しません。プロバイダーのアカウントに支払い方法または残高を追加するか、別のモデルを選んでください。\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "OpenCode のモデルプロバイダーが無効なアップロードリクエストを報告しました。別のモデルを選択して続行してください。ルーティンをもう一度作成する前に、保存済みのルーティンを確認してください。\n{detail}",
  "error.provider.opencodeProviderFailed":
    "モデルプロバイダー側で障害が発生しました。お使いの接続は原因ではありません。後でもう一度試すか、別のモデルを選んでください。\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode がモデルプロバイダーに接続できませんでした。OpenBot を実行しているコンピューターのネットワーク接続を確認してから、もう一度お試しください。\n{detail}",
  "error.provider.chatgptPageFailed": "OpenBot は ChatGPT の接続ページを開けませんでした。",
  "error.provider.noneReady": "準備ができているエージェントのプロバイダーがありません。",
  "error.provider.claudeTurnActive": "コンテキストを更新する前に、実行中の Claude のターンが終わるまでお待ちください。",
  "error.provider.codexLoginRequired":
    "Codex には ChatGPT サブスクリプションでのログインが必要です。`codex login` を実行してください。",
  "error.provider.cliUpdateFailed": "OpenBot は {provider} CLI を更新できませんでした。{reason}",
  "error.provider.tryAgain": "もう一度お試しください。",
  "error.provider.noAgentProcess": "{provider} には、このエージェント用に実行中のプロセスがありません。",
  "error.provider.stoppedBeforeAgentProcess": "エージェントのプロセスが開始する前に {provider} が停止しました。",
  "error.provider.archiveUnreadable": "ランタイムのアーカイブを読み取れないか、対応していない形式です。",
  "error.provider.antigravityArchivePath": "Gemini のアーカイブに予期しないファイルがあります。",
  "error.provider.antigravityChecksum": "Gemini ランタイムのチェックサムが一致しません。",
  "error.provider.antigravityReleaseShape": "Gemini のリリースの形式が予期しないものです。",
  "error.provider.antigravityMissing":
    "Gemini はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.antigravityNotStarted": "Gemini サーバーは見つかりましたが、バージョンを読み取れません。",
  "error.provider.antigravityVersionUnreadable": "Gemini サーバーのバージョンを読み取れません。",
  "error.provider.antigravitySignIn": "Gemini を使うには Google でサインインしてください。",
  "error.provider.antigravityRateLimited":
    "レート制限またはプランの割り当てに達したため、Gemini がリクエストを拒否しました。数分待つか別のモデルを選んでから、もう一度お試しください。\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini は現在このモデルを使用できません。別のモデルを選んでから、もう一度お試しください。\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Google の Gemini サービスがリクエストを完了しませんでした。数分後にもう一度お試しください。\n{detail}",
  "error.provider.cursorArchivePath": "Cursor のアーカイブに予期しないファイルがあります。",
  "error.provider.cursorChecksum": "Cursor ランタイムのチェックサムが一致しません。",
  "error.provider.cursorReleaseShape": "Cursor のリリースの形式が予期しないものです。",
  "error.provider.cursorMissing":
    "Cursor はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.cursorNotStarted": "Cursor エージェントは見つかりましたが、バージョンを読み取れません。",
  "error.provider.cursorVersionUnreadable": "Cursor エージェントのバージョンを読み取れません。",
  "error.provider.cursorSignIn": "Cursor を使うには Cursor でサインインするか、CURSOR_API_KEY を設定してください。",
  "error.provider.clineArchivePath": "Cline のアーカイブに予期しないパスがあります。",
  "error.provider.clinePackageMismatch": "Cline のパッケージがランタイムカタログと一致しません。",
  "error.provider.clineChecksum": "Cline ランタイムのチェックサムが一致しません。",
  "error.provider.clineLicenseChecksum": "Cline のライセンスのチェックサムが一致しません。",
  "error.provider.clineMissing": "Cline はダウンロードされていません。続けるには OpenBot でダウンロードしてください。",
  "error.provider.clineOutdated": "Cline CLI {version} は古すぎます。OpenBot には 3.0.68 以降が必要です。",
  "error.provider.clineNotStarted": "Cline を起動できませんでした。ターミナルで `cline --version` を実行してください。",
  "error.provider.clineVersionUnreadable": "Cline CLI のバージョンを読み取れません。",
  "error.provider.clineSignIn": "Cline を使うには Cline でサインインするか、CLINE_API_KEY を設定してください。",
  "error.provider.usageLimitReached": "アカウントが使用量の上限に達しました。",
  "error.provider.foreignReasoning":
    "別のアカウントまたは API キーが受け取ったため、{provider} はこのチャットの以前の推論を受け付けませんでした。OpenBot はチャット履歴を引き継いだ新しい {provider} セッションを開始しました。もう一度お試しください。",
  "error.provider.grokSignIn": "Grok を使うには `grok login` を実行するか、XAI_API_KEY を設定してください。",
  "error.provider.acpSignInTimedOut": "サインインがタイムアウトしました。",
  "error.provider.acpSignInStopped": "サインインが完了する前に停止しました。",
  "error.provider.geminiBrowserUnavailable":
    "Gemini はサインインページを開けませんでした。ブラウザーと xdg-utils をインストールしてから、このホストのデスクトップセッションで接続してください。デスクトップのないサーバーではこのサインインを完了できません。",
  "error.provider.acpSignInFailed": "サインインが完了しませんでした。",
  "error.provider.messageTooLarge":
    "{limit} MB を超えるメッセージを送信したため、OpenBot は {provider} を停止しました。",
  "error.provider.customAgentIdInvalid":
    "エージェント ID には英小文字、数字、`-` のみを使用してください。組み込みプロバイダーの ID は使用できません。",
  "error.provider.customAgentEnvInvalid":
    "変数名には英字、数字、`_` のみを使用し、数字で始めないでください。各名前は 1 回だけ、最大 16 個まで使用できます。",
  "error.provider.customAgentCommandInvalid":
    "コマンドは完全なパス、~/ で始まるパス、またはスペースを含まないコマンド名にしてください。",
  "error.provider.customAgentArgsInvalid": "引数に改行は使用できません。引数は最大 32 個までです。",
  "error.provider.customAgentWindowsScript":
    ".cmd または .bat のコマンドの引数には、英字、数字、および - _ . , : = @ + / \\ のみを使用できます。",
  "error.provider.customAgentNotFound":
    "OpenBot は {command} を見つけられません。コマンドの完全なパスを入力してください。",
  "error.provider.customAgentCheckTimedOut": "エージェントは 20 秒以内に応答しませんでした。",
  "error.provider.customAgentCheckStopped": "エージェントは応答する前に停止しました。",
  "error.provider.customAgentProtocolVersion":
    "このエージェントは ACP バージョン {version} を使用しています。OpenBot はバージョン 1 を使用します。",
  "error.provider.customAgentCheckFailed": "エージェントは ACP エージェントとして応答しませんでした。",
  "error.provider.customAgentRemoveBusy":
    "このカスタムエージェントを削除する前に、実行中のターンとキューが終わるまでお待ちください。",
  "error.provider.customAgentNone": "保存されたカスタムエージェントはありません。",
  "error.provider.customAgentMissing": "このカスタムエージェントは現在保存されていません。別のモデルを選んでください。",
  "error.provider.customAgentSignIn": "エージェント自身のコマンドでサインインしてから、もう一度お試しください。",
  "error.provider.customAgentsReadOnly":
    "保存されたカスタムエージェントは新しいバージョンの OpenBot で書き込まれたか、ファイルを読み取れません。変更するには OpenBot を更新してください。",
  "error.provider.customAgentNoSecureStorage":
    "このコンピューターには安全なストレージがないため、環境変数の値を保存できません。値を削除して、もう一度お試しください。",
  "error.provider.customAgentNotSaved":
    "このカスタムエージェントは保存されていません。一覧を更新して、もう一度お試しください。",
  "error.provider.customAgentTooMany": "保存できるカスタムエージェントは最大 {count} 個です。",
  "error.provider.customAgentEnvValueMissing": "{name} の値を入力してください。",
  "error.provider.off": "{provider} は OpenBot でオフになっています。まずプロバイダーの設定でオンにしてください。",
  "error.provider.inUse":
    "エージェントが {provider} を使用しています。このプロバイダーをオフにする前に、そのエージェントのモデルを変更してください。",
  "error.provider.useBusy": "プロバイダーの確認またはサインインが終わるまで待ってから、もう一度お試しください。",
  "error.provider.useSettingsReadOnly":
    "保存されたプロバイダーの設定を読み取れません。変更する前に OpenBot を更新してください。",
  "error.provider.useChangeFailed": "OpenBot はプロバイダーの設定を変更できませんでした。",
  "error.provider.sessionSettingUnavailable": "この設定は現在のプロバイダーセッションでは利用できません。",
  "error.provider.sessionSettingInvalid": "この値はこの設定では利用できません。",
  "error.provider.sessionSettingsBusy": "セッションの設定を変更する前に、現在のターンが終わるまでお待ちください。",
  "error.provider.piOutdated":
    "Pi {version} は古すぎます。ネイティブ RPC と MCP に対応するには、Pi 1.1.0 以降をインストールしてください。",
  "error.provider.nativeMissing": "{provider} CLI がインストールされていません。設定でダウンロードしてください。",
  "error.provider.nativeNotStarted": "{provider} CLI を起動できませんでした。",
  "error.provider.nativeVersionUnreadable": "{provider} CLI のバージョンを読み取れませんでした。",
  "error.provider.piSessionBusy": "現在の Pi のターンが終わるまでお待ちください。",
  "error.provider.piStopped": "Pi が実行されていません。Pi を接続してもう一度お試しください。",
  "error.provider.piSessionMissing": "Pi のセッションファイルがこのコンピューターにありません。",
  "error.provider.piResumeCancelled": "Pi がセッションの再開をキャンセルしました。もう一度お試しください。",
  "error.provider.piSessionIdentity": "Pi が別のセッションを返しました。保存されたセッションは置き換えられていません。",
  "error.provider.piModelInvalid": "プロバイダーを含む Pi のモデルを選択してください。",
  "error.provider.piToolInvalid": "ツールが無効な結果を返しました。",
  "error.provider.piSignIn":
    "ホストコンピューターの Pi で /login を使用してください。サインインが完了したら Pi を閉じてください。",
  "error.provider.museBusy": "Muse のセッションはビジー状態です。",
  "error.provider.museStopped": "Muse クライアントが実行されていません。",
  "error.provider.museUnexpectedProvider": "Muse が予期しないモデルプロバイダーを返しました。",
  "error.provider.museNoActiveTurn": "Muse には方向を修正できる実行中のターンがありません。",
  "error.provider.museInvalidProtocol": "Muse が無効なプロトコル応答を返しました。",
  "error.provider.museNotStarted": "Muse が起動しませんでした。",
  "error.provider.museNativeWindows": "Windows では Muse にネイティブの実行ファイルが必要です。",
  "error.provider.museStartTimeout": "Muse の初期化がタイムアウトしました。",
  "error.provider.museStartStopped": "Muse が初期化中に停止しました。",
  "error.provider.museProtocolVersion": "この Muse のプロトコルバージョンには対応していません。",
  "error.provider.museHistoryRequired": "Muse はセッション履歴を保持する必要があります。",
  "error.provider.museRequestUnsupported": "この Muse サーバーのリクエストには対応していません。",
  "error.provider.museConnectionFailed":
    "Muse への接続に失敗しました。保存された履歴を復元するには、会話を再開してください。",
  "error.provider.museUnknownSession": "不明な Muse セッションです。",
  "error.provider.museInvalidToolResult": "OpenBot ツールの結果が無効です。",
  "error.provider.museMcpRequired": "Muse はセッションの MCP サーバーに対応している必要があります。",
  "error.provider.museSessionMismatch": "Muse が別のセッションを返しました。",
  "error.provider.museCompactRejected": "Muse が圧縮を受け付けませんでした。",
  "error.provider.museTurnMismatch": "Muse が別のターンを返しました。",
  "error.provider.museHistoryMismatch": "Muse の履歴が複数のセッションにまたがっています。",
  "error.provider.museRecoveryFailed": "Muse は欠落したイベントを復元できませんでした。",
  "error.provider.museHistoryStalled": "Muse の履歴カーソルが進みませんでした。",
  "error.provider.museApprovalUnavailable": "Muse はこの承認の応答を提示していません。",
  "error.provider.museHistoryOwner": "Muse の履歴は別のセッションのものです。",
  "error.provider.museHistoryMissing": "Muse がセッション履歴を返しませんでした。",
  "error.provider.museEmptyInput": "Muse にはテキストまたは画像が必要です。",
  "error.provider.museMethodUnsupported": "Muse は {method} に対応していません。",
  "error.provider.museTurnFailed": "Muse のターンに失敗しました。",
  "error.provider.museProfileUnsupported":
    "Muse は外部ツールにアクセスできないため、プロフィールを生成できません。別のプロバイダーでプロフィールを生成してから、エージェントに Muse を選択してください。",
  "error.provider.museAuthUnverified":
    "Muse の認証が確認されていません。ホストコンピューターで接続するか、Meta API キーを設定してください。",
  "error.provider.museSignIn": "続行するには、ホストコンピューターで Muse にサインインしてください。",
  "error.provider.terminalLoginFailed":
    "サインイン用のターミナルを開けませんでした。このホストでプロバイダーの CLI を開いてサインインしてから、プロバイダーを更新してください。",
  "error.provider.nativeArchiveInvalid": "プロバイダーのダウンロードに有効なインストールが含まれていません。",
  "error.provider.nativeChecksum": "プロバイダーのインストールが整合性チェックに合格しませんでした。",
  "error.provider.registryUnavailable": "ACP レジストリを利用できません。もう一度お試しください。",
  "error.provider.registryInvalid": "ACP レジストリが無効なデータを返しました。",
  "error.provider.registryMissing": "このエージェントは ACP レジストリにありません。",
  "error.provider.registryBusy": "このエージェントのインストールはすでに進行中です。",
  "error.provider.registryCancelled": "エージェントのインストールがキャンセルされました。",
  "error.provider.registryPrerequisite":
    "このエージェントをインストールする前に、ホストに {tool} をインストールしてください。",
  "error.provider.registryBindingChanged":
    "インストール中にカスタムエージェントが変更されました。もう一度お試しください。",
  "error.provider.registryInstallFailed":
    "エージェントのインストールに失敗しました。以前のインストールは変更されていません。",
  "error.provider.registryRemoveBusy":
    "削除する前に、エージェントのインストールと実行中の ACP の作業が終わるまでお待ちください。",
} as const satisfies PartialTranslation<typeof source>;
