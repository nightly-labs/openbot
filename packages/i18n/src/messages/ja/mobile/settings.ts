import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/settings";

export const messages = {
  "mobile.settings.saveFailed": "この設定を保存できませんでした。もう一度お試しください。",
  "mobile.settings.language.title": "言語",
  "mobile.settings.language.row": "アプリの言語",
  "mobile.settings.language.system": "システムの設定",
  "mobile.settings.language.footer":
    "「システムの設定」は、スマートフォンの設定で最初に表示される言語に従います。まだ翻訳されていないテキストは英語で表示されます。",
  "mobile.settings.dictation.language": "音声入力の言語",
} as const satisfies PartialTranslation<typeof source>;
