import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "この OpenBot を WebRTC アクセス用に登録しました。",
  "status.host.keyRotated": "サーバーキーを変更しました。ペアリング済みのデバイスはそのままです。",
  "status.host.identityUpdated": "サーバーの ID を更新しました。",
  "status.host.starting": "WebRTC ホストを起動しています…",
  "status.host.ready": "この OpenBot は WebRTC 接続の準備ができています。",
  "status.host.signalLost": "現在、ほかのデバイスからこの OpenBot に接続できません。再接続しています。",
  "status.host.stopping": "この OpenBot を非公開にしています…",
  "status.host.private": "この OpenBot は非公開です。",
  "status.host.removed": "この OpenBot はアカウントから削除されました。共有するには、もう一度公開してください。",
} as const satisfies PartialTranslation<typeof source>;
