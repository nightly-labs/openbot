### Fixed

- Start a turn on the Pi provider when the developer instructions are long. Before, the turn failed
  with `Pi process closed (1)` on Windows, because the launch line passed the 8191-character limit
  of `cmd.exe`. The instructions now go to Pi in a file.
