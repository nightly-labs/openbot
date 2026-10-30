### Fixed

- On a server that you joined, the secure card for a password or a code sends your answer to the
  agent again. Before, Submit, Take over and Cancel failed with `http/400/team_api_error`.
- On a server that you joined, a generated or edited profile for an agent goes to that agent again.
  Before, a change failed with `http/400/team_api_error`, or the server read it as a new agent.
