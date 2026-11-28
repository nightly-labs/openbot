### Added

- A routine can now let its runs change the schedule of the agent's routines and turn them on or off.
  Turn on "Runs can change routines" in the settings of that routine. For example, a webhook routine
  that sorts mail can plan the next run of an archive routine. On a joined server, the server must
  also be on the new version.

### Changed

- A routine run can no longer create, delete or test routines, or change another routine when its
  routine does not have this setting. A run can still pause its own routine. Before, only the
  instructions of the run said this, and some models changed routines anyway.
