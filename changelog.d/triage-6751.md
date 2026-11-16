### Fixed

- A routine that comes due while its provider cannot start, for example with no internet connection,
  waits and runs when the provider can start again. Before, that run failed, and the routine did not
  run again until its next scheduled time.
