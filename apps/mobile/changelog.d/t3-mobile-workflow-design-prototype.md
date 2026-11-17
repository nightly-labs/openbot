### Added

- The workflow editor has a Flow view. It shows the trigger and the steps as a flow from left to right,
  as on the computer, with the yes and no paths of a condition one under the other. Tap "+" between
  two steps to add a step there. Touch and hold a step to move, duplicate or delete it. The List view
  stays available.
- The workflow page can show the steps as a flow, also for a workflow with many conditions or a loop.
  Choose Flow or List in the "…" menu. The flow is a canvas from left to right: the paths of each
  condition sit one under the other, and the canvas scrolls sideways.
- The editor has the Flow view for every workflow, also for a workflow with many conditions or a loop.
  Tap + on a connection or at the end of a path to add a step there. In the List view, tap + on a step
  to add a step after it.
- The run page follows the Flow or List choice. In Flow, the run moves on the canvas as on the
  computer: a bright arc goes round the step that runs, a step that waits for you has an orange ring,
  the line into the running step moves, and the path that a condition did not take is dimmed. Tap a
  step to see its output and to approve, retry or stop it.
- You can set the system prompt of a model step, as on the computer.
- A GitHub trigger can listen to more than one repository. Tap a repository to add it to the list or
  remove it.

### Changed

- The workflow editor opens as a page from the right, not as a sheet. Choose Flow or List in its "…"
  menu. Add a step opens as a sheet over the editor, and a kind of step that cannot go at that place
  shows as unavailable.
- The step list of a workflow with more than one condition or a loop shows the steps in the order that a
  run goes, with each path under its "If yes" or "If no" label. Before, it showed the steps in canvas
  order, from left to right.
- On the workflow page, Run and the "…" menu (Edit, Pin, layout) are in the header, in place of the
  Run now and Edit buttons.

### Fixed

- In the step list of a workflow, a long step text was cut off at the edge of the screen. It now shows
  on up to four lines.
- A GitHub trigger with more than one repository showed only the first one. When you chose a
  repository on the phone, the trigger kept only that repository.
- A video step showed as "Image", and the result of an image or video step showed as a file id.
