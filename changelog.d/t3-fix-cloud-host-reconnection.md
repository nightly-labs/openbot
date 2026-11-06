### Fixed

- Show a Cloud server as stopping, not running, when its provider cannot save its disk at a stop, and
  log it for the operator. Before, the Worker read the server as running and the fault stayed hidden.
