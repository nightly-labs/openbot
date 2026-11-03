### Fixed

- An agent that gives channel work with a missing or incorrect value, for example no source messages or a recipient that is not a channel member, now gets the reason and can correct the call. Before, a Codex agent saw only "dynamic tool request failed" and tried the same call again, and the channel showed a "Provider error".
