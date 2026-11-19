### Fixed

- A scheduled, script or webhook routine run that ended with nothing to report, and with no text
  from the agent, did not keep the steps that the agent did. The chat showed only "Completed
  routine", with nothing to open, and the agent could not read these steps later. Now the run keeps
  its steps: open the run in the chat on the computer or in the browser to see them. The run stays
  closed and sends no notification, as before. For a joined server, the server must also be on the
  new version.
