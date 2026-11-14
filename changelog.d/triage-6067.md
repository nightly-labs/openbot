### Fixed

- Show why a channel request waits. Before, a request stayed queued with no reason when its agent
  worked in another channel, or when the channel already ran 2 tasks. Now the channel says which
  channel the agent works in, or that the agent starts when a running task ends. This also shows on a
  joined server and in the web client when the server is on this version.
