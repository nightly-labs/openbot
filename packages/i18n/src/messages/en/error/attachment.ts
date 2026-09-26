import { defineMessages } from "../../../message";

export const messages = defineMessages("error.attachment", {
  // Attachment and file preview errors.
  "error.attachment.notFound": "Attachment was not found.",
  "error.attachment.fileTooLarge": "A file exceeds the 100 MB limit.",
  "error.attachment.totalTooLarge": "Attachments exceed the 250 MB total limit.",
  "error.attachment.unavailable": "This file is no longer available.",
  "error.attachment.tooMany": "Choose at most {limit} files.",
  "error.attachment.mediaUnsupported":
    "This server does not support MP3 or MOV attachments. Update OpenBot on the host and retry.",
  "error.attachment.emlUnsupported":
    "This server does not support EML attachments. Update OpenBot on the host and retry.",
  "error.attachment.previewTooLarge": "The file exceeds the 100 MB limit.",
});
