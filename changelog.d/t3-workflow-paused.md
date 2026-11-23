### Added

- You can pause a workflow. Open the workflow menu and select Pause. A paused workflow does not start
  from its schedule, webhook, chat mention or GitHub event, and the canvas shows "Paused" with a
  Resume button. You can still run it by hand. Occurrences of a schedule that come while the workflow
  is paused are skipped. On a joined server, the server must also be on the new version.

### Changed

- Duplicate now makes a paused copy of a workflow, so the copy does not start from the same triggers
  as the original. Resume the copy when it is ready.
