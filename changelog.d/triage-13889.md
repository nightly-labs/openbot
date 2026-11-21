### Fixed

- A Pi agent recovers when a chat becomes too long for the model, for example after many images.
  OpenBot starts a new Pi session with the chat history and tells you to try again. Before, each new
  message sent the same chat again and failed with "prompt is too long".
