### Fixed

- Custom agents: an agent that needs more than 30 s to start, such as Qoder CLI on Windows, now shows
  its models when its start ends. Before, the model list showed "request timed out: model/list" and
  the agent's models never appeared. While a custom agent starts, the model lists of other providers
  no longer wait for it. On a joined server, the server must also be on the new version.
