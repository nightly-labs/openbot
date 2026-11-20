### Fixed

- A channel no longer shows "Request failed." with `http/500/team_api_error` after somebody deleted
  its newest message or its history. Before, an app that still showed the older messages could not
  mark the channel as read, and the error stayed on the screen. On a joined server, the server must
  also be on this version.
