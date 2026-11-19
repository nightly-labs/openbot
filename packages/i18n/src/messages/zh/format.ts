import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/format";

export const messages = {
  "format.list.pair": "{first}和{second}",
  "format.list.last": "{items}和{last}",
  "format.list.separator": "、",
  "format.fileSize.bytes": "{size} B",
  "format.fileSize.kilobytes": "{size} KB",
  "format.fileSize.megabytes": "{size} MB",
  "format.fileSize.gigabytes": "{size} GB",
  "format.fileSize.terabytes": "{size} TB",
} as const satisfies PartialTranslation<typeof source>;
