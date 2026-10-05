### Fixed

- Signing out, disconnecting or quitting now ends a file download that is still waiting. Before, the
  download waited for its full 60 s timeout and its timer kept OpenBot from closing.
