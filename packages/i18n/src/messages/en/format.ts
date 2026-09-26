import { defineMessages } from "../../message";

/**
 * Words `createFormat` needs where the runtime has no `Intl` API for them. The file sizes use the
 * binary units the attachment cards already show.
 */
export const messages = defineMessages("format", {
  "format.list.pair": "{first} and {second}",
  "format.list.last": "{items}, and {last}",
  "format.list.separator": ", ",
  "format.fileSize.bytes": "{size} B",
  "format.fileSize.kilobytes": "{size} KB",
  "format.fileSize.megabytes": "{size} MB",
  "format.fileSize.gigabytes": "{size} GB",
  "format.fileSize.terabytes": "{size} TB",
});
