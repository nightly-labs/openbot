import { defineMessages } from "../../message";

export const messages = defineMessages("preview", {
  "preview.panel.label": "File preview",
  "preview.panel.resize": "Resize file preview",
  "preview.panel.openExternally": "Open file externally",
  "preview.panel.download": "Download file",
  "preview.panel.reveal": "Show file in Finder",
  "preview.panel.close": "Close file preview",
  "preview.truncated": "Preview truncated after {limit} characters.",
  "preview.unavailable": "Preview unavailable.",
  "preview.unsupported.title": "Preview unavailable",
  "preview.unsupported.description": "This file type can be opened in its default application.",
  "preview.unsupported.openExternally": "Open externally",
  "preview.spreadsheet.readFailed": "Could not read this spreadsheet.",
  "preview.spreadsheet.truncated": "Preview limited to the first {rows} rows and {columns} columns.",
});
