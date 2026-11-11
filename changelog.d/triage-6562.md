### Fixed

- An agent no longer stays on "working" with no end when a browser tab stops. This can occur when the
  page shows a dialog during an action. After two minutes, the agent's browser call returns an error, and
  the agent can tell you to answer the dialog or open the page again.
