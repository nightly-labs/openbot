import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot を起動できませんでした",
  "startup.failedBody":
    "{message}\n\nお使いのデータは初期化も上書きもされていません。復旧の手順はトラブルシューティングガイドをご覧ください。",
} as const satisfies PartialTranslation<typeof source>;
