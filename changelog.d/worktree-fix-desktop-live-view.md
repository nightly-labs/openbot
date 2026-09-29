### Fixed

- In the desktop app, the live view of a remote host's browser now ends cleanly when the host sends a frame that it cannot show. Before, this caused a main-process error, and the live view did not stop.
- The desktop app no longer shows a main-process error when the event connection to a remote server fails.
- The desktop app now releases the host's live view session when it cannot open the view. Before, the session stayed open on the host and counted against its limit.
