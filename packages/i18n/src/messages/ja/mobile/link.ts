import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot は接続できませんでした。もう一度お試しください。",
  "mobile.link.invite.signIn": "この招待を確認するには、デスクトップでサインインしてください。",
  "mobile.link.invite.cancel": "招待をキャンセル",
  "mobile.link.pairing.title": "このスマートフォンを接続",
  "mobile.link.pairing.alreadySignedIn":
    "すでにサインインしています。別のアカウントを接続する前に、設定でサインアウトしてください。",
  "mobile.link.pairing.description": "この Mobile Connect リンクをデスクトップから要求した場合にのみ続行してください。",
  "mobile.link.pairing.connect": "接続",
  "mobile.link.plugin.title": "プラグインのページを開く",
  "mobile.link.plugin.description": "このプラグインを OpenBot の Web サイトで表示します。",
  "mobile.link.plugin.openFailed": "プラグインのページを開けませんでした。",
  "mobile.link.plugin.view": "プラグインを表示",
  "mobile.link.unavailable.title": "リンクを使用できません",
  "mobile.link.unavailable.description": "このリンクは無効か、利用できなくなったか、モバイルでサポートされていません。",
} as const satisfies PartialTranslation<typeof source>;
