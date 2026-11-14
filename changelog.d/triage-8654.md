### Fixed

- When a Kimi model in OpenCode could not read a PDF that the agent opened, each later message in
  that chat failed with "contains an invalid part type: file". Now OpenBot starts a new OpenCode
  session with the chat history and tells you to send the message again without the file, or to
  choose a model that can read files.
