### Fixed

- An agent can turn off or remove a skill from the Marketplace again when you saved a short password
  that is part of the skill's id, such as `openbot`. Before, the agent got `[redacted]` in place of
  the id and its request failed with "Skill not found". OpenBot still hides the saved password
  everywhere else.
