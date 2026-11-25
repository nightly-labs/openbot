### Fixed

- On a Mac or Linux computer, a Gemini sign-in that the browser cannot send back to OpenBot can now
  finish. Before, when Safari opened the last sign-in page as a secure page and showed an error,
  OpenBot waited for 10 minutes and then showed only "The sign-in timed out." Now, while the
  sign-in waits, Gemini shows "Paste the address": paste the address that the browser shows, and
  Gemini connects with no second sign-in.
