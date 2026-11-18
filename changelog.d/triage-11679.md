### Fixed

- An OpenCode agent on a custom model that reads only text no longer fails each message with
  "is not a multimodal model" after a screenshot gets into the chat. OpenBot now says that the model
  cannot read the image and starts a new session, so the next message works.
