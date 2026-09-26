import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "権限の設定は macOS で利用できます。",
  "status.remote.setupInstallHost":
    "リモートデスクトップのホストコンポーネントをインストールしてから、もう一度確認してください。",
  "status.remote.setupUpdateRuntime":
    "macOS の権限を確認するには、リモートデスクトップのランタイムを更新してください。",
  "status.remote.setupCheckFailed":
    "Sunshine が権限の確認を完了できませんでした。ホストのセッションを確認してから、再試行してください。",
  "status.remote.setupServiceFailed":
    "リモートデスクトップのサービスを起動できませんでした。この macOS ユーザーに有効な GUI セッションがあることを確認してください。",
  "status.remote.connectingSunshine": "Sunshine 経由で接続しています…",
  "status.remote.switchingMonitor": "共有するモニターを切り替えています…",
  "status.remote.controlConnected": "リモート操作に接続しました。",
  "status.remote.controlFailed": "リモート操作に失敗しました。",
  "status.remote.stagePreferences": "ローカルのチャット設定を読み込んでいます: {reason}",
  "status.remote.stageConnection": "デスクトップに接続しています: {reason}",
  "status.remote.stageCompatibility": "デスクトップの互換性を確認しています: {reason}",
  "status.remote.stageAgents": "エージェントを読み込んでいます: {reason}",
  "status.remote.stageReads": "既読状態を読み込んでいます: {reason}",
  "status.remote.stageConversations": "会話を読み込んでいます: {reason}",
  "status.remote.suspendedDetail":
    "接続する前に、OpenBot Mobile またはデスクトップアプリを更新してください。\n{detail}",
  "status.remote.cooldownDetail":
    "{limit} 回の試行後に接続に失敗しました。{minutes}:{seconds} 後に再試行します。\n{detail}",
  "status.remote.cooldown": "{limit} 回の試行後に接続に失敗しました。{minutes}:{seconds} 後に再試行します。",
  "status.remote.connectionLostDetail": { other: "接続が切れました。{count} 秒後に再試行します。\n{detail}" },
  "status.remote.connectionLost": { other: "接続が切れました。{count} 秒後に再試行します。" },
  "status.remote.attemptFailedDetail": { other: "接続の試行に失敗しました。{count} 秒後に再試行します。\n{detail}" },
  "status.remote.attemptFailed": { other: "接続の試行に失敗しました。{count} 秒後に再試行します。" },
  "status.remote.reconnectingDetail": { other: "再接続しています {attempt}/{count}\n{detail}" },
  "status.remote.reconnecting": { other: "再接続しています {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
