### Fixed

- A routine runs one time after the computer wakes from sleep. Before, each time missed during
  sleep started its own run, one after another, and the first run often failed because the network
  was not back yet. Routines now wait for the network after a wake, and a routine does not start a
  new scheduled run while its previous run is not finished.
