### Fixed

- A workflow agent step that gives its answer to another agent step or model step now always gives
  that answer. Before, the agent could end the step with "nothing to report", so the step showed done
  with no output, and the next step, for example a comparison of three research steps, did not get
  that result. Agent steps that feed only an output, such as a post or a notification, can still stay
  silent. On a joined server, the server must also be on this version.
