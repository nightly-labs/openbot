### Fixed

- A ChatGPT agent no longer compacts its context again and again without progress. Before, when
  each compaction left the chat too full, ChatGPT compacted after every step, and one chat compacted
  559 times until OpenBot restarted. Now OpenBot stops the turn after the third such compaction and
  says what to change. On a joined server, the server must also be on this version.
