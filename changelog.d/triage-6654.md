### Fixed

- A channel now answers new messages after a member's background job ends. Before, when a Claude
  member answered a finished background job by itself, the messages that the channel sent to that
  member while it answered did not start until OpenBot was restarted. The server must also be on the
  new version of OpenBot.
