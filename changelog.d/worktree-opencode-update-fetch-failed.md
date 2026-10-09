### Fixed

- An OpenCode CLI update no longer stops with only "fetch failed" after the download completes. OpenBot now gets the OpenCode license from npm, the same place as the CLI, so the update needs no GitHub connection.
- When a runtime download request fails, the error now shows the address and the network reason.
- A Retry after a failed runtime install now uses the download it already has when that download passes its check, and does not download it again.
