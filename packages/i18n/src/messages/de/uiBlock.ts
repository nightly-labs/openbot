import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/uiBlock";

export const messages = {
  "uiBlock.status.waiting": "Wartet auf dich",
  "uiBlock.confirm.autoActionClock": "{action} · {time}",
} as const satisfies PartialTranslation<typeof source>;
