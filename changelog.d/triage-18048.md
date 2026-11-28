### Fixed

- A workflow agent step that gives its answer to a later agent step, model step or image step now
  always gives that answer, also through a condition or an approval step between them. Before, the
  agent could end the step with "nothing to report", so the step showed done with no output, and the
  next step, for example a comparison of three research steps, did not get that result. This also
  holds when OpenBot restarts during the step. Agent steps that feed only an output, such as a post
  or a notification, can still stay silent. On a joined server, the server must also be on this
  version.
