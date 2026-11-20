### Fixed

- A question card from a Grok agent keeps working after Grok stops waiting for the answer. Before, Grok
  stopped waiting after 30 minutes, but the card still looked ready, and a click on an option had no
  effect. Now the answer goes to the agent as your next message. In a routine, the card closes as
  expired. A joined server must also be on the new version.
