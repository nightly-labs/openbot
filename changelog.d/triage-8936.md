### Fixed

- A Grok agent answers again after its workspace moves, for example after a move to a new server
  with a different home folder. Before, each message failed with "Path not found.: No such file or
  directory (os error 2)". Now, when Grok does not have the saved session in the new folder, the agent
  starts a new Grok session and keeps its chat.
