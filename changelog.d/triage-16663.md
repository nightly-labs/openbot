### Fixed

- On Windows with PowerShell 7 from the Microsoft Store, OpenCode agents could not run commands many times: each command failed with "Access denied (os error 5)", and then worked again later. When PowerShell 7 is only the Microsoft Store link, OpenCode agents now use Windows PowerShell, which starts each time. A `shell` that you set in your OpenCode settings, or a `SHELL` variable, still comes first. On a joined server, the server must also be on this version.
