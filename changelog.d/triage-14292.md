### Fixed

- When the model provider of an OpenCode agent blocked a message because of its safety rules, the
  chat showed "RequestError: Internal error: …" or only "refusal", with no next step. The chat now
  says that the provider blocked the message, and tells you to send it again with different words,
  or to start a new chat or choose another model.
