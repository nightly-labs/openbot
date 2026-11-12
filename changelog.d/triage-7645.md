### Fixed

- A server counts file cache that it often reads as free memory. Before, a server with a small plan
  could show "This server is low on memory", refuse new browser tabs and hold scheduled runs, while
  the system showed enough available memory.
