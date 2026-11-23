### Fixed

- A routine that runs in a separate thread now shows each run in that thread as a short routine
  marker, as in the agent's chat. Before, each run added its full instruction to the thread as a
  message from you, so a long instruction hid the results. The agent still gets the full
  instruction. Runs from before the upgrade keep their text. On a joined server, the server must
  also be on the new version.
