import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/island";

export const messages = {} as const satisfies PartialTranslation<typeof source>;
