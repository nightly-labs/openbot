### Fixed

- On Windows, you can now delete an agent that used OpenCode. Before, the delete failed with "The
  agent data could not be removed completely" each time, and the agent came back, until you restarted
  OpenBot. If a reply of another OpenCode agent is in progress, try the delete again after the reply
  ends. On a server, the server must also be on the new version.
