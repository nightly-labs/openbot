### Fixed

- Stop the first shared-table call of an agent after OpenBot starts from failing as a slow
  statement. Before, the start of the database process counted against the 5 second limit of that
  statement, and a slow Windows computer often went past it. The start now has its own limit, and
  OpenBot starts the process early on a computer that already has shared tables.
