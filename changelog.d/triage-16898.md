### Fixed

- A custom agent such as Doubao now answers again in the same chat after OpenBot stops one of its turns because it stopped responding or repeated the same step. Before, each later message in that chat failed with "The session is busy." until you quit OpenBot. Now the message waits while the agent finishes the stopped turn, then the agent answers in the same chat with its context kept. On a joined server, the server must also be on this version.
