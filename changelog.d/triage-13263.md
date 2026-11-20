### Fixed

- A routine now runs again after the computer starts with a wrong clock that is corrected a short
  time later. Before, the routine stayed overdue, did not run, and kept one processor core busy,
  also after a restart. A routine that already ran for that day does not run again.
