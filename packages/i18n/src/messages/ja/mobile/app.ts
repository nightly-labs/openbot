import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/app";

export const messages = {
  "mobile.app.route.scanQrCode": "QRコードをスキャン",
  "mobile.app.route.actionsNeeded": "必要な操作",
  "mobile.app.route.newChannel": "新しいチャンネル",
  "mobile.app.route.createAgent": "エージェントを作成",
  "mobile.app.route.newSection": "新しいセクション",
  "mobile.app.route.settings": "設定",
  "mobile.app.route.profile": "プロフィール",
  "mobile.app.route.general": "一般",
  "mobile.app.route.accountSessions": "アカウントのセッション",
  "mobile.app.route.about": "情報",
  "mobile.app.route.hiddenChats": "非表示のチャット",
  "mobile.app.route.deletedChannels": "削除したチャンネル",
  "mobile.app.route.cropPhoto": "移動と拡大縮小",
  "mobile.app.route.queuedMessages": "待機中のメッセージ",
  "mobile.app.route.messageOptions": "メッセージのオプション",
  "mobile.app.route.editMessage": "メッセージを編集",
  "mobile.app.route.serverOptions": "サーバーのオプション",
  "mobile.app.route.members": "メンバー",
  "mobile.app.route.message": "メッセージ",
  "mobile.app.messageActions.reply": "返信",
  "mobile.app.messageActions.selectText": "テキストを選択",
  "mobile.app.messageActions.copied": "メッセージをコピーしました",
  "mobile.app.messageActions.copy": "メッセージをコピー",
  "mobile.app.messageActions.text": "メッセージのテキスト",
} as const satisfies PartialTranslation<typeof source>;
