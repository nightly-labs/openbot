### Fixed

- A Gemini chat no longer stops with "UNAUTHENTICATED (code 401)" when the Google sign-in token
  expires during a turn. When the turn did no work yet, OpenBot sends the message again once, and
  Gemini continues with its new token. When Google refuses the sign-in again, the chat says to send
  the message again or to reconnect Gemini in Settings. For an agent on a joined server, the server
  must also be on the new version.
