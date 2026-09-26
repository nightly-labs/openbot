import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/format";

export const messages = {
  "format.list.pair": "{first} et {second}",
  "format.list.last": "{items} et {last}",
  "format.list.separator": ", ",
  "format.fileSize.bytes": "{size} o",
  "format.fileSize.kilobytes": "{size} Ko",
  "format.fileSize.megabytes": "{size} Mo",
  "format.fileSize.gigabytes": "{size} Go",
  "format.fileSize.terabytes": "{size} To",
} as const satisfies PartialTranslation<typeof source>;
