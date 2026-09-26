import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal が ICE サーバーを提供していません。",
  "error.host.webRtcNotConfigured": "WebRTC ホストサービスが設定されていません。",
  "error.host.runtimeNotInstalled": "リモートデスクトップのランタイムがインストールされていません。",
  "error.host.setupUnavailable": "権限の設定を利用できません。",
  "error.host.accountChangedDuringUpdate": "このサーバーの更新中に、サインイン中のアカウントが変わりました。",
  "error.host.nameBeforePublish": "公開する前に、この OpenBot に名前を付けてください。",
  "error.host.memberNotFound": "リモートメンバーが存在しません。",
  "error.host.publishBeforeInvite": "招待を作成する前に、この OpenBot を公開してください。",
  "error.host.teamAccessUnavailable": "チームへのアクセスを利用できません。",
  "error.host.ownerIdentityUnavailable": "ホストのオーナーの ID を利用できません。",
  "error.host.reserveAddressFailed": "公開アドレスを予約できませんでした。",
  "error.host.publishFailed": "この OpenBot を公開できませんでした。",
  "error.host.mobileConnectPublishFailed": "この OpenBot を Mobile Connect 用に公開できませんでした。",
  "error.host.mobileConnectHostChanged": "Mobile Connect のホストが変わりました。再試行してください。",
  "error.host.noServer": "このコンピューターには変更できるサーバーがありません。",
  "error.host.identityLocalOnly": "サーバーの名前とロゴは、サーバーを実行しているコンピューターでのみ変更できます。",
  "error.host.maintenanceInterrupted":
    "ホストのメンテナンスが中断されました。再試行する前に、アプリケーションを確認し、ホストの状態をリセットしてください。",
  "error.host.updateFailed":
    "{phase} の間にホストの更新に失敗しました。状態をリセットする前に、バンドルの所有者、署名、テナントの状態、ディスクの空き容量を確認してください。",
  "error.host.tenantsNotIdle": "2 時間以内に、テナントが 5 分間アイドル状態を維持しませんでした。",
  "error.host.tenantShutdownTimeout":
    "テナントの停止がタイムアウトしました。アプリケーションの置き換えは開始されていません。",
  "error.host.tenantHealthMissing":
    "再起動後のテナントの正常性レポートがないか、異常です。次の更新の前に、テナントのセッションを確認してください。",
} as const satisfies PartialTranslation<typeof source>;
