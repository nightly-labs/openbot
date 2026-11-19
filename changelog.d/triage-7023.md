### Fixed

- Say why a joined server does not delete an agent in the web client. Before, when the agent was busy
  or another delete of it was in progress, the web client showed only "The server could not complete
  this request. Refresh before trying again." Now it says to stop the agent and cancel its queued
  messages first, or that the delete is already in progress. The server must also be on this version.
