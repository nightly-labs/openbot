### Fixed

- The connection status no longer shows a retry time that does not move while the app tries to reconnect. Before, it showed for example `Reconnecting · 1/5 · 0:03` for the whole attempt. Now it shows only the attempt number, and the countdown starts when the app waits for the next try.
