### Fixed

- Keep the iPhone Live Activity up to date while several agents run. Before, each change of state
  used the limit that iOS has for urgent updates, so a request or a reply could show late or not at
  all. Now only a new request, a new failure, a new reply and an agent that finishes its work are
  urgent. The server must also be on the new version.
