### Fixed

- When you select Compact context and a Pi agent has nothing new to compact, the compaction now
  completes. Before, each Pi agent showed "Nothing to compact (session too small)" or "Already
  compacted" as an error, and after the second try OpenBot said that two compactions failed and
  stopped automatic compaction. On a joined server, the server must also be on the new version.
