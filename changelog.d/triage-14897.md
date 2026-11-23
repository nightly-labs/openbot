### Fixed

- An OpenRouter, DeepSeek, Inception or Pi agent that ended its turn with no answer no longer shows a
  completed turn with a blank reply and no reason. This happened, for example, when a model sent
  only its reasoning. When the agent did nothing, the chat now says that the provider ended the turn
  with no answer, and a backup model takes the message when the agent has one. When the agent did
  some steps, a notice asks you to check what the agent did before you send the same request again.
  In a channel, the task shows the channel's no-answer text. On a joined server, the server must
  also be on this version.
