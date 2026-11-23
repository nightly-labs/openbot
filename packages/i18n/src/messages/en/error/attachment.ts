import { defineMessages } from "../../../message";

export const messages = defineMessages("error.attachment", {
  "error.attachment.notFound": "Attachment was not found.",
  "error.attachment.fileTooLarge": "A file exceeds the 100 MB limit.",
  "error.attachment.namedFileTooLarge": "{name} is larger than the 100 MB limit.",
  "error.attachment.emptyFile": "{name} is empty or OpenBot cannot read it. Save the file again, then attach it again.",
  "error.attachment.totalTooLarge": "Attachments exceed the 250 MB total limit.",
  "error.attachment.unavailable": "This file is no longer available.",
  "error.attachment.noApp":
    "No app on this computer opened this file. Download it, then open it from your file manager.",
  "error.attachment.tooMany": "Choose at most {limit} files.",
  "error.attachment.mediaUnsupported":
    "This server does not support MP3 or MOV attachments. Update OpenBot on the host and retry.",
  "error.attachment.emlUnsupported":
    "This server does not support EML attachments. Update OpenBot on the host and retry.",
  "error.attachment.zipUnsupported":
    "This server does not support ZIP attachments. Update OpenBot on the host and retry.",
  "error.attachment.mp4Unsupported":
    "This server does not support MP4 attachments. Update OpenBot on the host and retry.",
  "error.attachment.svgUnsupported":
    "This server does not support SVG attachments. Update OpenBot on the host and retry.",
  "error.attachment.previewTooLarge": "The file exceeds the 100 MB limit.",
});
