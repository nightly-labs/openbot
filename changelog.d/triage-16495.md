### Fixed

- Chrome extension: when a shared tab does not answer an agent action, the action stops after 20
  seconds and the agent can try again. Before, one stuck action blocked all later actions on all
  shared tabs, and each one failed with "Chrome did not answer in time" until Chrome restarted.
