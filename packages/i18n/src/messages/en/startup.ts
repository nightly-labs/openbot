import { defineMessages } from "../../message";

export const messages = defineMessages("startup", {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot couldn’t start",
  "startup.failedBody":
    "{message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.",
  // Shown while OpenBot runs, when another program changed `app.asar`: the next start would fail with no message.
  "startup.archiveChangedTitle": "OpenBot files were changed",
  "startup.archiveChangedBody":
    "Another program changed the OpenBot file app.asar. OpenBot runs now, but it will not open after you quit it.\n\nTo repair OpenBot, install it again. Your local data stays.",
  "startup.archiveChangedDownload": "Download OpenBot",
});
