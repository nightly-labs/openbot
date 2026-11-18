### Fixed

- Move a WhatsApp or other external chat message to the agent's automatic backup model when the
  main model fails before it starts work, as a message in the agent's own chat does. Before, the
  message failed with the provider error, for example a spent credit balance, and the person in the
  chat got no answer. On a joined server, the server must also be on this version.
