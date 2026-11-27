### Changed

- On a joined server, a reaction, mark read, mark unread and a routine switch now show at once. Before,
  each one waited for the server, about half a second on a normal connection. If the server refuses
  the change, the old value comes back.
- On a joined server, a channel opens about 200 ms sooner, and sending a channel command, editing a
  CRM cell, and cancelling, steering or moving a queued message show at once.
- A workflow canvas on a joined server no longer reads the whole workflow again after each save. A
  save that fails is tried again.
- On a joined server, the desktop and web clients now keep the agents, channels, pins, routines,
  workflows, CRM customers, queued messages and the newest chat and channel messages up to date by
  themselves. The server sends only what changed, not the full list or page again after each
  change. A channel renamed on the server shows about 200 ms sooner. The server must also be on the
  new version; with an older server, the clients read the data as before.
