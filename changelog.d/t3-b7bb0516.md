### Changed

- A Grok Bot or Hermes Agent export that you import on this computer has no size limit, and it can
  have up to 200,000 files. Before, the limit was 2 GB and 50,000 files. OpenBot now reads the file
  from disk one file at a time, so a large export does not use memory, and it reads ZIP64 files,
  which zip tools make for files over 4 GB. An agent whose workspace files need more free disk
  space than the computer has is skipped, with a message that names both sizes. A damaged file in
  the export is skipped with a warning, and the agent still imports. An import into a joined server
  still accepts a file of 100 MB or less.
