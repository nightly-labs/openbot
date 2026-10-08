### Fixed

- File chips can now find files outside the workspace from recent ACP and Claude file tool calls. Previously, a chip with only a file name could report a missing file. This lookup is local to the desktop and requires Full access. The last 200 paths per thread stay in memory until OpenBot closes.
