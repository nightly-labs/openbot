### Fixed

- An agent's browser step no longer fails with "Session with given id not found." when the page
  adds or removes a frame, for example an ad or a sign-in frame, while it loads. Before, a wait or
  a click right after a navigation could fail, and the agent had to take a new snapshot and try again.
  For an agent on a joined server, the server must also be on the new version.
