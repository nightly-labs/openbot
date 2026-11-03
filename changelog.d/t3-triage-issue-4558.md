### Fixed

- Stop the "The generated profile is too large" error in channels and chats. Before, the long
  reasoning of an OpenCode or Claude model counted as answer text when OpenBot summarized a channel
  or chose who answers, and the message then failed (#4558).
