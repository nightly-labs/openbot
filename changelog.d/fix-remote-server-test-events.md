### Fixed

- The remote server tests no longer end with `ReferenceError: CloseEvent is not defined`. The shared
  test harness now builds the close event itself, because Node has no `CloseEvent`.