### Fixed

- A Claude agent that ended its turn with no answer to your message in its own chat, for example
  after it opened a screenshot that you sent, no longer leaves a blank reply with no reason. When
  the agent did some steps, a notice now says that the turn ended with no answer, and asks you to
  check what the agent did before you send the same request again. The work of the turn is kept,
  and the turn does not run again. When the agent did nothing, the chat says that Claude ended the
  turn with no answer, and a backup model takes the message when the agent has one. In a channel,
  the task shows the channel's no-answer text. A turn that started background work and waits for it
  gets no notice. On a joined server, the server must also be on this version.
