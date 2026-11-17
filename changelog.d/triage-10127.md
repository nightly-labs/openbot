### Fixed

- In the browser, an agent can select all text with Ctrl+A and copy it with Ctrl+C. Before, these
  shortcuts did nothing on Windows and Linux, but the agent was told that they worked. The first key
  that an agent presses on a page that just opened also arrives now. Before, the page sometimes lost
  it. For an agent on a joined server, the server must also be on the new version.
