### Fixed

- A scheduled routine no longer turns itself off in silence. Before, a run with nothing to report
  could pause its own routine and end with no message, so the routine stopped again after you turned
  it on. Now the routine stays on. A run that stops its routine because its task is done tells you
  so in the chat. On a joined server, the server must also be on this version.
