### Fixed

- After the Hermes gateway restarts, Hermes agents answer again. Before, with Hermes Agent 0.22.0 or
  earlier, each message failed with "Internal error: Gateway disconnected; turn outcome is unknown"
  until you restarted OpenBot. OpenBot now ends that Hermes process, so your next message starts a
  new one. The chat now says in plain words that Hermes lost its connection, and tells you to check
  the agent's work before you send the message again. On a joined server, the server must also be on
  the new version.
