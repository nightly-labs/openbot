### Fixed

- After a failed duplicate of an agent on a joined server, a new duplicate of the same agent made
  later gives a new copy. Before, it could give the copy of the failed try. A retry in the next 10
  minutes still gives the copy of the first try, so a lost answer does not make two copies.
