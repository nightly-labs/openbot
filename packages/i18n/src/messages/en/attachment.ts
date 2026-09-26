import { defineMessages } from "../../message";

export const messages = defineMessages("attachment", {
  "attachment.downloadAll.pending": "Downloading ZIP…",
  "attachment.downloadAll.label": "Download all as ZIP",
  "attachment.downloadAll.count": { one: "{count} attachment", other: "{count} attachments" },
  "attachment.downloadAll.zipping": "Zipping",
  "attachment.openFile": "Open file",
  "attachment.preview": "Preview {name}",
  "attachment.notFound": "File not found",
  "attachment.download": "Download {name}",
  "attachment.open": "Open {name}",
  "attachment.previewUnavailable": "Preview is unavailable.",
  "attachment.error.preview": "Could not preview {name}. Try again.",
  "attachment.error.download": "Could not download attachments. Try again.",
  "attachment.error.open": "Could not open or save this attachment. Try again.",
  "attachment.error.openFile": "Could not open this file. Try again.",
  "attachment.error.fileFallback": "File",
  "attachment.error.fileNotFound":
    "“{name}” was not found. Ask the agent to create or restore the file, then click the link again.",
  "attachment.error.previewFile": "Could not preview “{name}”. Try again.",
});
