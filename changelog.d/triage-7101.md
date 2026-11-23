### Fixed

- The trace of an agent turn showed a "Tokens" total that included cache reads. Each model call reads
  the saved conversation again, so a short task could show more than a million tokens. "Tokens" now
  counts only the new tokens, as the Usage tab does, and "Cached input" shows the cache reads. The
  cost does not change. Turns from before this version show the total as before.
