### Fixed

- An approval card from a Grok agent's background helper now stays open until you answer it. Before,
  when the agent gave its task to a helper that runs in the background, the agent's turn ended at
  once and the card closed by itself in less than a second. The helper then reported that you
  cancelled, and the change did not run. Now the agent shows as working while the card waits, and
  Allow, Decline and Stop work as usual. On a joined server, the server must also be on this
  version.
