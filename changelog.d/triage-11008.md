### Fixed

- Answer a message that you send with "Send now" to a custom ACP agent, such as CodeBuddy. Before, some
  agents cancelled the new message as part of the stop, and the chat showed no reply and no error.
  OpenBot now sends the message again once. When the agent cancels it again, the chat tells you to
  send the message again. On a joined server, the server must also be on this version.
