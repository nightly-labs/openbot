### Fixed

- A Pi or Muse agent shows the words `true`, `false`, `null` and `none` again. Before, with the
  GitHub connection or an MCP setting of `true`, OpenBot hid them as `•••`. Then a workflow condition
  that looked for a flag such as `QA_READY=true` selected the wrong branch. Chats and step results
  that are already saved do not change.
