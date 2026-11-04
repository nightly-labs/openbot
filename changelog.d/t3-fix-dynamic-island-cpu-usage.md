### Fixed

- The Dynamic Island uses much less processor time when nothing changes. Before, the greeting motion
  and the logo blink made it draw on every screen refresh, all day. Now the greeting moves only while
  the pointer is on the island, and the logo draws only while it blinks.
