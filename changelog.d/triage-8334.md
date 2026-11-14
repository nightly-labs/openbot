### Fixed

- When an agent tries to change or delete a memory that is already gone, it now learns that the
  memory no longer exists and reads its memories again. Before, it was told that the memory belonged
  to a different agent, so it could not correct the memory and reported a problem that did not exist.
