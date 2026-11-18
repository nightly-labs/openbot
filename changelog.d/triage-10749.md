### Fixed

- Give an OpenCode agent its OpenBot tools again when OpenCode did not load them in time. Before,
  when OpenBot's tools did not connect in 30 seconds, for example on a busy server, OpenCode
  continued without them. Then each chat of that agent's folder could not message teammates or use
  other OpenBot tools until all of its chats closed, sometimes for hours. Now OpenBot opens the chat
  again at once, and OpenCode loads the tools. For an agent on a joined server, the server must also
  be on the new version.
