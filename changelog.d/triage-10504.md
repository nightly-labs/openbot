### Fixed

- When Windows could not write to the OpenBot database for a moment while an agent wrote a reply,
  OpenBot showed a "JavaScript error in the main process" window with "disk I/O error". Now OpenBot
  keeps the reply text and saves it again a moment later, and no error window opens.
