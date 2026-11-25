import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/extension";

export const messages = {
  "extension.home.settings": "Ayarlar",
} as const satisfies PartialTranslation<typeof source>;
