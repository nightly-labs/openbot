### Fixed

- Pi agents on Windows can run commands again when Git for Windows is not installed. Before, each
  command failed with a message about installing Linux for WSL. The agent now uses PowerShell when
  this computer has no bash that works. On a joined server, the server must also be on this version.
