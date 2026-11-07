import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/format";

export const messages = {
  "format.list.pair": "{first} و {second}",
  "format.list.last": "{items} و {last}",
  "format.list.separator": "، ",
  "format.fileSize.bytes": "{size} بایت",
  "format.fileSize.kilobytes": "{size} کیلوبایت",
  "format.fileSize.megabytes": "{size} مگابایت",
  "format.fileSize.gigabytes": "{size} گیگابایت",
  "format.fileSize.terabytes": "{size} ترابایت",
} as const satisfies PartialTranslation<typeof source>;
