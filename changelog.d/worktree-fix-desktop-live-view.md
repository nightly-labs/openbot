### Fixed

- In the desktop app, the live view of a remote host's browser now ends cleanly when the host sends a frame that it cannot show. Before, this caused a main-process error, and the live view did not stop.
- The live view of a remote host's browser now ends when its connection closes abnormally. Before, the view could stay open with no new frames, and on the host the end of a live view could also stop a remote desktop session that was running at the same time.
- The desktop app now releases the host's live view session when it cannot open the view. Before, the session stayed open on the host and counted against its limit.
