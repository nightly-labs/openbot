### Added

- Choose how long you can pause in a voice conversation before your words go to the agent, in
  Settings > Voice > Pause before sending. Before, a pause of 1.2 seconds to think always sent a
  half sentence as its own message. The default stays 1.2 seconds.

### Fixed

- Codex live voice now waits for the rest of a sentence that you stop in the middle, and gives the
  agent the complete request. Before, each part after a short pause went to the chat as a separate
  message. For an agent on a joined server, the server must also be on the new version.
