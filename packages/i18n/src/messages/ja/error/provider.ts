import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
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
  "error.provider.metadataHttp": "ランタイムのメタデータのダウンロードが HTTP {status} で失敗しました。",
  "error.provider.metadataIntegrity": "ランタイムのメタデータが整合性チェックに失敗しました。",
  "error.provider.diskSpace": "このプロバイダーに必要な空きディスク容量が足りません。",
  "error.provider.unexpectedVersion": "プロバイダーのランタイムが予期しないバージョンを返しました。",
  "error.provider.metadataNoData": "ランタイムのメタデータのダウンロードでデータが返されませんでした。",
  "error.provider.metadataTooLarge": "ランタイムのメタデータが大きすぎます。",
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
  "error.provider.codexOutdated": "Codex CLI {version} は古すぎます。OpenBot には 0.144.1 以降が必要です。",
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
  "error.provider.opencodeServiceFailure":
    "OpenCode のローカルサービスが失敗したため、このターンを完了できませんでした。もう一度お試しください。エラーが続く場合は、設定で OpenCode を再接続してください。",
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
  "error.provider.foreignReasoning":
    "別のアカウントまたは API キーが受け取ったため、{provider} はこのチャットの以前の推論を受け付けませんでした。OpenBot はチャット履歴を引き継いだ新しい {provider} セッションを開始しました。もう一度お試しください。",
  "error.provider.grokSignIn": "Grok を使うには `grok login` を実行するか、XAI_API_KEY を設定してください。",
  "error.provider.acpSignInTimedOut": "サインインがタイムアウトしました。",
  "error.provider.acpSignInStopped": "サインインが完了する前に停止しました。",
  "error.provider.acpSignInFailed": "サインインが完了しませんでした。",
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
} as const satisfies PartialTranslation<typeof source>;
