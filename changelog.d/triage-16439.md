### Fixed

- When a model refuses a chat again because of too many images, the chat now says that a new session does not help, and tells you to start a new chat and ask the agent to open fewer images in each step, or to select a model that accepts more images. Before, each message failed with the same "Try again" text, and trying again could not help. On a joined server, the server must also be on this version.
