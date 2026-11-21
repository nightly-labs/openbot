### Fixed

- Stop now ends a Claude agent's turn that shows "working" while Claude no longer runs it. Before, Stop did
  nothing in this state: the agent stayed "working" for hours, and its new messages stayed in the queue
  until OpenBot restarted. Now the turn ends as stopped, and the queued messages start. When the agent runs
  on a joined server, the server must also be on this version.
