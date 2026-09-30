import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {} as const satisfies PartialTranslation<typeof source>;
