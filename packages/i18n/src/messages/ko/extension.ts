import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/extension";

export const messages = {
  "extension.home.settings": "설정",
} as const satisfies PartialTranslation<typeof source>;
