### Fixed

- An agent no longer gives the same answer two times in a row. Before, when the automatic check after
  a turn sent the agent back to work, for example to try a failed step again, the agent often wrote its
  full answer one more time. Now it writes only what the new work found or changed, or one short line
  when the new work confirms its answer. For an agent on a joined server, the server must also be on
  this version.
