### Fixed

- The plan usage that windows, browser tabs and phones show is now read at most once every four minutes for each provider sign-in, however many of them are open. Before, each of them read it again, so a provider such as Claude could refuse more reads for a long time.
- When a usage read fails, for example because the provider limits requests, OpenBot keeps the last reading and waits longer before it tries again: 5 minutes, then 10, 20 and 40, up to one hour. Before, the reading disappeared and OpenBot tried again every 5 minutes.
