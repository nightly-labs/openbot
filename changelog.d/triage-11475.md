### Fixed

- An agent's browser tab no longer closes while its first page still loads. Before, when several
  agent tabs were open, the tab could close after about 2 minutes to free memory, and the agent got
  "Browser tab was closed during navigation." for a page that only loaded slowly.
