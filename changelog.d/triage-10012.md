### Fixed

- An OpenCode agent on a Z.ai GLM model that reads only text no longer fails each message with
  "messages.content.type is invalid" after an image gets into the chat. OpenBot now says that the
  model cannot read the image and starts a new session, so the next message works.
