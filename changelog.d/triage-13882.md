### Fixed

- The "Your time zone is now …" notice no longer moves routines to a time zone that the computer
  stopped using. Before, when Windows showed a different time zone for a short time after a restart,
  the notice stayed, and Move put all routines on that wrong time zone. Now Move checks the time zone
  again, and the notice closes or shows the current time zone.
