### Fixed

- A chat that a compaction left at 70% to 79% of the context window compacted again after each
  turn, without end and without a notice. One chat compacted 25 times in 27 minutes. Now, after 2
  such compactions in a row, OpenBot stops automatic compactions of that chat and shows the notice.
  "Compact now" still works.
