import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

// Not translated yet: the screen shows the English text.
export const messages = {} as const satisfies PartialTranslation<typeof source>;
