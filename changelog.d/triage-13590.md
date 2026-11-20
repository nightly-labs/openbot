### Fixed

- On Windows, OpenCode agents often failed to run commands with "opencode-pty request timed out".
  OpenCode 2.3.0 to 2.3.2 cause this, so OpenBot no longer installs these versions. When OpenBot's
  OpenCode copy already runs one of them, OpenBot now goes back by itself to the newest OpenCode that
  is not blocked (2.2.5 today), and the commands run again. An OpenCode that you installed yourself
  does not change. On a joined server, the server must also be on the new version.
