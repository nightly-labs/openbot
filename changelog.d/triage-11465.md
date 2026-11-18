### Fixed

- Built-in OpenBot tool calls from Antigravity agents no longer fail at random times with "An existing
  connection was forcibly closed by the remote host". OpenBot now keeps an idle tool connection open
  for as long as the agent can reuse it.
