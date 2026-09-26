import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/format";

export const messages = {
  "format.list.pair": "{first}と{second}",
  "format.list.last": "{items}、{last}",
  "format.list.separator": "、",
} as const satisfies PartialTranslation<typeof source>;
