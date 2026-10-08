import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {} as const satisfies PartialTranslation<typeof source>;
