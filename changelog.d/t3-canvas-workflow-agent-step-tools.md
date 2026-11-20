### Added

- On the workflow canvas, LLM, condition, agent and image steps have a "Settings" action. It shows
  the settings and inputs that made the shown result. Long prompts and inputs show a few lines with
  "Show more", and each text has a copy button. "Use these settings" puts the settings back into the
  step, so that you can run the step again with the same settings. This works on this computer, on a
  joined server and in the web client. On a joined server, the server must also be on this version.
- Agents can add image and video steps to a workflow, and run one step of a workflow with the newest
  answers before it. When an agent reads the runs of a workflow, it also gets the settings and inputs
  that each step used. Only your own message can make an agent run a step. On a joined server, the
  server must also be on this version.

### Changed

- Each workflow step now keeps the settings that it ran with (prompt, model, size and the other
  fields) and the inputs that it read, for a full run, for "Run step" and for a retry. Before, a
  result did not keep these. A retry runs the step as it is now, and keeps those settings. When a
  step has no model, it keeps the model, effort, aspect and background that OpenBot chose for it.
  Results from older versions have no saved settings. After this update, an older version of OpenBot cannot open your
  data.

### Fixed

- The toolbar of a workflow node no longer opens under the canvas tools, under the workflow header,
  or out of view below the canvas.
