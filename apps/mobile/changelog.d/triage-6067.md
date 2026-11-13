### Fixed

- Show why a channel request waits. Before, a request stayed queued with no reason when its agent
  worked in another channel, or when the channel already ran 2 tasks. Now the channel says which
  channel the agent works in, or that the agent starts when a running task ends. The server must be
  on the new desktop version.
