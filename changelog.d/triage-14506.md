### Fixed

- Pi agents now work with Pi extensions from your own Pi setup that keep their first session.
  Before, OpenBot changed Pi to the chat's session after Pi started, so such an extension stopped
  Pi with "This extension ctx is stale" at each message, and the chat showed "Pi stopped
  unexpectedly before it finished this turn". Now Pi starts directly on the chat's session. On a
  joined server, the server must also be on the new version.
