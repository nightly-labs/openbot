import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "ダウンロードを停止しました。もう一度お試しください。",
  "status.provider.downloadFailed": "ダウンロードに失敗しました。もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
