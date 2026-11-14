### Fixed

- When we moved a hosted server to a new machine, files in folders outside the home folder, such as
  Obsidian vaults in `/srv`, did not move with it. Now a move finds these folders first and does not
  start until they are copied too.
