import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/format";

export const messages = {
  "format.list.pair": "{first} и {second}",
  "format.list.last": "{items} и {last}",
  "format.list.separator": ", ",
  "format.fileSize.bytes": "{size} Б",
  "format.fileSize.kilobytes": "{size} КБ",
  "format.fileSize.megabytes": "{size} МБ",
  "format.fileSize.gigabytes": "{size} ГБ",
  "format.fileSize.terabytes": "{size} ТБ",
} as const satisfies PartialTranslation<typeof source>;
