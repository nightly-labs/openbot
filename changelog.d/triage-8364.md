### Fixed

- An agent can now finish quietly when a teammate answers a request that a scheduled, script or
  webhook routine run sent, and the routine has nothing to tell you. Before, OpenBot refused the
  agent's "nothing to report" call, and the agent wrote a message in its chat with a notification.
  A Test run still shows the answer. A joined server must also be on the new version.
