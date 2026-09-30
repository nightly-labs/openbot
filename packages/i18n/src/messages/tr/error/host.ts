import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {} as const satisfies PartialTranslation<typeof source>;
