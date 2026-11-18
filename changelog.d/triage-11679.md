### Fixed

- An OpenCode agent on a custom model that reads only text no longer fails each message with
  "is not a multimodal model" after a screenshot gets into the chat. OpenBot now starts a new
  session and sends the message again. When the model refuses again, OpenBot says that the model
  cannot read the image, and the next message works.
