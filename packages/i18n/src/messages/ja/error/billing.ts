import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "サーバーのプランを変更できませんでした。「お支払い」を更新して、もう一度お試しください。",
  "error.billing.confirmMismatch": "削除するにはサーバー名を入力してください。",
  // Billing errors.
  "error.billing.invalidRequest": "お支払いのリクエストが無効です。",
  "error.billing.invalidResponse": "お支払いの応答が無効です。",
  "error.billing.notStripePage": "お支払いページが Stripe のページではありません。",
} as const satisfies PartialTranslation<typeof source>;
